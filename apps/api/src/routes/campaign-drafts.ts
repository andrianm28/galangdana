import {
  CampaignDraftDetailSchema,
  CampaignDraftErrorSchema,
  CampaignDraftSchema,
  CreateCampaignDraftBodySchema,
  SaveDraftAnswersBodySchema,
} from "@galangdana/contracts";
import {
  beneficiaries,
  campaignDocuments,
  campaignDrafts,
  campaignStoryAnswers,
  db,
  patients,
} from "@galangdana/db";
import { and, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { sessionDerive } from "../lib/session";

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
      return {
        ...draft,
        expiresAt: draft.expiresAt.toISOString(),
        createdAt: draft.createdAt.toISOString(),
        updatedAt: draft.updatedAt.toISOString(),
      };
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
        ...draft,
        expiresAt: draft.expiresAt.toISOString(),
        createdAt: draft.createdAt.toISOString(),
        updatedAt: draft.updatedAt.toISOString(),
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
      params: t.Object({ id: t.String() }),
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

      return {
        ...updated,
        expiresAt: updated.expiresAt.toISOString(),
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
    {
      params: t.Object({ id: t.String() }),
      body: SaveDraftAnswersBodySchema,
      response: {
        200: CampaignDraftSchema,
        401: CampaignDraftErrorSchema,
        404: CampaignDraftErrorSchema,
        500: CampaignDraftErrorSchema,
      },
    },
  );
