import {
  CampaignDocumentSchema,
  CampaignDraftDetailSchema,
  CampaignDraftErrorSchema,
  CampaignDraftSchema,
  ConfirmDocumentUploadBodySchema,
  CreateCampaignDraftBodySchema,
  PresignDocumentUploadBodySchema,
  PresignDocumentUploadResponseSchema,
  SaveBeneficiaryBodySchema,
  SaveDraftAnswersBodySchema,
  SaveGuidedStoryBodySchema,
  SaveManualStoryBodySchema,
  SavePatientBodySchema,
} from "@fundforindonesia/contracts";
import {
  beneficiaries,
  campaignDocuments,
  campaignDrafts,
  campaignStoryAnswers,
  db,
  patients,
} from "@fundforindonesia/db";
import { and, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { sessionDerive } from "../lib/session";

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const ALLOWED_DOCUMENT_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];

const documentsS3 = new Bun.S3Client({
  endpoint: process.env.MEDIA_S3_ENDPOINT ?? "http://localhost:9000",
  accessKeyId: process.env.MEDIA_S3_ACCESS_KEY_ID ?? "fundforindonesia",
  secretAccessKey: process.env.MEDIA_S3_SECRET_ACCESS_KEY ?? "fundforindonesia-dev-secret",
  bucket: process.env.MEDIA_S3_PRIVATE_BUCKET ?? "campaign-documents",
  region: "us-east-1",
});

function extractExtension(fileName: string): string | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ext && ALLOWED_DOCUMENT_EXTENSIONS.includes(ext) ? ext : null;
}

