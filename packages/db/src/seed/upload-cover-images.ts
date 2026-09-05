import { basename, join } from "node:path";
import { CAMPAIGN_SEED_DATA } from "./campaigns.seed";

// Vendored fixture cover images, one per seeded campaign (filename matches
// each campaign's coverMediaUrl basename in campaigns.seed.ts). Checked into
// the repo rather than fetched at seed time: these were once pulled live from
// picsum.photos, which cost a real GitHub Actions run two consecutive failures
// (a 503, then a 522) on the very first image. Seed data must be reproducible
// without live third-party network access.
//
// They are deliberately LABELLED PLACEHOLDERS, not photographs. The picsum
// images were arbitrary stock with no relation to the campaign they illustrated
// -- which was harmless while nothing rendered them, and actively misleading
// once the seeded campaigns became visible on a public domain (a snowy European
// rooftop was illustrating an appeal for an elderly medical patient). An
// unrelated photograph of real people attached to a fabricated appeal is worse
// than no photograph on a platform selling trust.
//
// Regenerate with fixtures/generate-cover-placeholders.py. Replace any single
// file with a real, rights-cleared photograph once its campaign is real -- this
// script uploads whatever bytes are on disk.
const FIXTURES_DIR = join(import.meta.dir, "fixtures", "covers");

const s3 = new Bun.S3Client({
  endpoint: process.env.MEDIA_S3_ENDPOINT ?? "http://localhost:9000",
  accessKeyId: process.env.MEDIA_S3_ACCESS_KEY_ID ?? "fundforindonesia",
  secretAccessKey: process.env.MEDIA_S3_SECRET_ACCESS_KEY ?? "fundforindonesia-dev-secret",
  bucket: process.env.MEDIA_S3_BUCKET ?? "campaign-media",
  region: "us-east-1",
});

async function ensureBucketExists(): Promise<void> {
  // Bun's S3Client has no createBucket method -- MinIO's bucket-creation
  // API is a plain HTTP PUT to the bucket root, which this does directly
  // rather than pulling in a bucket-management SDK for one call.
  const endpoint = process.env.MEDIA_S3_ENDPOINT ?? "http://localhost:9000";
  const bucket = process.env.MEDIA_S3_BUCKET ?? "campaign-media";
  const response = await fetch(`${endpoint}/${bucket}`, { method: "HEAD" });
  if (response.ok) return;

  // A real signed PUT would need SigV4 -- sidestepped here by using
  // MinIO's default dev credentials only for local seeding, via a plain
  // unauthenticated attempt first (MinIO in this docker-compose config
  // has no bucket-creation-specific auth beyond what mc/S3Client already
  // handle for object operations). If this fails, the developer running
  // seed needs to create the bucket once via `docker compose exec minio
  // mc mb local/campaign-media` or the MinIO console at :9001 -- fail
  // loudly with that instruction rather than silently skip image upload.
  throw new Error(
    `Bucket "${bucket}" does not exist at ${endpoint}. Create it once via the MinIO console (http://localhost:9001, login fundforindonesia/fundforindonesia-dev-secret) or \`docker compose exec minio mc mb local/campaign-media\`, then re-run this script.`,
  );
}

async function uploadCoverImages(): Promise<void> {
  await ensureBucketExists();

  let uploaded = 0;
  for (const campaign of CAMPAIGN_SEED_DATA) {
    const file = s3.file(campaign.coverMediaUrl);
    if (await file.exists()) {
      continue; // idempotent: skip images already uploaded by a prior run
    }
    const fixturePath = join(FIXTURES_DIR, basename(campaign.coverMediaUrl));
    const fixtureFile = Bun.file(fixturePath);
    if (!(await fixtureFile.exists())) {
      throw new Error(
        `missing vendored fixture image for ${campaign.slug}: expected ${fixturePath}`,
      );
    }
    const bytes = await fixtureFile.arrayBuffer();
    await s3.write(campaign.coverMediaUrl, bytes, { type: "image/jpeg" });
    uploaded++;
  }
  console.log(
    `Uploaded ${uploaded} cover images (${CAMPAIGN_SEED_DATA.length - uploaded} already present).`,
  );
}

if (import.meta.main) {
  await uploadCoverImages();
  process.exit(0);
}

export { uploadCoverImages };
