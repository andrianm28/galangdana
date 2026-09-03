import { bigint, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { donationStatusEnum, donations } from "./donations";

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  donationId: uuid("donation_id")
    .notNull()
    .unique()
    .references(() => donations.id),
  provider: text("provider").notNull(),
  method: text("method").notNull(),
  providerOrderId: text("provider_order_id").notNull().unique(),
  vaNumber: text("va_number"),
  grossAmount: bigint("gross_amount", { mode: "bigint" }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: donationStatusEnum("status").notNull().default("pending"),
  rawPayload: jsonb("raw_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
