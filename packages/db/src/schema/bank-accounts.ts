import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { campaigners } from "./campaigners";

/**
 * A campaigner's payout destination. verifiedAt is intended to be set by
 * an admin action, but no such endpoint exists yet in this slice -- this
 * column is write-never for now, deferred rather than built here. Mirrors
 * how individual_verifications is already reviewed manually in this
 * codebase, not via a third-party API.
 */
export const bankAccounts = pgTable("bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignerId: uuid("campaigner_id")
    .notNull()
    .references(() => campaigners.id, { onDelete: "cascade" }),
  bankCode: text("bank_code").notNull(),
  bankName: text("bank_name").notNull(),
  accountNumber: text("account_number").notNull(),
  accountHolderName: text("account_holder_name").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BankAccount = typeof bankAccounts.$inferSelect;
export type NewBankAccount = typeof bankAccounts.$inferInsert;
