import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { CAMPAIGN_SEED_DATA } from "../seed/campaigns.seed";

// Guards against the exact class of bug that shipped a cover reading "ZAKAT /
// Program Amil Zakat Mitra" under a renamed, non-zakat campaign: covers are
// placeholder JPEGs with the campaign title and category name rendered
// directly into the pixels (see generate-cover-placeholders.py), so renaming
// a seed row while forgetting to regenerate its cover is invisible to every
// other test -- the coverMediaUrl string still resolves to a real file, it's
// just the wrong picture. A bidirectional check catches both halves of that:
// a seed row pointing at a file that doesn't exist, and a leftover file (like
// the old zakat/wakaf covers) that nothing points at anymore.
describe("seed cover fixtures", () => {
  const coversDir = `${import.meta.dir}/../seed/fixtures/covers`;

  test("every seeded coverMediaUrl names a file that exists in fixtures/covers/", async () => {
    const filesOnDisk = new Set(await readdir(coversDir));
    for (const seed of CAMPAIGN_SEED_DATA) {
      const filename = seed.coverMediaUrl.replace(/^campaigns\/covers\//, "");
      expect(filesOnDisk.has(filename)).toBe(true);
    }
  });

  test("every file in fixtures/covers/ is referenced by a seed row", async () => {
    const filesOnDisk = await readdir(coversDir);
    const referenced = new Set(
      CAMPAIGN_SEED_DATA.map((seed) => seed.coverMediaUrl.replace(/^campaigns\/covers\//, "")),
    );
    for (const file of filesOnDisk) {
      expect(referenced.has(file)).toBe(true);
    }
  });
});
