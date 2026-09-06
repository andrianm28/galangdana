# Laporan Baseline: FundForIndonesia (fka GalangDana)

Tanggal: 2026-09-06. Sumber: rekuisisi repositori langsung, 4 agen eksplorasi paralel
(API, web, packages, health), dan analisis hotspot git. Klaim ditandai
**FAKTA** / **OBSERVASI** / **PENILAIAN** / **REKOMENDASI** secara eksplisit.

## 1. Executive Understanding

**FAKTA** — Platform crowdfunding donasi ala Kitabisa untuk Indonesia (termasuk zakat
& wakaf via mitra amil berlisensi), di-host di fundforindonesia.org (Yayasan Indonesia
Emas). Monorepo Bun dengan 2 app + 7 packages.

**Pengguna utama**: donatur (termasuk guest tanpa akun), campaigner individual
(wizard pembuatan kampanye + KYC), admin (moderasi kampanye + pencairan dua-orang).

**Core workflows**:

1. Buat kampanye: draft 7-hari (track medical/non_medical, wizard 9–10 langkah) →
   konversi ke campaign → KYC (KTP + selfie) → submit → moderasi admin
   (approve / request-revision per field) → aktif
2. Donasi: pilih nominal (min Rp 10.000, maks Rp 500 juta) → metode (VA bank / QRIS) →
   bayar → halaman status polling otomatis → kuitansi (kuitansi dengan terbilang
   anti-pemalsuan)
3. Pencairan: request → OTP → rekening → bukti → admin approve → admin lain yang
   membayar (four-eyes, keduanya dicatat) → jejak dana publik

Tech stack: Elysia 1.1 (API) + Eden Treaty (end-to-end types) | SvelteKit 2 +
Svelte 5 runes (web) | Drizzle + Postgres 16 | Redis (rate limit saja) |
MinIO + imgproxy | Meilisearch 1.11 | Tailwind v4 | Biome | Vitest + bun test.

Runtime topology (**FAKTA**): single host produksi — systemd user units
fundforindonesia-{api,web}.service, infra via docker-compose (semua port di-bind
127.0.0.1), deploy via self-hosted GitHub Actions runner, nginx (implisit dari
.env.production).

Dependensi eksternal: Sumopod QRIS (sandbox, satu-satunya provider "nyata"),
Google OAuth (PKCE), Mock Midtrans (VA), Xendit hanya sebagai bentuk interface payout.

## 2. System Architecture

Modul utama (**FAKTA**):

| Modul | Isi | Depth |
|---|---|---|
| apps/api (~5.1k LOC) | 11 route plugin Elysia, ~50 endpoint, auth OTP+password+Google | Dalam (transaksional) |
| apps/web (~4.6k LOC Svelte) | 3 route group: (consumer), (campaigner), (admin); 0 form actions — semua mutasi client-side ke API | Sedang |
| packages/db | 24 tabel, 18 enum, 21 migrasi, seed 8 kampanye | Dalam |
| packages/contracts | TypeBox schemas — dipakai semua route sebagai body/response schema | Dangkal tapi load-bearing |
| packages/money | bigint rupiah tanpa minor-unit, terbilang, serializer bigint-safe | Dalam, murni |
| packages/payments | Adapter PaymentProvider + 2 provider (Mock/Sumopod) + 2 skema signature | Dalam |
| packages/media | 1 fungsi (buildImgproxyUrl) | Sangat dangkal |
| packages/search | Sinkronisasi additif index campaigns + prune saat reindex | Sedang |
| packages/ui | 12 komponen Svelte 5 + tokens Tailwind v4 | Sedang |

Graf dependensi: money ← db ← search, money ← ui;
api → db/media/money/payments/search/contracts; web → money/ui/contracts.
**FAKTA**: tidak ada siklus.

Interface kunci:

- Kontrak wire = TypeBox di kedua sisi (validasi server + tipe client via `Static<>`) —
  **OBSERVASI**: ini penghubung paling sehat di repo; perubahan route API langsung rusak
  saat compile di web (disengaja, didokumentasikan).
- PaymentProvider adapter interface — seam yang bersih untuk menambah provider nyata.

Kepemilikan data: Postgres (semua state), MinIO 2 bucket (campaign-media publik,
campaign-documents privat, akses via presigned URL 300 dtk), Meili 1 index (khusus
kampanye active).

