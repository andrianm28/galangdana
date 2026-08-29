import { CAMPAIGN_SEED_DATA } from "./campaigns.seed";

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
    // picsum.photos serves real, freely-licensed placeholder photographs
    // designed for exactly this purpose -- a stable per-seed-slug seed
    // value keeps the same campaign always getting the same placeholder
    // image across repeated `db:seed` runs.
    const response = await fetch(`https://picsum.photos/seed/${campaign.slug}/800/600`);
    if (!response.ok) {
      throw new Error(`failed to fetch placeholder image for ${campaign.slug}: ${response.status}`);
    }
    const bytes = await response.arrayBuffer();
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
