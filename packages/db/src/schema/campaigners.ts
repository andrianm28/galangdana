import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

// Enough to attribute a campaign to someone and support the explore page's
// Kitabisa/Yayasan/Publik-style type filter, plus (as of sub-phase 2c) a
// real link back to the authenticated user who owns this campaigner
// identity. Organization/yayasan onboarding (NPWP, notarial deed, officer
// verification) remains out of scope here -- userId is populated only for
// individual-track campaigners created via the wizard's KYC step.
export const campaignerTypeEnum = pgEnum("campaigner_type", ["individual", "yayasan", "platform"]);

export const campaigners = pgTable("campaigners", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: campaignerTypeEnum("type").notNull(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Campaigner = typeof campaigners.$inferSelect;
export type NewCampaigner = typeof campaigners.$inferInsert;