Aliran data penting (**FAKTA**): settlement webhook = 1 transaksi DB dengan dedup
UNIQUE(provider, provider_event_id) + SAVEPOINT, mesin status donasi monoton (paid
tidak bisa turun), increment collectedAmount/donationCount, enqueue outbox.

**OBSERVASI** lokalitas:

- Endpoint admin terpecah 3 file (admin.ts, disbursements.ts, help.ts);
  disbursements.ts (922 baris) mencampur API campaigner & admin.
- Logika S3/upload hidup di apps/api (3 instansiasi Bun.S3Client hampir identik),
  bukan di packages/media — nama package menyesatkan; duplikasi diakui sendiri di
  lib/media-s3.ts:1-12.
- GET /campaigns/mine bekerja hanya karena urutan registrasi route (didaftar setelah
  /:slug) — sensitif terhadap urutan.

## 3. Domain Model

Istilah kanonik: Campaign (model goal vs program), Draft (track medis/non-medis),
KYC (individual_verifications, per-campaign), DisbursementRequest (8 status),
Donation ↔ Payment (1:1), AllocationPolicy (platform_fee_bps, saat ini 0), kuitansi,
jejak dana (/pencairan-dana).

Invarian yang di-enforce (**FAKTA**, sebagian di level DB):

- CHECK goal_model_requires_goal_amount: goal ⇒ goal_amount NOT NULL;
  program ⇒ goal_amount & expires_at NULL
- CHECK campaign_documents_exactly_one_owner: tepat satu dari draft_id/campaign_id
- Partial unique campaigns.draft_id — menutup race double-submit
- Nominal donasi min/maks di contracts — dibagikan client & server, tidak bisa dilewati
- Saldo yang dapat ditarik = dana terkumpul − dibayarkan − tertunda (dihitung hidup,
  di-lock SELECT FOR UPDATE)
- Four-eyes: pembayar ≠ approver, keduanya tercatat (approved_by, paid_by)
- Zakat/wakaf wajib diatribusikan ke mitra amil, tidak pernah ke platform (compliance,
  komentar seed)

Drift terminologi / inkonsistensi (**OBSERVASI**):

- Param :slug yang sebenarnya membawa campaign id (/campaigns/:slug/kyc, /revisions) —
  dibatasi oleh batasan trie Elysia, membingungkan konsumen API
- Tidak ada role "amil"/"moderator" — hanya campaigner|admin; "amil" hanya muncul
  sebagai fixture campaigner seed
- MoneyJSONSchema di-maintain ganda secara manual antara money dan contracts
  (sinkronisasi didokumentasikan tapi manual)
- Enum jenis dokumen ada di 4 salinan (db enum, 3 union TypeBox)
- payments.status menggunakan ulang enum donation_status — tabel 1:1 yang berbagi
  kosakata siklus hidup

Kontradiksi domain vs kode (**FAKTA**):

- notifications_outbox write-only — kuitansi/email dijanjikan (template
  donation_receipt di-enqueue saat pembayaran lunas) tapi tidak ada worker yang pernah
  mengirim; Mailpit + SMTP env tersedia namun tidak terpakai
- bank_accounts.verified_at & campaigners.verified_at — tidak pernah ditulis (endpoint
  verifikasi admin ditunda)
- currency: USD ada di enum "untuk kejujuran skema" tapi tak ada dukungan nyata
- disbursement_requests.status: "processing" disimpan untuk pekerja async yang belum ada

## 4. Engineering Health

Strategi pengujian (**FAKTA** — kekuatan terbesar repo):

- 112 file test: web 49 (vitest), api 22 (bun test), db 20, ui 12, payments 4,
  money 2, lainnya 1 masing-masing. ~7.2k baris test vs ~5.1k baris produksi di api.
- Semua 11 file route API punya test; test = integrasi black-box dengan infrastruktur
  nyata (Postgres ter-seed, Redis, MinIO), termasuk test konkurensi Promise.all
  sungguhan (guarded transitions, payout exactly-once dengan spy + delay 150ms), dan
  fixture fail-closed subprocess untuk webhook secret kosong.
- Kesenjangan: search/media/contracts masing-masing hanya 1 test; tidak ada ukuran
  cakupan; root bun test diam-diam tidak mencakup web/ui (CI mencakup via
  test:web/test:ui — pengembang lokal bisa tertipu); tidak ada E2E Playwright.