// Shapes a raw campaignDrafts row into exactly the fields
// CampaignDraftSchema declares -- deliberately omits userId (a real DB
// column) since Eden Treaty's TypeScript inference reads this literal
// return shape, not the declared `response` schema, so a raw `{ ...draft }`
// spread would leak userId into every consumer's statically-inferred type
// even though Elysia's response schema already stripped it from the actual
// wire response.
function toDraftResponse(draft: typeof campaignDrafts.$inferSelect) {
  return {
    id: draft.id,
    track: draft.track,
    categoryId: draft.categoryId,
    currentStep: draft.currentStep,
    answers: draft.answers,
    expiresAt: draft.expiresAt.toISOString(),
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}

export const campaignDraftsRoute = new Elysia({ prefix: "/campaign-drafts" })
  .use(sessionDerive)
  .post(
    "/",
    async ({ user, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const [draft] = await db
        .insert(campaignDrafts)
        .values({
          userId: user.id,
          track: body.track,
          categoryId: body.categoryId,
          expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
        })
        .returning();
      if (!draft) {
        set.status = 500;
        return { error: "draft_creation_failed" };
      }
      return toDraftResponse(draft);
    },
    {
      body: CreateCampaignDraftBodySchema,
      response: {
        200: CampaignDraftSchema,
        401: CampaignDraftErrorSchema,
        500: CampaignDraftErrorSchema,
      },
    },
  )
  .get(
    "/:id",
    async ({ user, params, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const [draft] = await db
        .select()
        .from(campaignDrafts)
        .where(and(eq(campaignDrafts.id, params.id), eq(campaignDrafts.userId, user.id)));
      if (!draft) {
        set.status = 404;
        return { error: "draft_not_found" };
      }

      const [storyAnswers, documents, [patient], [beneficiary]] = await Promise.all([
        db
          .select({
            questionNumber: campaignStoryAnswers.questionNumber,
            answerText: campaignStoryAnswers.answerText,
          })
          .from(campaignStoryAnswers)
          .where(eq(campaignStoryAnswers.draftId, draft.id)),
        db.select().from(campaignDocuments).where(eq(campaignDocuments.draftId, draft.id)),
        db.select().from(patients).where(eq(patients.draftId, draft.id)),
        db.select().from(beneficiaries).where(eq(beneficiaries.draftId, draft.id)),
      ]);

      return {
        ...toDraftResponse(draft),
        storyAnswers,
        manualStory: typeof draft.answers.story === "string" ? draft.answers.story : null,
        patient: patient
          ? {
              name: patient.name,
              age: patient.age,
              illness: patient.illness,
              hospitalName: patient.hospitalName,
              relationshipToCampaigner: patient.relationshipToCampaigner,
            }
          : null,
        beneficiary: beneficiary
          ? {
              name: beneficiary.name,
              relationship: beneficiary.relationship,
              needDescription: beneficiary.needDescription,
            }
          : null,
        documents: documents.map((d) => ({
          id: d.id,
          type: d.type,
          objectKey: d.objectKey,
          uploadedAt: d.uploadedAt.toISOString(),
        })),
      };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: CampaignDraftDetailSchema,
        401: CampaignDraftErrorSchema,
        404: CampaignDraftErrorSchema,
      },
    },
  )
  .patch(
    "/:id/answers",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const [existing] = await db
        .select({ answers: campaignDrafts.answers })
        .from(campaignDrafts)
        .where(and(eq(campaignDrafts.id, params.id), eq(campaignDrafts.userId, user.id)));
      if (!existing) {
        set.status = 404;
        return { error: "draft_not_found" };
      }

      const [updated] = await db
        .update(campaignDrafts)
        .set({
          answers: { ...existing.answers, ...body.answers },
          currentStep: body.step,
          updatedAt: new Date(),
        })
        .where(eq(campaignDrafts.id, params.id))
        .returning();
      if (!updated) {
        set.status = 500;
        return { error: "draft_update_failed" };
      }

      return toDraftResponse(updated);
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: SaveDraftAnswersBodySchema,
      response: {
        200: CampaignDraftSchema,
        401: CampaignDraftErrorSchema,
        404: CampaignDraftErrorSchema,
        500: CampaignDraftErrorSchema,
      },
    },
  )
  .put(
    "/:id/story",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const [existing] = await db
        .select({ id: campaignDrafts.id, answers: campaignDrafts.answers })
        .from(campaignDrafts)
        .where(and(eq(campaignDrafts.id, params.id), eq(campaignDrafts.userId, user.id)));
      if (!existing) {
        set.status = 404;
        return { error: "draft_not_found" };
      }

      // Both modes clear the other's data first, so a draft never ends up
      // with both a guided answer set and a manual story simultaneously.
      await db.delete(campaignStoryAnswers).where(eq(campaignStoryAnswers.draftId, params.id));

      if (body.mode === "guided") {
        await db.insert(campaignStoryAnswers).values(
          body.answers.map((a) => ({
            draftId: params.id,
            questionNumber: a.questionNumber,
            answerText: a.answerText,
          })),
        );
        const { story: _removed, ...restAnswers } = existing.answers;
        await db
          .update(campaignDrafts)
          .set({ answers: restAnswers, updatedAt: new Date() })
          .where(eq(campaignDrafts.id, params.id));
      } else {
        await db
          .update(campaignDrafts)
          .set({ answers: { ...existing.answers, story: body.text }, updatedAt: new Date() })
          .where(eq(campaignDrafts.id, params.id));
      }

      return { success: true };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Union([SaveGuidedStoryBodySchema, SaveManualStoryBodySchema]),
      response: {
        200: t.Object({ success: t.Boolean() }),
        401: CampaignDraftErrorSchema,
        404: CampaignDraftErrorSchema,
      },
    },
  )
  .put(
    "/:id/patient",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const [draft] = await db
        .select({ id: campaignDrafts.id })
        .from(campaignDrafts)
        .where(and(eq(campaignDrafts.id, params.id), eq(campaignDrafts.userId, user.id)));
      if (!draft) {
        set.status = 404;
        return { error: "draft_not_found" };
      }

      await db
        .insert(patients)
        .values({ draftId: params.id, ...body })
        .onConflictDoUpdate({ target: patients.draftId, set: body });

      return { success: true };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: SavePatientBodySchema,
      response: {
        200: t.Object({ success: t.Boolean() }),
        401: CampaignDraftErrorSchema,
        404: CampaignDraftErrorSchema,
      },
    },
  )
  .put(
    "/:id/beneficiary",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const [draft] = await db
        .select({ id: campaignDrafts.id })
        .from(campaignDrafts)
        .where(and(eq(campaignDrafts.id, params.id), eq(campaignDrafts.userId, user.id)));
      if (!draft) {
        set.status = 404;
        return { error: "draft_not_found" };
      }

      await db
        .insert(beneficiaries)
        .values({ draftId: params.id, ...body })
        .onConflictDoUpdate({ target: beneficiaries.draftId, set: body });

      return { success: true };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: SaveBeneficiaryBodySchema,
      response: {
        200: t.Object({ success: t.Boolean() }),
        401: CampaignDraftErrorSchema,
        404: CampaignDraftErrorSchema,
      },
    },
  )
  .post(
    "/:id/documents/presign",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const [draft] = await db
        .select({ id: campaignDrafts.id })
        .from(campaignDrafts)
        .where(and(eq(campaignDrafts.id, params.id), eq(campaignDrafts.userId, user.id)));
      if (!draft) {
        set.status = 404;
        return { error: "draft_not_found" };
      }

      const ext = extractExtension(body.fileName);
      if (!ext) {
        set.status = 422;
        return { error: "unsupported_file_type" };
      }

      const objectKey = `drafts/${params.id}/${body.type}/${crypto.randomUUID()}.${ext}`;
      const expiresInSeconds = 300;
      const uploadUrl = documentsS3.file(objectKey).presign({
        method: "PUT",
        expiresIn: expiresInSeconds,
      });

      return { uploadUrl, objectKey, expiresInSeconds };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: PresignDocumentUploadBodySchema,
      response: {
        200: PresignDocumentUploadResponseSchema,
        401: CampaignDraftErrorSchema,
        404: CampaignDraftErrorSchema,
        422: CampaignDraftErrorSchema,
      },
    },
  )
  .post(
    "/:id/documents",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const [draft] = await db
        .select({ id: campaignDrafts.id })
        .from(campaignDrafts)
        .where(and(eq(campaignDrafts.id, params.id), eq(campaignDrafts.userId, user.id)));
      if (!draft) {
        set.status = 404;
        return { error: "draft_not_found" };
      }

      // Must match this draft's own presign prefix exactly -- rejects a
      // client confirming an objectKey it never legitimately received a
      // presigned URL for (see this task's brief).
      if (!body.objectKey.startsWith(`drafts/${params.id}/${body.type}/`)) {
        set.status = 400;
        return { error: "object_key_mismatch" };
      }

      const [document] = await db
        .insert(campaignDocuments)
        .values({ draftId: params.id, type: body.type, objectKey: body.objectKey })
        .returning();
      if (!document) {
        set.status = 500;
        return { error: "document_confirm_failed" };
      }

      return {
        id: document.id,
        type: document.type,
        objectKey: document.objectKey,
        uploadedAt: document.uploadedAt.toISOString(),
      };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: ConfirmDocumentUploadBodySchema,
      response: {
        200: CampaignDocumentSchema,
        400: CampaignDraftErrorSchema,
        401: CampaignDraftErrorSchema,
        404: CampaignDraftErrorSchema,
        500: CampaignDraftErrorSchema,
      },
    },
  );
