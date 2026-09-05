import {
  AdminActionResponseSchema,
  AdminCampaignDetailResponseSchema,
  AdminCampaignListResponseSchema,
  AdminRequestRevisionBodySchema,
  CampaignErrorSchema,
} from "@fundforindonesia/contracts";
import {
  campaignCategories,
  campaignDocuments,
  campaignRevisions,
  type campaignStatusEnum,
  campaigners,
  campaigns,
  db,
  individualVerifications,
} from "@fundforindonesia/db";
import { syncCampaignsIndex } from "@fundforindonesia/search";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { checkAdmin } from "../lib/admin";
import { privateDocumentsS3 } from "../lib/media-s3";
import { sessionDerive } from "../lib/session";

const VIEW_URL_EXPIRY_SECONDS = 300;

export const adminRoute = new Elysia()
  .use(sessionDerive)
  .get(
    "/admin/campaigns",
    async ({ user, query, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }

      // query.status is validated only as a generic string by the route's `t.Object`
      // schema below, but the `status` column is a Postgres enum. An unrecognized
      // value here does NOT match zero rows -- Postgres rejects the invalid enum
      // literal outright, which surfaces as an opaque 500 (via the global error
      // handler) rather than a graceful empty list. Acceptable for now since this
      // route is checkAdmin-gated (only reachable by an authenticated admin) and no
      // caller in this plan yet sends an arbitrary status value -- but if a future
      // admin UI ever accepts free-text status input, validate it against
      // campaignStatusEnum.enumValues before this point and return a real 4xx.
      const status = (query.status ??
        "pending_review") as (typeof campaignStatusEnum.enumValues)[number];
      const rows = await db
        .select({
          id: campaigns.id,
          slug: campaigns.slug,
          title: campaigns.title,
          status: campaigns.status,
          submittedAt: campaigns.submittedAt,
          campaignerName: campaigners.displayName,
          categoryTitle: campaignCategories.title,
        })
        .from(campaigns)
        .innerJoin(campaigners, eq(campaigns.campaignerId, campaigners.id))
        .innerJoin(campaignCategories, eq(campaigns.categoryId, campaignCategories.id))
        .where(eq(campaigns.status, status))
        .orderBy(desc(campaigns.submittedAt));

      return {
        campaigns: rows.map((row) => ({
          ...row,
          submittedAt: row.submittedAt?.toISOString() ?? null,
        })),
      };
    },
    {
      query: t.Object({ status: t.Optional(t.String()) }),
      response: {
        200: AdminCampaignListResponseSchema,
        401: CampaignErrorSchema,
        403: CampaignErrorSchema,
      },
    },
  )
  .get(
    "/admin/campaigns/:id",
    async ({ user, params, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }

      const [row] = await db
        .select({ campaign: campaigns, category: campaignCategories, campaigner: campaigners })
        .from(campaigns)
        .innerJoin(campaignCategories, eq(campaigns.categoryId, campaignCategories.id))
        .innerJoin(campaigners, eq(campaigns.campaignerId, campaigners.id))
        .where(eq(campaigns.id, params.id));
      if (!row) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }

      const [verification] = await db
        .select()
        .from(individualVerifications)
        .where(eq(individualVerifications.campaignId, row.campaign.id));

      const ktpViewUrl = verification?.ktpObjectKey
        ? privateDocumentsS3
            .file(verification.ktpObjectKey)
            .presign({ method: "GET", expiresIn: VIEW_URL_EXPIRY_SECONDS })
        : null;
      const selfieViewUrl = verification?.selfieObjectKey
        ? privateDocumentsS3
            .file(verification.selfieObjectKey)
            .presign({ method: "GET", expiresIn: VIEW_URL_EXPIRY_SECONDS })
        : null;

      const documents = await db
        .select()
        .from(campaignDocuments)
        .where(
          or(
            eq(campaignDocuments.campaignId, row.campaign.id),
            row.campaign.draftId ? eq(campaignDocuments.draftId, row.campaign.draftId) : sql`false`,
          ),
        );

      const revisions = await db
        .select()
        .from(campaignRevisions)
        .where(eq(campaignRevisions.campaignId, row.campaign.id))
        .orderBy(desc(campaignRevisions.createdAt));

      return {
        id: row.campaign.id,
        slug: row.campaign.slug,
        title: row.campaign.title,
        shortDescription: row.campaign.shortDescription,
        story: row.campaign.story,
        status: row.campaign.status,
        model: row.campaign.model,
        goalAmount: row.campaign.goalAmount
          ? { amount: row.campaign.goalAmount.toString(), currency: row.campaign.currency }
          : null,
        category: { id: row.category.id, slug: row.category.slug, title: row.category.title },
        campaignerName: row.campaigner.displayName,
        verification: {
          fullName: verification?.fullName ?? "",
          nationalId: verification?.nationalId ?? "",
          dateOfBirth: verification?.dateOfBirth ?? "",
          address: verification?.address ?? "",
          city: verification?.city ?? "",
          postalCode: verification?.postalCode ?? "",
          ktpViewUrl,
          selfieViewUrl,
          status: verification?.status ?? "pending",
        },
        documents: documents.map((doc) => ({
          id: doc.id,
          type: doc.type,
          viewUrl: privateDocumentsS3
            .file(doc.objectKey)
            .presign({ method: "GET", expiresIn: VIEW_URL_EXPIRY_SECONDS }),
          uploadedAt: doc.uploadedAt.toISOString(),
        })),
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
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: AdminCampaignDetailResponseSchema,
        401: CampaignErrorSchema,
        403: CampaignErrorSchema,
        404: CampaignErrorSchema,
      },
    },
  )
  .post(
    "/admin/campaigns/:id/approve",
    async ({ user, params, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }

      const [row] = await db
        .select({ campaign: campaigns, category: campaignCategories, campaigner: campaigners })
        .from(campaigns)
        .innerJoin(campaignCategories, eq(campaigns.categoryId, campaignCategories.id))
        .innerJoin(campaigners, eq(campaigns.campaignerId, campaigners.id))
        .where(eq(campaigns.id, params.id));
      if (!row) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }

      const now = new Date();
      const transitioned = await db.transaction(async (tx) => {
        const updated = await tx
          .update(campaigns)
          .set({ status: "active", publishedAt: now, updatedAt: now })
          .where(and(eq(campaigns.id, row.campaign.id), eq(campaigns.status, "pending_review")))
          .returning();
        if (updated.length === 0) {
          return false;
        }
        await tx
          .update(individualVerifications)
          .set({ status: "verified", updatedAt: now })
          .where(eq(individualVerifications.campaignId, row.campaign.id));
        return true;
      });

      if (!transitioned) {
        set.status = 409;
        return { error: "invalid_campaign_status" };
      }

      try {
        await syncCampaignsIndex([
          {
            id: row.campaign.id,
            slug: row.campaign.slug,
            title: row.campaign.title,
            shortDescription: row.campaign.shortDescription,
            categoryId: row.category.id,
            categorySlug: row.category.slug,
            model: row.campaign.model,
            createdAtMs: row.campaign.createdAt.getTime(),
          },
        ]);
      } catch (err) {
        console.error("syncCampaignsIndex failed after approving campaign", row.campaign.id, err);
      }

      return { status: "active" };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: AdminActionResponseSchema,
        401: CampaignErrorSchema,
        403: CampaignErrorSchema,
        404: CampaignErrorSchema,
        409: CampaignErrorSchema,
      },
    },
  )
  .post(
    "/admin/campaigns/:id/request-revision",
    async ({ user, params, body, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }

      const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, params.id));
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }

      const transitioned = await db.transaction(async (tx) => {
        const updated = await tx
          .update(campaigns)
          .set({ status: "needs_revision", updatedAt: new Date() })
          .where(and(eq(campaigns.id, campaign.id), eq(campaigns.status, "pending_review")))
          .returning();
        if (updated.length === 0) {
          return false;
        }
        await tx.insert(campaignRevisions).values(
          body.items.map((item) => ({
            campaignId: campaign.id,
            field: item.field,
            note: item.note,
          })),
        );
        return true;
      });

      if (!transitioned) {
        set.status = 409;
        return { error: "invalid_campaign_status" };
      }

      return { status: "needs_revision" };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: AdminRequestRevisionBodySchema,
      response: {
        200: AdminActionResponseSchema,
        401: CampaignErrorSchema,
        403: CampaignErrorSchema,
        404: CampaignErrorSchema,
        409: CampaignErrorSchema,
      },
    },
  );
