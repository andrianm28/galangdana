import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Deliberately minimal for this phase: enough to attribute a campaign to
// someone and support the explore page's Kitabisa/Yayasan/Publik-style
// type filter. No verification workflow, no KYC documents, no bank
// account, no auth linkage (an individual campaigner is NOT the same row
// as a `users` account yet) -- all of that is Phase 5's job. verifiedAt
// exists now because the column is cheap and campaign detail pages will
// want a "verified" badge before Phase 5 ships the flow that actually
// sets it; it stays NULL for every fixture in this phase.
export const campaignerTypeEnum = pgEnum("campaigner_type", ["individual", "yayasan", "platform"]);

export const campaigners = pgTable("campaigners", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: campaignerTypeEnum("type").notNull(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Campaigner = typeof campaigners.$inferSelect;
export type NewCampaigner = typeof campaigners.$inferInsert;