CI/CD (**FAKTA**): satu ci.yml lengkap: lint biome → migrasi → seed → reindex →
typecheck → 3 suite test → build → smoke test end-to-end (boot API+web + check-link
crawl) → deploy ke self-hosted runner (dibatasi: hanya push ke master, dengan alasan
keamanan runner yang terdokumentasi) → migrasi .env.production → reindex prod →
restart systemd → health check 60 dtk.

- **PENILAIAN**: migrasi berjalan sebelum kode baru di-build/restart; tidak ada
  lingkungan staging, tidak ada runbook rollback, tidak ada pemindaian dependensi
  (bun audit/Dependabot).

Organisasi kode: TS strict + noUncheckedIndexedAccess di mana-mana; Biome recommended;
komentar luar biasa (keputusan non-obvious mengutip verifikasi empiris & insiden
nyata). Duplikasi nyata: 5 wizard step salinan line-for-line di web, 3 klien S3,
2 salinan constant-time compare, ~25 as any Eden dengan biome-ignore, 2 gaya render
error (<Alert> vs <p class="text-red-600">).

Postur keamanan:

- ✅ Argon2id (password & kode OTP), rate limit Redis pada OTP/login/register sebelum
  hashing (anti hash-DoS), normalisasi telepon +62 (respelling berbagi budget),
  anti-enumerasi login, PKCE + state + fail-closed email_verified untuk OAuth, webhook
  signature constant-time + fail-closed + dedup, CORS single-origin, upload presigned
  dengan re-validasi prefix, 404 bukan 403 untuk milik orang lain, port docker di-bind
  loopback.
- ⚠️ (**PENILAIAN**) Token sesi disimpan plaintext sebagai sessions.id (kebocoran baca
  DB = kredensial 30 hari), tidak pernah dirotasi; tidak ada rate limit di luar auth
  (donasi publik, support tickets, pencarian); validasi unggahan khusus ekstensi
  (tanpa MIME/ukuran); GET /donations/:id publik via UUID (disengaja, tapi mengekspos
  jumlah + VA); kunci idempotensi unik global — klien mana pun bisa mengklaim key
  klien lain; tanpa CSRF token (bergantung pada SameSite=Lax, dapat diterima untuk
  JSON API).

Dependensi: pin ketat; override @sinclair/typebox@0.33.24 terdokumentasi via commit
3d10143 (konflik Elysia-0.32 vs workspace-0.33); pin Vite 5/Vitest 2/Kit 2.9 sudah
satu siklus utama di belakang (per 2026-09); tidak ada tooling pembaruan otomatis.

DB/migrasi: drizzle-kit generate + migrate programatik, 21 migrasi, seed idempoten;
tidak ada relations() (join manual).

Observabilitas — titik terlemah (**FAKTA**): hanya console.log/error (7 situs
panggilan), tidak ada error tracking/metrics/request logging; repo sendiri merekam
insiden "pencarian produsen nol hasil selamanya, tidak ada yang mengingatkan"
(ci.yml:325-333).

Ops: backup DB nightly pg_dump gzip retensi 35 hari (rencana menyepakati 30 —
perbedaan), cron di host (tidak di repo); tidak ada README.md root di repo publik.

Git/riwayat: 40+ PR sejak 2026-08-29, disiplin (fitur/perbaikan granular, branch per
fase). Hotspot perubahan (**FAKTA**): campaigns.ts (27×), donations.ts/disbursements.ts
(21×), contracts/index.ts (20×), ci.yml (18×) — garis moneter + kontrak adalah area
yang paling aktif berubah.

## 5. Risiko / Hotspot (prioritas berdasarkan tingkat keveraan)

