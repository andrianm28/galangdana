import {
  CampaignDetailSchema,
  CampaignErrorSchema,
  CampaignListQuerySchema,
  CampaignListResponseSchema,
  CampaignRevisionListResponseSchema,
  ConfirmCampaignDocumentBodySchema,
  ConfirmKycDocumentBodySchema,
  CreateCampaignFromDraftBodySchema,
  CreateCampaignFromDraftResponseSchema,
  KycStatusSchema,
  MyCampaignsResponseSchema,
  PresignCampaignDocumentBodySchema,
  PresignCampaignDocumentResponseSchema,
  PresignKycDocumentBodySchema,
  PresignKycDocumentResponseSchema,
  PublicDisbursementLogResponseSchema,
  SaveCampaignGoalAmountBodySchema,
  SaveCampaignStoryBodySchema,
  SaveKycContactBodySchema,
  SaveKycIdentityBodySchema,
  SubmitCampaignResponseSchema,
} from "@galangdana/contracts";
import {
  campaignCategories,
  campaignDocuments,
  campaignDrafts,
  campaignRevisions,
  campaignStoryAnswers,
  campaigners,
  campaigns,
  db,
  disbursementRequests,
  individualVerifications,
} from "@galangdana/db";
import { moneyToJSON } from "@galangdana/money";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { toCampaignDetail, toCampaignSummary } from "../lib/campaign-response";
import { getOrCreateCampaignerForUser } from "../lib/campaigner";
import { extractDocumentExtension, privateDocumentsS3 } from "../lib/media-s3";
import { sessionDerive } from "../lib/session";
import { generateUniqueSlug } from "../lib/slug";

const DEFAULT_LIMIT = 12;

const ALLOWED_KYC_EXTENSIONS = ["jpg", "jpeg", "png"];

const kycDocumentsS3 = new Bun.S3Client({
  endpoint: process.env.MEDIA_S3_ENDPOINT ?? "http://localhost:9000",
  accessKeyId: process.env.MEDIA_S3_ACCESS_KEY_ID ?? "galangdana",
  secretAccessKey: process.env.MEDIA_S3_SECRET_ACCESS_KEY ?? "galangdana-dev-secret",
  bucket: process.env.MEDIA_S3_PRIVATE_BUCKET ?? "campaign-documents",
  region: "us-east-1",
});

function extractKycExtension(fileName: string): string | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ext && ALLOWED_KYC_EXTENSIONS.includes(ext) ? ext : null;
}

async function findOwnedCampaign(campaignId: string, userId: string) {
  const [campaigner] = await db
    .select({ id: campaigners.id })
    .from(campaigners)
    .where(eq(campaigners.userId, userId));
  if (!campaigner) return null;
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.campaignerId, campaigner.id)));
  return campaign ?? null;
}

