-- Delete the two leftover zakat/wakaf seed campaigns from databases that were
-- seeded before those fixtures were rewritten.
--
-- What actually happened, verified against production rather than assumed:
--
-- campaigns.seed.ts was rewritten to replace the zakat and wakaf fixtures when
-- the stakeholder cut both from the product. run-seed.ts is
-- `.onConflictDoNothing()` and conflicts on SLUG -- and the rewrite changed the
-- slugs. So on an already-seeded database the new entries did not "replace"
-- anything: they were inserted as brand-new rows alongside the originals, which
-- nothing then removed. Production ended up serving BOTH:
--
--   program-amil-zakat-mitra              "Dana Zakat Yayasan Amanah Ummah"
--   pangan-keluarga-prasejahtera          "Bantuan Pangan untuk Keluarga Prasejahtera"
--   wakaf-produktif-sumur-bor-desa-kering "Wakaf Produktif: Sumur Bor ..."
--   sumur-bor-desa-kering                 "Sumur Bor untuk Desa yang Kekeringan"
--
-- with identical collected_amount and donation_count in each pair -- the same
-- fixture twice, once under its retired identity. Both legacy rows were
-- status='active', reachable at their original URLs, and still returned by
-- GET /search?q=zakat and ?q=wakaf with their original amil/asnaf and wakaf
-- copy. Archiving their categories in 0024 hid them from category browsing and
-- did nothing about the campaigns themselves.
--
-- An earlier draft of this migration tried to UPDATE the legacy rows into the
-- new identity. That fails with campaigns_slug_unique, precisely because the
-- replacement rows are already there. Deleting is both correct and what the
-- data actually calls for.
--
-- Safe to delete: confirmed on production that both legacy rows have zero
-- donations, prayers, disbursement_requests, campaign_documents and
-- campaign_revisions. Nothing references them.
--
-- Guarded on the replacement existing, so this can never remove a fixture
-- without its successor in place, and is a no-op on a database seeded after the
-- rewrite (where the legacy slugs never existed at all).

DELETE FROM "campaigns"
WHERE "slug" = 'program-amil-zakat-mitra'
  AND EXISTS (SELECT 1 FROM "campaigns" WHERE "slug" = 'pangan-keluarga-prasejahtera');
--> statement-breakpoint
DELETE FROM "campaigns"
WHERE "slug" = 'wakaf-produktif-sumur-bor-desa-kering'
  AND EXISTS (SELECT 1 FROM "campaigns" WHERE "slug" = 'sumur-bor-desa-kering');
