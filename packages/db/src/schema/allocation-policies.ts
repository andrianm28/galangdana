import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const allocationPolicies = pgTable("allocation_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Basis points (1/100 of a percent). 0 = no platform fee. This is a
  // placeholder default, not a business decision -- see this plan's
  // "Explicitly Out of Scope" note.
  platformFeeBps: integer("platform_fee_bps").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AllocationPolicy = typeof allocationPolicies.$inferSelect;
export type NewAllocationPolicy = typeof allocationPolicies.$inferInsert;