export const campaignsRoute = new Elysia()
  .use(sessionDerive)
  .get(
    "/campaigns",
    async ({ query, set }) => {
      const page = query.page ?? 1;
      const limit = query.limit ?? DEFAULT_LIMIT;
      const offset = (page - 1) * limit;

      const conditions = [eq(campaigns.status, "active")];
      if (query.category) {
        const [category] = await db
          .select()
          .from(campaignCategories)
          .where(eq(campaignCategories.slug, query.category));
        if (!category) {
          set.status = 404;
          return { error: "category_not_found" };
        }
        conditions.push(eq(campaigns.categoryId, category.id));
      }
      if (query.campaignerType) {
        conditions.push(eq(campaigners.type, query.campaignerType));
      }

      // "urgent": goal-model campaigns with the soonest deadline first;
      // program-model campaigns (expiresAt is always NULL for them) sort
      // last, since "urgency" has no meaning without a deadline. NULLS
      // LAST is Postgres's default for ASC, but stated explicitly here so
      // the intent survives a future sort-expression refactor.
      //
      // `campaigns.id` as a secondary key makes both orderings fully
      // deterministic: without it, two rows with an equal (or equal-at-
      // storage-precision) primary sort value have no guaranteed relative
      // order, which surfaced as real, intermittent CI failures once the
      // test suite grew large enough to produce near-simultaneous
      // `publishedAt` timestamps across different test files sharing one
      // database.
      const orderBy =
        query.sort === "urgent"
          ? [sql`${campaigns.expiresAt} ASC NULLS LAST`, campaigns.id]
          : [desc(campaigns.publishedAt), campaigns.id];

      const whereClause = and(...conditions);

      const [rows, countRows] = await Promise.all([
        db
          .select({ campaign: campaigns, category: campaignCategories, campaigner: campaigners })
          .from(campaigns)
          .innerJoin(campaignCategories, eq(campaigns.categoryId, campaignCategories.id))
          .innerJoin(campaigners, eq(campaigns.campaignerId, campaigners.id))
          .where(whereClause)
          .orderBy(...orderBy)
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(campaigns)
          .innerJoin(campaigners, eq(campaigns.campaignerId, campaigners.id))
          .where(whereClause),
      ]);
      // count(*) with no GROUP BY always returns exactly one row (count: 0
      // for no matches), so this fallback is unreachable in practice -- it
      // exists only to satisfy noUncheckedIndexedAccess without an unsafe
      // non-null assertion, matching the `if (!category)` guard style above.
      const count = countRows[0]?.count ?? 0;

      const summaries = await Promise.all(rows.map(toCampaignSummary));

      return {
        campaigns: summaries,
        page,
        totalPages: Math.max(1, Math.ceil(count / limit)),
        totalCount: count,
      };
    },
    {
      query: CampaignListQuerySchema,
      response: { 200: CampaignListResponseSchema, 404: CampaignErrorSchema },
    },
  )
  .post(
    "/campaigns",
    async ({ user, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }

      const [draft] = await db
        .select()
        .from(campaignDrafts)
        .where(and(eq(campaignDrafts.id, body.draftId), eq(campaignDrafts.userId, user.id)));
      if (!draft) {
        set.status = 404;
        return { error: "draft_not_found" };
      }

      const title = typeof draft.answers.title === "string" ? draft.answers.title : null;
      const shortDescription =
        typeof draft.answers.purpose === "string" ? draft.answers.purpose : null;
      const goalAmountStr =
        typeof draft.answers.goalAmountStr === "string" && /^\d+$/.test(draft.answers.goalAmountStr)
          ? draft.answers.goalAmountStr
          : null;
      if (!title || !shortDescription || !goalAmountStr || !draft.categoryId) {
        set.status = 400;
        return { error: "draft_incomplete" };
      }

      const [existing] = await db.select().from(campaigns).where(eq(campaigns.draftId, draft.id));
      if (existing) {
        return { id: existing.id, slug: existing.slug };
      }

      const storyAnswers = await db
        .select({
          questionNumber: campaignStoryAnswers.questionNumber,
          answerText: campaignStoryAnswers.answerText,
        })
        .from(campaignStoryAnswers)
        .where(eq(campaignStoryAnswers.draftId, draft.id));
      const story =
        storyAnswers.length > 0
          ? storyAnswers
              .sort((a, b) => a.questionNumber - b.questionNumber)
              .map((a) => a.answerText)
              .join("\n\n")
          : typeof draft.answers.story === "string"
            ? draft.answers.story
            : "";

      const campaigner = await getOrCreateCampaignerForUser(user.id);
      const slug = await generateUniqueSlug(title);

      const [campaign] = await db
        .insert(campaigns)
        .values({
          slug,
          title,
          shortDescription,
          story,
          categoryId: draft.categoryId,
          campaignerId: campaigner.id,
          type: "donation",
          currency: "IDR",
          model: "goal",
          goalAmount: BigInt(goalAmountStr),
          draftId: draft.id,
        })
        .returning();
      if (!campaign) {
        set.status = 500;
        return { error: "campaign_creation_failed" };
      }

      return { id: campaign.id, slug: campaign.slug };
    },
    {
      body: CreateCampaignFromDraftBodySchema,
      response: {
        200: CreateCampaignFromDraftResponseSchema,
        400: CampaignErrorSchema,
        401: CampaignErrorSchema,
        404: CampaignErrorSchema,
        500: CampaignErrorSchema,
      },
    },
  )
  .get(
    "/campaigns/:slug",
    async ({ params, set }) => {
      const [row] = await db
        .select({ campaign: campaigns, category: campaignCategories, campaigner: campaigners })
        .from(campaigns)
        .innerJoin(campaignCategories, eq(campaigns.categoryId, campaignCategories.id))
        .innerJoin(campaigners, eq(campaigns.campaignerId, campaigners.id))
        .where(and(eq(campaigns.slug, params.slug), eq(campaigns.status, "active")));

      if (!row) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }

      return toCampaignDetail(row);
    },
    { response: { 200: CampaignDetailSchema, 404: CampaignErrorSchema } },
  )
  .put(
    "/campaigns/:id/kyc/identity",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const campaign = await findOwnedCampaign(params.id, user.id);
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }
      if (campaign.status !== "draft" && campaign.status !== "needs_revision") {
        set.status = 409;
        return { error: "campaign_not_editable" };
      }

      await db
        .insert(individualVerifications)
        .values({
          campaignId: campaign.id,
          fullName: body.fullName,
          nationalId: body.nationalId,
          dateOfBirth: body.dateOfBirth,
          address: "",
          city: "",
          postalCode: "",
        })
        .onConflictDoUpdate({
          target: individualVerifications.campaignId,
          set: {
            fullName: body.fullName,
            nationalId: body.nationalId,
            dateOfBirth: body.dateOfBirth,
            updatedAt: new Date(),
          },
        });

      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: SaveKycIdentityBodySchema,
      response: {
        200: t.Object({ success: t.Boolean() }),
        401: CampaignErrorSchema,
        404: CampaignErrorSchema,
        409: CampaignErrorSchema,
      },
    },
  )
  .put(
    "/campaigns/:id/kyc/contact",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const campaign = await findOwnedCampaign(params.id, user.id);
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }
      if (campaign.status !== "draft" && campaign.status !== "needs_revision") {
        set.status = 409;
        return { error: "campaign_not_editable" };
      }

      await db
        .insert(individualVerifications)
        .values({
          campaignId: campaign.id,
          fullName: "",
          nationalId: "",
          dateOfBirth: "",
          address: body.address,
          city: body.city,
          postalCode: body.postalCode,
        })
        .onConflictDoUpdate({
          target: individualVerifications.campaignId,
          set: {
            address: body.address,
            city: body.city,
            postalCode: body.postalCode,
            updatedAt: new Date(),
          },
        });

      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: SaveKycContactBodySchema,
      response: {
        200: t.Object({ success: t.Boolean() }),
        401: CampaignErrorSchema,
        404: CampaignErrorSchema,
        409: CampaignErrorSchema,
      },
    },
  )
  .post(
    "/campaigns/:id/kyc/documents/presign",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const campaign = await findOwnedCampaign(params.id, user.id);
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }

      const ext = extractKycExtension(body.fileName);
      if (!ext) {
        set.status = 422;
        return { error: "unsupported_file_type" };
      }

      const objectKey = `kyc/${params.id}/${body.documentType}/${crypto.randomUUID()}.${ext}`;
      const expiresInSeconds = 300;
      const uploadUrl = kycDocumentsS3
        .file(objectKey)
        .presign({ method: "PUT", expiresIn: expiresInSeconds });

      return { uploadUrl, objectKey, expiresInSeconds };
    },
    {
      params: t.Object({ id: t.String() }),
      body: PresignKycDocumentBodySchema,
      response: {
        200: PresignKycDocumentResponseSchema,
        401: CampaignErrorSchema,
        404: CampaignErrorSchema,
        422: CampaignErrorSchema,
      },
    },
  )
  .post(
    "/campaigns/:id/kyc/documents/confirm",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const campaign = await findOwnedCampaign(params.id, user.id);
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }
      if (campaign.status !== "draft" && campaign.status !== "needs_revision") {
        set.status = 409;
        return { error: "campaign_not_editable" };
      }

      if (!body.objectKey.startsWith(`kyc/${params.id}/${body.documentType}/`)) {
        set.status = 400;
        return { error: "object_key_mismatch" };
      }

      const column = body.documentType === "ktp" ? "ktpObjectKey" : "selfieObjectKey";
      await db
        .insert(individualVerifications)
        .values({
          campaignId: campaign.id,
          fullName: "",
          nationalId: "",
          dateOfBirth: "",
          address: "",
          city: "",
          postalCode: "",
          [column]: body.objectKey,
        })
        .onConflictDoUpdate({
          target: individualVerifications.campaignId,
          set: { [column]: body.objectKey, updatedAt: new Date() },
        });

      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: ConfirmKycDocumentBodySchema,
      response: {
        200: t.Object({ success: t.Boolean() }),
        400: CampaignErrorSchema,
        401: CampaignErrorSchema,
        404: CampaignErrorSchema,
        409: CampaignErrorSchema,
      },
    },
  )
  .get(
    // Path param is named ":slug" (not ":id") solely to match the existing
    // GET /campaigns/:slug route's param name at this same trie position --
    // memoirist (Elysia's router) requires a consistent param name per HTTP
    // method at a shared position, even though this route's continuation
    // ("/kyc") differs. The value is actually a campaign id, not a slug.
    "/campaigns/:slug/kyc",
    async ({ user, params, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const campaign = await findOwnedCampaign(params.slug, user.id);
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }

      const [verification] = await db
        .select()
        .from(individualVerifications)
        .where(eq(individualVerifications.campaignId, campaign.id));

      return {
        campaignId: campaign.id,
        campaignTitle: campaign.title,
        campaignSlug: campaign.slug,
        campaignStatus: campaign.status,
        fullName: verification?.fullName || null,
        nationalId: verification?.nationalId || null,
        dateOfBirth: verification?.dateOfBirth || null,
        address: verification?.address || null,
        city: verification?.city || null,
        postalCode: verification?.postalCode || null,
        ktpObjectKey: verification?.ktpObjectKey ?? null,
        selfieObjectKey: verification?.selfieObjectKey ?? null,
        consentedAt: verification?.consentedAt?.toISOString() ?? null,
      };
    },
    {
      params: t.Object({ slug: t.String() }),
      response: {
        200: KycStatusSchema,
        401: CampaignErrorSchema,
        404: CampaignErrorSchema,
      },
    },
  )
  .post(
    "/campaigns/:id/submit",
    async ({ user, params, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const campaign = await findOwnedCampaign(params.id, user.id);
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }

      if (campaign.status === "pending_review") {
        return { status: campaign.status };
      }

      if (campaign.status !== "draft" && campaign.status !== "needs_revision") {
        set.status = 409;
        return { error: "invalid_campaign_status" };
      }

      const [verification] = await db
        .select()
        .from(individualVerifications)
        .where(eq(individualVerifications.campaignId, campaign.id));
      if (
        !verification?.ktpObjectKey ||
        !verification?.selfieObjectKey ||
        !verification?.fullName?.trim() ||
        !verification?.nationalId?.trim() ||
        !verification?.dateOfBirth?.trim() ||
        !verification?.address?.trim() ||
        !verification?.city?.trim() ||
        !verification?.postalCode?.trim()
      ) {
        set.status = 400;
        return { error: "kyc_incomplete" };
      }

      const now = new Date();
      await db
        .update(campaigns)
        .set({ status: "pending_review", submittedAt: now, updatedAt: now })
        .where(eq(campaigns.id, campaign.id));
      await db
        .update(campaignRevisions)
        .set({ status: "resolved", resolvedAt: now })
        .where(
          and(eq(campaignRevisions.campaignId, campaign.id), eq(campaignRevisions.status, "open")),
        );

      return { status: "pending_review" };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: SubmitCampaignResponseSchema,
        400: CampaignErrorSchema,
        401: CampaignErrorSchema,
        404: CampaignErrorSchema,
        409: CampaignErrorSchema,
      },
    },
  )
  .get(
    // Path param is named ":slug" (not ":id") solely to match the existing
    // GET /campaigns/:slug route's param name at this same trie position --
    // memoirist (Elysia's router) requires a consistent param name per HTTP
    // method at a shared position, even though this route's continuation
    // ("/revisions") differs. The value is actually a campaign id, not a slug.
    "/campaigns/:slug/revisions",
    async ({ user, params, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const campaign = await findOwnedCampaign(params.slug, user.id);
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }

      const revisions = await db
        .select()
        .from(campaignRevisions)
        .where(eq(campaignRevisions.campaignId, campaign.id))
        .orderBy(desc(campaignRevisions.createdAt));

      return {
        story: campaign.story,
        goalAmount: campaign.goalAmount
          ? { amount: campaign.goalAmount.toString(), currency: campaign.currency }
          : null,
        revisions: revisions.map((rev) => ({
          id: rev.id,
          field: rev.field,
          note: rev.note,
          status: rev.status,
          createdAt: rev.createdAt.toISOString(),
          resolvedAt: rev.resolvedAt?.toISOString() ?? null,
        })),
      };
    },
    {
      params: t.Object({ slug: t.String() }),
      response: {
        200: CampaignRevisionListResponseSchema,
        401: CampaignErrorSchema,
        404: CampaignErrorSchema,
      },
    },
  )
  .put(
    "/campaigns/:id/story",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const campaign = await findOwnedCampaign(params.id, user.id);
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }
      if (campaign.status !== "draft" && campaign.status !== "needs_revision") {
        set.status = 409;
        return { error: "campaign_not_editable" };
      }

      await db
        .update(campaigns)
        .set({ story: body.story, updatedAt: new Date() })
        .where(eq(campaigns.id, campaign.id));

      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: SaveCampaignStoryBodySchema,
      response: {
        200: t.Object({ success: t.Boolean() }),
        401: CampaignErrorSchema,
        404: CampaignErrorSchema,
        409: CampaignErrorSchema,
      },
    },
  )
  .put(
    "/campaigns/:id/goal-amount",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const campaign = await findOwnedCampaign(params.id, user.id);
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }
      if (campaign.status !== "draft" && campaign.status !== "needs_revision") {
        set.status = 409;
        return { error: "campaign_not_editable" };
      }

      await db
        .update(campaigns)
        .set({ goalAmount: BigInt(body.goalAmountStr), updatedAt: new Date() })
        .where(eq(campaigns.id, campaign.id));

      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: SaveCampaignGoalAmountBodySchema,
      response: {
        200: t.Object({ success: t.Boolean() }),
        401: CampaignErrorSchema,
        404: CampaignErrorSchema,
        409: CampaignErrorSchema,
      },
    },
  )
  .post(
    "/campaigns/:id/documents/presign",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const campaign = await findOwnedCampaign(params.id, user.id);
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }
      if (campaign.status !== "draft" && campaign.status !== "needs_revision") {
        set.status = 409;
        return { error: "campaign_not_editable" };
      }

      const ext = extractDocumentExtension(body.fileName);
      if (!ext) {
        set.status = 422;
        return { error: "unsupported_file_type" };
      }

      const objectKey = `campaigns/${campaign.id}/documents/${body.documentType}/${crypto.randomUUID()}.${ext}`;
      const expiresInSeconds = 300;
      const uploadUrl = privateDocumentsS3
        .file(objectKey)
        .presign({ method: "PUT", expiresIn: expiresInSeconds });

      return { uploadUrl, objectKey, expiresInSeconds };
    },
    {
      params: t.Object({ id: t.String() }),
      body: PresignCampaignDocumentBodySchema,
      response: {
        200: PresignCampaignDocumentResponseSchema,
        401: CampaignErrorSchema,
        404: CampaignErrorSchema,
        409: CampaignErrorSchema,
        422: CampaignErrorSchema,
      },
    },
  )
  .post(
    "/campaigns/:id/documents/confirm",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const campaign = await findOwnedCampaign(params.id, user.id);
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }
      if (campaign.status !== "draft" && campaign.status !== "needs_revision") {
        set.status = 409;
        return { error: "campaign_not_editable" };
      }

      if (!body.objectKey.startsWith(`campaigns/${campaign.id}/documents/${body.documentType}/`)) {
        set.status = 400;
        return { error: "object_key_mismatch" };
      }

      await db
        .insert(campaignDocuments)
        .values({ campaignId: campaign.id, type: body.documentType, objectKey: body.objectKey });

      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: ConfirmCampaignDocumentBodySchema,
      response: {
        200: t.Object({ success: t.Boolean() }),
        400: CampaignErrorSchema,
        401: CampaignErrorSchema,
        404: CampaignErrorSchema,
        409: CampaignErrorSchema,
      },
    },
  )
  .get(
    "/campaigns/mine",
    async ({ user, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const [campaigner] = await db
        .select({ id: campaigners.id })
        .from(campaigners)
        .where(eq(campaigners.userId, user.id));
      if (!campaigner) {
        return { campaigns: [] };
      }

      const rows = await db
        .select({
          id: campaigns.id,
          slug: campaigns.slug,
          title: campaigns.title,
          status: campaigns.status,
        })
        .from(campaigns)
        .where(eq(campaigns.campaignerId, campaigner.id));

      return { campaigns: rows };
    },
    { response: { 200: MyCampaignsResponseSchema, 401: CampaignErrorSchema } },
  )
  .get(
    "/campaigns/:slug/disbursements",
    async ({ params, set }) => {
      const [campaign] = await db.select().from(campaigns).where(eq(campaigns.slug, params.slug));
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }
      const rows = await db
        .select()
        .from(disbursementRequests)
        .where(
          and(
            eq(disbursementRequests.campaignId, campaign.id),
            eq(disbursementRequests.status, "paid"),
          ),
        )
        .orderBy(desc(disbursementRequests.paidAt));
      return {
        disbursements: rows.map((row) => ({
          // biome-ignore lint/style/noNonNullAssertion: status "paid" implies these are set
          type: row.type!,
          // biome-ignore lint/style/noNonNullAssertion: status "paid" implies these are set
          amount: moneyToJSON({ amount: row.amount!, currency: row.currency! }),
          narrative: row.narrative ?? "",
          // biome-ignore lint/style/noNonNullAssertion: status "paid" implies paidAt is set
          paidAt: row.paidAt!.toISOString(),
        })),
      };
    },
    {
      params: t.Object({ slug: t.String() }),
      response: { 200: PublicDisbursementLogResponseSchema, 404: CampaignErrorSchema },
    },
  );
