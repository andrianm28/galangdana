import {
  HelpArticleListResponseSchema,
  SubmitSupportTicketBodySchema,
  SubmitSupportTicketResponseSchema,
} from "@galangdana/contracts";
import { db, helpArticles, supportTickets } from "@galangdana/db";
import { desc } from "drizzle-orm";
import { Elysia, t } from "elysia";
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
  );
