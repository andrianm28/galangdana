import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns";
import { donations } from "./donations";

// Public prayer messages for a campaign. Anyone may write one (no account,
// no donation required); every row is published as-is, so abuse is handled
// reactively via the admin delete endpoint, not a moderation queue.
// donationId links prayers written right after donating and is set null
// (not cascade) if that donation row ever goes away -- the prayer is the
// donor's words, not the payment's metadata.
export const prayers = pgTable("prayers", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id),
  donationId: uuid("donation_id").references(() => donations.id, { onDelete: "set null" }),
  name: text("name"),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Prayer = typeof prayers.$inferSelect;
export type NewPrayer = typeof prayers.$inferInsert;
