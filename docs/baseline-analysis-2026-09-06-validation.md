# Validasi Laporan Baseline 2026-09-06

Tanggal validasi: 2026-09-06. Subjek: `docs/baseline-analysis-2026-09-06.md`.

**Metode**: setiap klaim FAKTA dicek ulang langsung terhadap file di repo (read/grep/hitung),
bukan mengandalkan output agen eksplorasi putaran pertama. File `.env.production` hanya
dibaca lewat skrip yang mencetak status (`HAVE_VALUE`/`EMPTY`/`ABSENT` dan perbandingan
hash) — **tidak ada nilai secret yang dicetak atau disalin ke mana pun**. Yang tidak
diverifikasi: menjalankan ulang test suite, perilaku runtime produksi, dan status cron
di host (di luar repo).

**Skala verdict**: ✅ TERKONFIRMASI · ⚠️ KOREKSI (klaim salah/tidak tepat, dengan fakta
pengganti) · ➖ PRESISI (angka pendekatan yang perlu dikencangkan, substansi benar).

**Ringkasan**: ~90 klaim atomik diperiksa. **Semua 5 baris risiko Kritis/Tinggi
TERKONFIRMASI tanpa perubahan.** Ditemukan 2 koreksi framing/sedang + 6 koreksi
ringan/presisi. **Tidak ada koreksi yang mengubah prioritas risiko atau rekomendasi.**

---

## A. Koreksi (wajib dibaca)

### ⚠️ 1. Jumlah endpoint: "~50" → 68 [SEDANG]

Registrasi route gaya chain `^\s*\.(get|post|put|patch|delete)\(` di 8 file route =
**65**, plus `health.ts`, `categories.ts`, `search.ts` masing-masing 1 (gaya
`new Elysia().get(...)` multi-baris) = **68 endpoint**. Contoh silang: `campaigns.ts`
tepat 16, cocok dengan inventaris laporan. Bukti: `grep -c` per file
(admin 4, auth 8, bank-accounts 2, campaign-drafts 8, campaigns 16,
disbursements 14, donations 5, help 8) + 3 file gaya alternatif.

### ⚠️ 2. "Retensi 35 vs 30 hari disepakati — perbedaan" → TIDAK ADA DISKREPANSI [SEDANG, framing]

Plan rename (`docs/superpowers/plans/2026-09-05-rename-galangdana-to-fundforindonesia.md:579,599`)
secara eksplisit mempreskripsikan `RETENTION_DAYS=35`: *"changed from 14 to 35 …
35 gives a 5-day margin over the 30-day soak."* Angka **30 hari adalah periode soak
(Task 11, baris 1292-1301), bukan retensi**. `scripts/backup-db.sh:21` (`:-35`)
sesuai rencana. Baris risiko "Perbaikan" ini harus dihapus dari laporan.

### ⚠️ 3. Metrik plan "done=0 … done=3 open=64" → format marker salah [RINGAN]

Plan tidak memakai marker `done=`/`open=` sama sekali (grep: nol hasil). Yang dipakai
checkbox `[ ]`/`[x]`: **1026 `[ ]` vs 3 `[x]`** di seluruh `docs/superpowers/plans/`.
Ketiga `[x]` semuanya adalah "Open Questions DECIDED" di plan rename (baris
1375, 1389, 1393). Substansi laporan (historical record, bukan tracker hidup) benar;
angkanya yang diganti.

### ⚠️ 4. "console.log/error (7 situs)" → 10 production call sites [RINGAN]

`grep console.(log|error|warn)` di luar test/fixture: `apps/api/src` 5 situs
(`index.ts:50`, `auth.ts:250`, `admin.ts:241`, `sms-provider.ts:14`,
`response-mapper.ts:32`) + `packages/db` 4 (migrate + seed) +
`packages/search/src/reindex.ts:40` = **10**. Kesimpulan "observabilitas terlemah"
tetap sah (tidak ada sentry/pino/winston/prometheus — grep nihil).

### ⚠️ 5–8. Presisi angka [RINGAN]

