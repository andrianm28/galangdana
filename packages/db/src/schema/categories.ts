import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const campaignCategories = pgTable("campaign_categories", {
  id: integer("id").primaryKey(), // matches Kitabisa's observed numeric category ids for parity
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  isFavorite: boolean("is_favorite").notNull().default(false),
  // Soft-archive flag: a category is deactivated rather than deleted so that
  // campaigns already pointing at it (via categoryId FK) keep resolving. An
  // inactive category is filtered out of /categories, of the slug->id lookup
  // used by GET /campaigns?category= and GET /search?category=, and of the
  // seed's own display -- but its row, and any campaign FK referencing it,
  // stays intact. See the zakat/wakaf archival in categories.seed.ts.
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CampaignCategory = typeof campaignCategories.$inferSelect;
export type NewCampaignCategory = typeof campaignCategories.$inferInsert;
