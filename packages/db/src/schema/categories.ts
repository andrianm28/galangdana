import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const campaignCategories = pgTable("campaign_categories", {
  id: integer("id").primaryKey(), // matches Kitabisa's observed numeric category ids for parity
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  isFavorite: boolean("is_favorite").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CampaignCategory = typeof campaignCategories.$inferSelect;
export type NewCampaignCategory = typeof campaignCategories.$inferInsert;
