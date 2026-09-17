import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
  // "Amiin" acknowledgements, ported from kibi-clone's PrayerWall. A plain
  // counter rather than a join table: there is no account required to write a
  // prayer, so there is no identity to attribute an acknowledgement to, and a
  // per-visitor uniqueness constraint would need one. Incremented server-side
  // with SQL rather than read-modify-write, so concurrent taps cannot lose
  // each other.
  //
  // Consequence, stated rather than hidden: nothing stops the same person
  // tapping twice from two tabs. This is a warmth signal, not a vote, and the
  // endpoint is rate-limited -- treating it as a tally worth defending would
  // mean requiring accounts, which is the opposite of what prayers are for.
  amiinCount: integer("amiin_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Prayer = typeof prayers.$inferSelect;
export type NewPrayer = typeof prayers.$inferInsert;
