import {
  AdminActionResponseSchema,
  AdminSupportTicketListResponseSchema,
  CreateHelpArticleBodySchema,
  HelpArticleListResponseSchema,
  HelpArticleSchema,
  HelpErrorSchema,
  SubmitSupportTicketBodySchema,
  SubmitSupportTicketResponseSchema,
  UpdateHelpArticleBodySchema,
} from "@fundforindonesia/contracts";
import {
  db,
  helpArticles,
  type supportTicketStatusEnum,
  supportTickets,
} from "@fundforindonesia/db";
import { and, desc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { checkAdmin } from "../lib/admin";
import { sessionDerive } from "../lib/session";

export const helpRoute = new Elysia()
  .use(sessionDerive)
  .get(
    "/help-articles",
    async () => {
      const rows = await db.select().from(helpArticles).orderBy(desc(helpArticles.createdAt));
      return {
        articles: rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          question: row.question,
          answer: row.answer,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
      };
    },
    {
      response: { 200: HelpArticleListResponseSchema },
    },
  )
  .post(
    "/support-tickets",
    async ({ user, body }) => {
      const [ticket] = await db
        .insert(supportTickets)
        .values({
          userId: user?.id,
          name: body.name,
          email: body.email,
          message: body.message,
        })
        .returning();
      if (!ticket) throw new Error("support ticket insert returned no row");
      return { id: ticket.id };
    },
    {
      body: SubmitSupportTicketBodySchema,
      response: { 200: SubmitSupportTicketResponseSchema },
    },
  )
  .post(
    "/admin/help-articles",
    async ({ user, body, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }
      let article: typeof helpArticles.$inferSelect | undefined;
      try {
        [article] = await db.insert(helpArticles).values(body).returning();
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          set.status = 409;
          return { error: "slug_already_exists" };
        }
        throw err;
      }
      if (!article) throw new Error("help article insert returned no row");
      return {
        id: article.id,
        slug: article.slug,
        question: article.question,
        answer: article.answer,
        createdAt: article.createdAt.toISOString(),
        updatedAt: article.updatedAt.toISOString(),
      };
    },
    {
      body: CreateHelpArticleBodySchema,
      response: {
        200: HelpArticleSchema,
        401: HelpErrorSchema,
        403: HelpErrorSchema,
        409: HelpErrorSchema,
      },
    },
  )
  .put(
    "/admin/help-articles/:id",
    async ({ user, params, body, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }
      const [article] = await db
        .update(helpArticles)
        .set({ question: body.question, answer: body.answer, updatedAt: new Date() })
        .where(eq(helpArticles.id, params.id))
        .returning();
      if (!article) {
        set.status = 404;
        return { error: "article_not_found" };
      }
      return {
        id: article.id,
        slug: article.slug,
        question: article.question,
        answer: article.answer,
        createdAt: article.createdAt.toISOString(),
        updatedAt: article.updatedAt.toISOString(),
      };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: UpdateHelpArticleBodySchema,
      response: {
        200: HelpArticleSchema,
        401: HelpErrorSchema,
        403: HelpErrorSchema,
        404: HelpErrorSchema,
      },
    },
  )
  .delete(
    "/admin/help-articles/:id",
    async ({ user, params, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }
      const deleted = await db
        .delete(helpArticles)
        .where(eq(helpArticles.id, params.id))
        .returning();
      if (deleted.length === 0) {
        set.status = 404;
        return { error: "article_not_found" };
      }
      return { status: "deleted" };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: AdminActionResponseSchema,
        401: HelpErrorSchema,
        403: HelpErrorSchema,
        404: HelpErrorSchema,
      },
    },
  )
  .get(
    "/admin/support-tickets",
    async ({ user, query, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }
      // Same documented tradeoff as GET /admin/campaigns (apps/api/src/routes/admin.ts):
      // query.status is validated only as a generic string by this route's `t.Object`
      // schema below, but the column is a Postgres enum -- an unrecognized value does
      // NOT match zero rows, it throws. Acceptable here for the same reason: this route
      // is checkAdmin-gated and no caller in this plan sends an arbitrary value.
      const status = (query.status ??
        "open") as (typeof supportTicketStatusEnum.enumValues)[number];
      const rows = await db
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.status, status))
        .orderBy(desc(supportTickets.createdAt));
      return {
        tickets: rows.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          message: row.message,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          resolvedAt: row.resolvedAt?.toISOString() ?? null,
        })),
      };
    },
    {
      query: t.Object({ status: t.Optional(t.String()) }),
      response: {
        200: AdminSupportTicketListResponseSchema,
        401: HelpErrorSchema,
        403: HelpErrorSchema,
      },
    },
  )
  .post(
    "/admin/support-tickets/:id/resolve",
    async ({ user, params, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }
      const updated = await db
        .update(supportTickets)
        .set({ status: "resolved", resolvedAt: new Date() })
        .where(and(eq(supportTickets.id, params.id), eq(supportTickets.status, "open")))
        .returning();
      if (updated.length === 0) {
        set.status = 409;
        return { error: "invalid_ticket_status" };
      }
      return { status: "resolved" };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: AdminActionResponseSchema,
        401: HelpErrorSchema,
        403: HelpErrorSchema,
        409: HelpErrorSchema,
      },
    },
  );