| Klaim laporan | Fakta |
|---|---|
| `as any` Eden "~25" di web | **33** kemunculan (`grep -c`) |
| `RESERVED_SLUGS` 27 entri | **30** entri (`apps/api/src/lib/slug.ts:9-40`, dihitung manual) |
| "38 +page.svelte lack SeoHead+PageTitle" | **36**: 49 `+page.svelte`, 13 file berbeda memakai salah satunya (SeoHead 8, PageTitle 5, overlap 0) |
| api "~5.1k prod / ~7.2k test", web "~50 files" | **4.714 / 7.533** baris (`wc`); **60** file `.svelte` @ **4.613** baris (angka baris laporan tepat) |

---

## B. Konfirmasi per bagian (dengan bukti file:baris)

### Bagian 1 — Executive Understanding ✅ semua terkonfirmasi

- Monorepo Bun 2 app + 7 paket: `package.json:4` (`workspaces`), struktur direktori ✅
- Wizard 9–10 langkah: `step-order.ts` — medis 9 (`SHARED_PREFIX` 5 + `pasien` + suffix 3),
  non-medis 10 (+`data-diri`, `penerima`) ✅
- KYC 8 langkah persis `identity→contact→consent→upload-ktp→upload-selfie→hold→summary→pending`:
  `kyc-step-order.ts:1-10` ✅
- Nominal Rp 10.000–500 jt: `packages/contracts/src/payments.ts:23-24` + rasional
  anti-card-testing di komentar ✅
- Preset 25k/50k/100k/250k tanpa preselect: `donation-amount/+page.svelte:21` ✅
- Polling status 1 dtk tick + 5 dtk `invalidateAll()` + sadar-background-tab:
  `donation/status/[id]/+page.svelte:39-61` ✅
- Kuitansi 404-kecuali-paid + rasional "forgery": `kuitansi/+page.server.ts:15-17` ✅
- Four-eyes + kolom bukti: `disbursement-requests.ts:40-48`,
  `disbursements.ts:734-737` (`self_approval_forbidden`),
  `:827-830` (`same_approver_forbidden`), `paidBy` ditulis `:885-909` ✅
- Topologi prod (systemd units, deploy in-place, health check 30×2 dtk):
  `.github/workflows/ci.yml:292-368` ✅
- Sumopod sandbox satu-satunya provider nyata:
  `sumopod-provider.ts:39` (`https://api-pay-sandbox.sumopod.com`); Xendit hanya
  bentuk interface (`mock-provider.ts:122-143`, komentar Payouts API v2) ✅
- Atribusi amil (bukan platform) + fixture `Yayasan Amanah Ummah`:
  `campaigners.seed.ts:8-12`, `campaigns.seed.ts:75-83` (komentar compliance) ✅

### Bagian 2 — System Architecture ✅ semua terkonfirmasi

- 11 route plugin: `apps/api/src/index.ts:33-43` (11× `.use`) ✅
- 68 endpoint (setelah koreksi A.1); kontrak TypeBox di setiap route — sampel
  `health.ts`, `categories.ts`, `search.ts` semuanya membawa `response` schema ✅
- Graf dependensi tanpa siklus: klaim edge (api→6 paket, web→money/ui/contracts)
  konsisten dengan `package.json` masing-masing workspace (diverifikasi silang) ✅
- Eden typed-against-`App` + rasional compile-time: `api-client.ts:7-11` ✅;
  `$env/dynamic/public` + fallback `localhost:3001`: `:1-5` ✅;
  `credentials: "include"` ✅; cookie `session=` hardcoded + keharusan cocok dengan
  `SESSION_COOKIE`: `server-api-client.ts:21-28` ✅
- Webhook settle = 1 transaksi + dedup `UNIQUE(provider, provider_event_id)` +
  SAVEPOINT + monotonik paid: `donations.ts:83-201` (komentar savepoint vs
  postgres.js error-tracking :85-111; guard `WHERE status='pending'` untuk
  non-paid :126-147; increment counters :170-176; outbox bersyarat :178-195) ✅
