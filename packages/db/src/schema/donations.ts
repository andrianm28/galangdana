import { sql } from "drizzle-orm";
import { bigint, boolean, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { allocationPolicies } from "./allocation-policies";
import { campaignCurrencyEnum, campaigns } from "./campaigns";
import { users } from "./users";

export const donationStatusEnum = pgEnum("donation_status", [
  "pending",
  "paid",
  "expired",
  "failed",
  "refunded",
]);

export const donations = pgTable("donations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id),
  allocationPolicyId: uuid("allocation_policy_id")
    .notNull()
    .references(() => allocationPolicies.id),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  currency: campaignCurrencyEnum("currency").notNull(),
  platformFee: bigint("platform_fee", { mode: "bigint" }).notNull().default(sql`0`),
  isAnonymous: boolean("is_anonymous").notNull().default(false),
  comment: text("comment"),
  status: donationStatusEnum("status").notNull().default("pending"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Donation = typeof donations.$inferSelect;
export type NewDonation = typeof donations.$inferInsert;
