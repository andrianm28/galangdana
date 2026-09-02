import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns";

// Individual KYC record for a campaign, one row per campaign (unique
// campaignId). The vendor for real KTP/passport-against-official-database
// verification is UNVERIFIED (the master plan's own research never
// identified one -- "third party" with no name or docs). Matching this
// project's established pattern for every undocumented vendor (Sumopod,
// kirim.dev): this table records what a real integration would need
// (identity fields + document keys) but performs no real third-party call.
// `status` starts and stays "pending" until a human reviews it -- that
// review UI is Phase 3's job, not this plan's.
export const individualVerificationStatusEnum = pgEnum("individual_verification_status", [
  "pending",
  "verified",
  "rejected",
]);

export const individualVerifications = pgTable("individual_verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id")
    .notNull()
    .unique()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  nationalId: text("national_id").notNull(),
  dateOfBirth: text("date_of_birth").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull(),
  postalCode: text("postal_code").notNull(),
  ktpObjectKey: text("ktp_object_key"),
  selfieObjectKey: text("selfie_object_key"),
  consentedAt: timestamp("consented_at", { withTimezone: true }),
  status: individualVerificationStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type IndividualVerification = typeof individualVerifications.$inferSelect;
export type NewIndividualVerification = typeof individualVerifications.$inferInsert;
