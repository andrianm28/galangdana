# Rollback Runbook — FundForIndonesia

Satu halaman. CI tidak punya auto-rollback; semua langkah di bawah manual,
berurutan, dan masing-masing terverifikasi keterangannya.

## 1. Rollback deploy kode (kasus umum)

Setiap deploy = `git reset --hard origin/master` + migrate + reindex + build +
restart di `/home/ubuntu/ffi`. Rollback = langkah yang sama, mundur:

1. Tentukan commit baik terakhir: merge commit hijau sebelum deploy rusak
   (`gh run list --branch master`, ambil SHA yang CI-nya success).
2. `git fetch origin master && git reset --hard <SHA-baik>` di checkout live.
3. `bun install && bun --env-file=.env.production run db:migrate`
   (migrasi hanya maju; lihat §2 bila migrasi ikut rusak).
4. Reindex search (`bun --env-file=../../.env.production run src/reindex.ts`
   dari `packages/search`), `bun run build`.
5. Restart ketiga unit (`fundforindonesia-{api,web,worker}.service`),
   tunggu health-check manual: `/healthz` 200 + `/` 200 + menu pembayaran benar.
6. Cek GlitchTip 5 menit: tidak ada lonjakan issue baru.

Efek samping yang sudah terjadi dan diterima: deploy session-hash (PR #43)
me-logout semua user sekali; rollback forward/backward antar versi format
sesi mengulanginya. Bukan kegagalan — catat ke status bila perlu.

## 2. Rollback migrasi DB (migrasi hanya maju, tanpa down)

Drizzle tidak punya down-migration. Bila migrasi merusak data/skema:

1. **Berhenti**: jangan deploy kode lain; umumkan maintenance bila perlu.
2. Ambil dump terbaru dari `/home/ubuntu/fundforindonesia-backups/`
   (bukan dump `galangdana-*` kecuali rollback melewati 2026-09-05).
3. Restore ke database live (produksi = database yang sama dengan dev
   hari ini — satu-satunya DB di container `fundforindonesia-postgres-1`):
   `gunzip -c <dump> | docker exec -i fundforindonesia-postgres-1 psql -U fundforindonesia -d fundforindonesia`
4. Deploy kode pada commit yang cocok dengan skema hasil restore (§1).
5. Rekonsiliasi tulisan setelah jam dump: webhook pembayaran yang datang
   ulang aman diproses ulang (dedup `UNIQUE(provider, provider_event_id)`
   + mesin status monoton); donasi/kuitansi yang terbit di antaranya
   diverifikasi manual melawan dashboard Sumopod.

**Drill 2026-09-06: LULUS.** Restore dump ke `restore_drill_20260906`,
8/8 tabel identik dengan live (campaigns 453, donations 73, users 1846,
payments 27, outbox 46, sessions 141, disbursements 0, sum terkumpul sama),
scratch DB dihapus. Backup nightly terverifikasi jalan (cron
`/etc/cron.d/fundforindonesia-pg-backup`, dump 03:00 harian ±1 MB).

## 3. Yang TIDAK boleh disentuh saat rollback

- Volume `galangdana_*`: satu-satunya jalan pulang migrasi host; dihapus
  hanya oleh Task 11 rename plan, tidak lebih awal dari **2026-10-05**
  (soak 30 hari). Jangan `docker volume prune`.
- `campaign-media` / `campaign-documents`: tidak ada backup objek terpisah;
  jangan hapus objek saat panik. Kerusakan objek = insiden terpisah.
- Rotasi kredensial bukan rollback: jangan putar secret saat darurat
  kecuali kebocorannya adalah penyebab insiden.

## 4. Setelah pulih

Tulis 5 baris postmortem (pemicu, deteksi, aksi, durasi, pencegahan) ke
`docs/`; bila pemicunya pola kode (bukan ops), bugfix-nya lewat TDD +
PR seperti biasa, bukan hotfix langsung di host.