- Admin terpecah 3 file: `/admin` di `disbursements.ts` 5 route (:623-795) +
  `help.ts` 5 route (:65-209) ✅
- 3 (+1 seed) instansiasi `Bun.S3Client` + docstring "deliberately left as-is":
  `campaign-drafts.ts:32`, `campaigns.ts:49`, `lib/media-s3.ts:13`,
  `seed/upload-cover-images.ts:24` ✅
- `/campaigns/mine` (:792) setelah `/:slug` (:265) ✅; quirk `:slug`-berisi-id +
  komentar trie memoirist: `campaigns.ts:477-483`, `:590-596` ✅

### Bagian 3 — Domain Model ✅ semua terkonfirmasi

- Skema: **24 `pgTable` / 18 `pgEnum` / 21 migrasi SQL** (dihitung langsung) ✅;
  daftar 18 enum cocok satu-per-satu ✅; tidak ada tabel receipts/media
  (daftar `ls schema/`), tidak ada `relations()` (grep nihil) ✅
- CHECK `goal_model_requires_goal_amount` + partial unique `draft_id` + komentar
  race double-submit: `campaigns.ts:110-129` ✅; workaround `sql\`0\`` + komentar
  bug drizzle-kit 0.28.1: `:88-96` ✅; `displayAmount`: `:141-149` ✅;
  komentar "USD schema honesty": `:18-22` ✅
- CHECK `campaign_documents_exactly_one_owner`: `campaign-documents.ts:40-44` ✅
- users nullable phone/email + "admin = direct DB UPDATE":
  `users.ts:3-14`, role hanya `campaigner|admin` ✅
- OTP: TTL 5 mnt, maks 5 attempt, `crypto.getRandomValues`, hash argon2id,
  latest-unconsumed, klaim atomik `UPDATE…RETURNING`: `otp.ts:8-9,11-16,51,86-104,119-171` ✅
- Donasi: `userId` set-null (guest), `contactChannel` email|whatsapp + komentar
  guest-majority, default label "Sesama": `donations.ts:15-53` ✅
- payments 1:1 + `provider_order_id` unik + reuse enum donation_status: `payments.ts` ✅;
  `payment_events` unik (provider, event_id) ✅
- Disbursement 8 status + komentar "processing reserved":
  `disbursement-requests.ts:6-21` ✅
- Idempotency: `key` unik, `endpoint` disimpan tapi BUKAN bagian constraint;
  `onConflictDoNothing({ target: key })`: `idempotency-keys.ts:3-9`,
  `donations.ts:222-228` → risiko poison silang **nyata** ✅
- Outbox kolom lengkap (`outbox.ts:3-12`); **write-only TERBUKTI**: satu-satunya
  penulis `donations.ts:181-191`, tidak ada pembaca/worker (grep repo-wide hanya
  schema + route + test) ✅
- KYC unik-per-campaign + `status` default pending + komentar "no real vendor":
  `individual-verifications.ts:4-37` ✅; `bank_accounts.verified_at` write-never
  + komentar deferred: `bank-accounts.ts:4-10` ✅ (klaim `campaigners.verified_at`
  write-never: kolom tidak ada di skema campaigners — lebih tepat "tidak ada kolom
  verifikasi setara"; tidak material)
- MoneyJSON paralel + komentar kewajiban sync manual: `contracts/campaigns.ts:3-6` ✅;
  enum dokumen ×4 salinan (db + 3 union TypeBox di `campaign-drafts.ts:69`,
  `campaigns.ts:222,256`) ✅
- Terbilang: maks 1 kuadriliun, throw negatif/lewat-batas: `terbilang.ts:32,54-61` ✅
- Seed: 8 kampanye (8 blok `slug:`, +1 deklarasi tipe), 6 campaigner (2+3+1),
  17 kategori ✅

### Bagian 4 — Engineering Health ✅ semua terkonfirmasi (dengan koreksi A.4–A.8)

- **112 file test** d
...[truncated 7370 chars]