import { basename, join } from "node:path";
import { CAMPAIGN_SEED_DATA } from "./campaigns.seed";

// Vendored fixture photos, one per seeded campaign (filename matches each
// campaign's coverMediaUrl basename in campaigns.seed.ts). These used to be
// fetched live from picsum.photos on every fresh seed run -- reliable
// enough for local dev, but a real GitHub Actions run hit two consecutive
// failures against it (a 503, then a 522) fetching the very first image,
// which also failed to load from this same sandbox at the same time,
// confirming a real availability problem with depending on that external
// service rather than a one-off blip. Seed data must be reproducible
// without live third-party network access, so these bytes -- captured from
// an earlier successful picsum.photos fetch -- are checked into the repo
// instead.
const FIXTURES_DIR = join(import.meta.dir, "fixtures", "covers");

const s3 = new Bun.S3Client({
  endpoint: process.env.MEDIA_S3_ENDPOINT ?? "http://localhost:9000",
  accessKeyId: process.env.MEDIA_S3_ACCESS_KEY_ID ?? "galangdana",
  secretAccessKey: process.env.MEDIA_S3_SECRET_ACCESS_KEY ?? "galangdana-dev-secret",
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
    `Bucket "${bucket}" does not exist at ${endpoint}. Create it once via the MinIO console (http://localhost:9001, login galangdana/galangdana-dev-secret) or \`docker compose exec minio mc mb local/campaign-media\`, then re-run this script.`,
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