| Tingkat | Risiko | Bukti |
|---|---|---|
| Kritis | Rail pembayaran produksi adalah penyedia tiruan: .env.production memiliki MOCK_MIDTRANS_SERVER_KEY diatur; SUMOPOD_WEBHOOK_SECRET kosong → QRIS gagal ditutup. Situs yang menerima donasi menyelesaikannya melalui penyedia tiruan | donations.ts:36-81, health report §3 |
| Tinggi | Kredensial prod = pengembangan default yang dikomit: IMGPROXY_KEY/SALT, MEDIA_S3_ACCESS_KEY_ID identik byte dengan .env.example; DATABASE_URL prod = localhost:55434. Rotasi dipreskripsi (Task 5 rencana) tapi belum dilakukan | health report §3 |
| Tinggi | Kuitansi diantrekan selamanya: outbox write-only, tidak ada pekerja — donor yang membayar tidak pernah menerima apa pun | donations.ts:178-195 |
| Tinggi | Tanpa observabilitas/alerting — insiden tanpa peringatan yang terdokumentasi sudah terjadi sekali | ci.yml:325-333 |
| Tinggi | Token sesi plaintext di DB, tidak pernah dirotasi | auth/session.ts:24-30 |
| Sedang | Kunci idempotensi unik-global → poison silang antar-klien (409 / body respons cached orang lain) | donations.ts:222-241 |
| Sedang | Tidak ada rate limit pada endpoint publik mahal (POST /donations membuat charge, /search, /support-tickets) | agent API §9.11 |
| Sedang | Unggahan: hanya nama ekstensi — tanpa MIME/ukuran maksimal | contracts PresignDocumentUploadBodySchema |
| Sedang | Kegagalan createPayout sengaja meninggalkan baris processing tanpa reconciler; Sumopod getStatus melempar "belum diimplementasikan" | disbursements.ts:866-874 |
| Sedang | Drift env apps/api/.env (kunci usang S3_\*/MEILI_URL, tanpa SUMOPOD_\*) → test skrip per-package gagal keras | agent API §9.1 |
| Sedang | Urutan deploy: migrasi sebelum restart, tanpa rollback/staging | ci.yml:312-341 |
| Perbaikan | Hotspot disbursements.ts (922 baris, campaigner+admin campur, 21× berubah) — menerapkan test penghapusan: kompleksitasnya nyata & terkonsentrasi (transaksional, benar), tapi lokalitas buruk; memisahnya menjadi disbursements + admin/disbursements akan meningkatkan lokalitas tanpa memindahkan kompleksitas | hotspot git |
| Perbaikan | 5 wizard step web = salinan template yang identik; 3 klien S3; enum jenis dokumen ×4; as any Eden ~25; gaya error ganda; media package hanya 1 fungsi (nama menyesatkan) | agent web/packages |
| Perbaikan | Retensi cadangan 35 vs 30 hari disepakati; .gitignore duplikat baris; Spinner/Avatar tidak digunakan; createSession metadata mati (user_agent/ip tak pernah diisi); lib/campaigner.ts SELECT-lalu-INSERT (bentuk race yang sudah dihapus di tempat lain) | berbagai |

## 6. Tindakan Selanjutnya yang Direkomendasikan (diprioritaskan berdasarkan dampak × likelihood × frekuensi perubahan ÷ usaha)

1. Putuskan & pasang rail pembayaran nyata, atau tutup funnel donasi sampai siap —
   risiko Kritis menyentuh uang nyata hari ini. Menghidupkan QRIS Sumopod di prod
   (secret sudah didukung oleh adapter) adalah upaya terkecil; Midtrans nyata adalah
   tindak lanjut.
2. Konsumsi notifications_outbox dengan pekerja SMTP sederhana (Mailpit sudah
   terprovisi) — kuitansi adalah janji kepercayaan inti; upaya rendah, dampak tinggi,
   dan area donasi adalah hotspot perubahan tertinggi.
3. Baseline observabilitas: error tracking (misal Sentry) + request logging terstruktur
   + alert pada kegagalan pemeriksaan kesehatan deploy — upaya kecil, mencegah kelas
   "pencarian rusak selamanya tanpa ada yang tahu" yang terjadi lagi.
4. Rotasi kredensial prod (imgproxy key/salt, kredensial DB, ganti DATABASE_URL dari
   port dev) + hapus MOCK_MIDTRANS_SERVER_KEY dari prod di langkah yang sama —
   menyelesaikan Task 5 rencana yang sudah dipreskripsi.
5. Hash token sesi saat disimpan (simpan SHA-256, cari berdasarkan hash) — perubahan
   lokal kecil di auth/session.ts dengan keuntungan keamanan yang tidak proporsional.

(Opsional, terpisah: pemahaman arsitektur apps/api/src/routes/disbursements.ts +
pemecahan permukaan admin — jalur alami adalah menjalankan
/improve-codebase-architecture untuk hotspot itu setelah item 1–4.)

**FAKTA** penutup: proyek ini dalam kondisi kesehatan teknik yang jarang untuk
usia/usahanya — disiplin test & komentar istimewa, arsitektur bersih tanpa siklus,
zero TODO debt. Riskenya bukan di kualitas kode, tapi di operasi produksi: uang nyata
di atas rail tiruan, janji yang tersendat di outbox, dan ketiadaan mata
(observability).
