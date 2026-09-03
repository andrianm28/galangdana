import { bigint, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { bankAccounts } from "./bank-accounts";
import { campaignCurrencyEnum, campaigns } from "./campaigns";
import { users } from "./users";

export const disbursementTypeEnum = pgEnum("disbursement_type", ["partial", "final"]);

// "processing" is reserved for a future async payout worker/queue --
// this plan's own route code (Task 8) never sets it, transitioning
// approved -> paid directly. Included now so the column doesn't need a
// migration when that worker lands later.
export const disbursementStatusEnum = pgEnum("disbursement_status", [
  "draft",
  "otp_pending",
  "requested",
  "approved",
  "rejected",
  "processing",
  "paid",
  "failed",
]);

export const disbursementRequests = pgTable("disbursement_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id),
  bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),
  type: disbursementTypeEnum("type"),
  amount: bigint("amount", { mode: "bigint" }),
  currency: campaignCurrencyEnum("currency"),
  narrative: text("narrative"),
  proofObjectKey: text("proof_object_key"),
  status: disbursementStatusEnum("status").notNull().default("draft"),
  otpVerifiedAt: timestamp("otp_verified_at", { withTimezone: true }),
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedReason: text("rejected_reason"),
  payoutRef: text("payout_ref"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DisbursementRequest = typeof disbursementRequests.$inferSelect;
export type NewDisbursementRequest = typeof disbursementRequests.$inferInsert;
