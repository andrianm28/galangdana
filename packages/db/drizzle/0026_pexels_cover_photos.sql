-- Point the eight seeded campaigns at their new Pexels cover photographs.
--
-- Third instance of the same trap in one week, so stating it plainly: editing a
-- `*.seed.ts` file changes NOTHING on a database that has already been seeded.
-- run-seed.ts is `.onConflictDoNothing()`, so it cannot update an existing row --
-- 0024 had to force the category archival, 0025 had to delete the zakat/wakaf
-- duplicates a slug rename created, and this one has to carry the new
-- cover_media_url values across. Without it the rows keep pointing at the old
-- placeholder filenames, whose objects no longer exist in MinIO, and every cover
-- on the homepage 404s.
--
-- Filenames are content-addressed (`<base>.<sha256[:8]>.jpg`), so they change
-- whenever a photo is swapped and this migration is only correct for THIS set.
-- Values copied verbatim from campaigns.seed.ts; seed-covers.test.ts asserts
-- that file and fixtures/covers/ agree in both directions.
--
-- Keyed on slug and idempotent: re-running is a no-op, and on a freshly seeded
-- database every row already holds these exact values.
--
-- The images themselves carry a baked-in "FOTO ILUSTRASI" mark. These eight
-- campaigns are fixtures, not real appeals, and the disclosure has to survive
-- into anywhere the file is rendered -- see fixtures/fetch-pexels-covers.py.

UPDATE "campaigns" SET "cover_media_url" = 'campaigns/covers/banjir-kalimantan-selatan.29da285b.jpg'
WHERE "slug" = 'bantu-korban-banjir-bandang-kalimantan-selatan';
--> statement-breakpoint
UPDATE "campaigns" SET "cover_media_url" = 'campaigns/covers/aldi-kelainan-jantung.cf14294f.jpg'
WHERE "slug" = 'uluran-tangan-untuk-aldi-kelainan-jantung';
--> statement-breakpoint
UPDATE "campaigns" SET "cover_media_url" = 'campaigns/covers/renovasi-musala-al-ikhlas.1fcf0b37.jpg'
WHERE "slug" = 'renovasi-musala-al-ikhlas';
--> statement-breakpoint
UPDATE "campaigns" SET "cover_media_url" = 'campaigns/covers/pangan-keluarga-prasejahtera.f0a56ce1.jpg'
WHERE "slug" = 'pangan-keluarga-prasejahtera';
--> statement-breakpoint
UPDATE "campaigns" SET "cover_media_url" = 'campaigns/covers/sumur-bor-desa-kering.0fa017ce.jpg'
WHERE "slug" = 'sumur-bor-desa-kering';
--> statement-breakpoint
UPDATE "campaigns" SET "cover_media_url" = 'campaigns/covers/panti-asuhan-kasih-bunda.eaf3339b.jpg'
WHERE "slug" = 'bantu-panti-asuhan-kasih-bunda';
--> statement-breakpoint
UPDATE "campaigns" SET "cover_media_url" = 'campaigns/covers/beasiswa-anak-yatim.88ba613c.jpg'
WHERE "slug" = 'beasiswa-anak-yatim-berprestasi';
--> statement-breakpoint
UPDATE "campaigns" SET "cover_media_url" = 'campaigns/covers/nenek-sari-pengobatan.50eb40b3.jpg'
WHERE "slug" = 'pengobatan-darurat-nenek-sari';
