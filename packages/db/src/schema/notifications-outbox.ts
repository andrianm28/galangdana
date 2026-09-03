import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const notificationsOutbox = pgTable("notifications_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  channel: text("channel").notNull(),
  template: text("template").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

export type NotificationOutboxRow = typeof notificationsOutbox.$inferSelect;
export type NewNotificationOutboxRow = typeof notificationsOutbox.$inferInsert;
