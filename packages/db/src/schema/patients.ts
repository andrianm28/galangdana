import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { campaignDrafts } from "./campaign-drafts";

// 1:1 with a draft (unique draftId) -- the medical track's `pasien` wizard
// step. Fields are deliberately original, not copied from any observed
// platform's exact labels (only the route name "pasien" was ever
// observed): a real-world patient record for a medical fundraising
// campaign, kept intentionally small for this phase.
export const patients = pgTable("patients", {
  id: uuid("id").primaryKey().defaultRandom(),
  draftId: uuid("draft_id")
    .notNull()
    .unique()
    .references(() => campaignDrafts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  age: integer("age"),
  illness: text("illness").notNull(),
  hospitalName: text("hospital_name"),
  relationshipToCampaigner: text("relationship_to_campaigner"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Patient = typeof patients.$inferSelect;
export type NewPatient = typeof patients.$inferInsert;
