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

/**
 * Where a receipt for this donation can be sent.
 *
 * A guest donation has no users row, so before this there was nowhere to send
 * anything: the donation_receipt outbox row written on settle had a payload
 * with a donationId and no destination, making it undeliverable for every
 * guest -- which is the majority path, since POST /donations accepts a null
 * userId and the UI never asked for an account either way.
 */
export const donationContactChannelEnum = pgEnum("donation_contact_channel", ["email", "whatsapp"]);

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
  // Collected so a receipt can actually reach the donor. Nullable because a
  // donation is not blocked on providing one -- asking for contact details
  // before taking money is a conversion cost, and a donor who declines still
  // gets their donation and the on-screen receipt page.
  contactChannel: donationContactChannelEnum("contact_channel"),
  contactValue: text("contact_value"),
  // What to show beside the donation publicly. Not a legal name and never
  // required: the default is the neutral "Sesama".
  displayName: text("display_name"),
  status: donationStatusEnum("status").notNull().default("pending"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Donation = typeof donations.$inferSelect;
export type NewDonation = typeof donations.$inferInsert;
