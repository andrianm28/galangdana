import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { campaignDrafts } from "./campaign-drafts";

// 1:1 with a draft (unique draftId) -- the non-medical track's `penerima`
// wizard step. Deliberately original fields, not copied from any observed
// platform.
export const beneficiaries = pgTable("beneficiaries", {
  id: uuid("id").primaryKey().defaultRandom(),
  draftId: uuid("draft_id")
    .notNull()
    .unique()
    .references(() => campaignDrafts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  relationship: text("relationship"),
  needDescription: text("need_description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Beneficiary = typeof beneficiaries.$inferSelect;
export type NewBeneficiary = typeof beneficiaries.$inferInsert;
