import { jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

// Keys are scoped per endpoint: the uniqueness that matters is
// (endpoint, key), so a client reusing a key string on an unrelated
// endpoint can neither block this one nor receive its cached response.
// The endpoint column was stored but unconstrained before, leaving exactly
// that cross-client hole open.
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    endpoint: text("endpoint").notNull(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.endpoint, table.key)],
);

export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKeyRow = typeof idempotencyKeys.$inferInsert;
