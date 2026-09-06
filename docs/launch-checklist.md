# Launch Checklist — FundForIndonesia

## Keputusan tercatat
- **2026-09-06, pra-launch: sandbox berlaku termasuk situs live.** Donasi QRIS di
  produksi menembak `api-pay-sandbox.sumopod.com`: tidak ada uang nyata bergerak,
  tetapi donasi yang disimulasikan TERCATAT `paid` (counter naik, jejak dana tampil,
  kuitansi terbit). Ini disengaja selama pengembangan dan **wajib dicabut saat launch**.
- Mock VA dipensiunkan dari prod (`MOCK_MIDTRANS_SERVER_KEY` dihapus dari
  `.env.production`). Akibat yang disengaja: admin **Pay pencairan fail-closed (500)**
  sampai rail payout nyata (Xendit) dipasang — jangan "perbaiki" dengan
  mengembalikan mock.

## Wajib sebelum launch
1. **Project Sumopod PRODUKSI** (KYB + rekening settlement yayasan): ambil prod
   `API key` + `webhook secret` + `host produksi`.
2. `.env.production`: ganti ketiga nilai `SUMOPOD_*` dari sandbox ke produksi.
   Jangan pernah campur (kunci sandbox + secret prod = webhook tak terverifikasi;
   kunci prod + host sandbox = donasi fiktif).
3. Rotasi secret: **DIBATALKAN owner 2026-09-06 untuk kredensial Sumopod**
   (sandbox API key/secret/token + password SMTP — tetap dipakai apa adanya).
   Aturan sisa: kredensial PRODUKSI tidak boleh ditempel di chat; bila terjadi,
   rotasi sebelum launch.
4. **Bersihkan baris uji** (terverifikasi bersih 2026-09-06; ulangi tepat sebelum
   launch): donasi `pending` provider `sumopod`, `payment_events`
   `evt-uat-*`/`test-*`, user/kampanye/orang-orangan UAT, objek MinIO prefix terkait.
   Verifikasi counter kampanye seed kembali ke nilai fixture.
5. Set webhook URL dashboard ke `https://api.fundforindonesia.org/payments/webhook/sumopod`
   → Save & Test (harapkan `200 {status:"ignored"}`) → donasi mikro Rp10.000 uang
   nyata oleh owner → verifikasi `paid` + kuitansi.
6. `GET /payment-methods` prod = `["qris_redirect"]`; rotasi kredensial dev yang
   masih default (imgproxy key/salt, kredensial DB — lihat laporan baseline §5).
7. Reindex Meilisearch, verifikasi backup nightly berjalan, dan UAT terakhir hijau.

## Worker notifikasi (apps/worker) — status implementasi 2026-09-06
- Template `donation_receipt` (email HTML + teks + WA ringkas), klaim atomik,
  retry backoff eksponensial (maks 5 → `failed`), stale-skip, defer-WA-tanpa-config,
  `--once` — semua diuji (16 test), terverifikasi live via Mailpit.
- **Email**: siap. Kredensial SMTP Sumopod (host/port/user/pass) sudah di tangan;
  set `SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` di `.env.production` saat launch
  (rotasi Sumopod dibatalkan owner — pakai apa adanya, lihat item 3).
- **WhatsApp**: butuh akun kirim.dev (API key + sender ID) + template
  `donation_receipt` (params: nominal, judul campaign, link kuitansi) yang
  disetujui Meta. Tanpa `KIRIMDEV_API_KEY`, baris WA di-defer 30 menit
  **tanpa menaikkan attempts** — menunggu konfigurasi tanpa batas, tidak ada
  yang terkirim setengah dan tidak ada yang hangus jadi `failed`.
- Deploy: proses Bun `bun apps/worker/src/index.ts` + unit systemd
  `fundforindonesia-worker.service` (contoh di bawah) + pastikan migrasi 0021
  ikut `db:migrate` sebelum start pertama. Contoh unit (meniru api service):
  ```ini
  [Unit]
  Description=FundForIndonesia Notification Worker (Bun)
  After=network.target
  [Service]
  Type=simple
  WorkingDirectory=/home/ubuntu/galangdana/apps/worker
  EnvironmentFile=/home/ubuntu/galangdana/.env.production
  ExecStart=/home/ubuntu/.bun/bin/bun run src/index.ts
  Restart=on-failure
  RestartSec=3
  [Install]
  WantedBy=default.target
  ```
- Backlog outbox terverifikasi bersih 2026-09-06 (35 `skipped` otomatis,
  1 `pending` tanpa donasi ikut auto-skip). Aturan berjalan: sebelum worker
  prod pertama jalan, pastikan tak ada baris test berdonasi-valid (baris
  semacam itu IKUT terkirim bila tidak dibersihkan — lihat item 4).
