import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Every article is public and live immediately on creation -- no draft or
// scheduling state, matching the master plan's "Build minimal" scope
// decision for the help centre. `answer` holds Markdown source, rendered
// client-side by the FAQ page; there is no separate rendered-HTML column.
export const helpArticles = pgTable("help_articles", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HelpArticle = typeof helpArticles.$inferSelect;
export type NewHelpArticle = typeof helpArticles.$inferInsert;
