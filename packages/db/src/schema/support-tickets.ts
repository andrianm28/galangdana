import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

export const supportTicketStatusEnum = pgEnum("support_ticket_status", ["open", "resolved"]);

// userId is nullable and onDelete: "set null" -- a support ticket is a
// standalone record of a contact-form submission, not owned data that
// should disappear if the submitter's account is later deleted. `name`
// and `email` are captured directly on the ticket (not read from `users`)
// because submission never requires authentication -- a guest with no
// account at all is the common case, not the exception.
export const supportTickets = pgTable("support_tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  message: text("message").notNull(),
  status: supportTicketStatusEnum("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export type SupportTicket = typeof supportTickets.$inferSelect;
export type NewSupportTicket = typeof supportTickets.$inferInsert;
