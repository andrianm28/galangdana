import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const notificationsOutbox = pgTable("notifications_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  channel: text("channel").notNull(),
  template: text("template").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  // Set on failure: earliest time this row may be retried. NULL means due now.
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  // Last send error, for diagnosis. Overwritten on each failed attempt.
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

export type NotificationOutboxRow = typeof notificationsOutbox.$inferSelect;
export type NewNotificationOutboxRow = typeof notificationsOutbox.$inferInsert;
