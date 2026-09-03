import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../client";
import { supportTickets } from "../schema/support-tickets";
import { users } from "../schema/users";

const TEST_PHONE = "+6281199100001";
const TEST_TICKET_EMAILS = ["budi@example.test", "siti@example.test", "dedi@example.test"];

describe("support_tickets", () => {
  beforeAll(async () => {
    await db.delete(users).where(inArray(users.phone, [TEST_PHONE, "+6281199100002"]));
  });

  afterEach(async () => {
    await db.delete(users).where(inArray(users.phone, [TEST_PHONE, "+6281199100002"]));
    await db.delete(supportTickets).where(inArray(supportTickets.email, TEST_TICKET_EMAILS));
  });

  test("a ticket can be created without a user (guest submission)", async () => {
    const [ticket] = await db
      .insert(supportTickets)
      .values({ name: "Budi", email: "budi@example.test", message: "Donasi saya tidak tercatat." })
      .returning();
    expect(ticket?.userId).toBeNull();
    expect(ticket?.status).toBe("open");
    expect(ticket?.resolvedAt).toBeNull();
  });

  test("a ticket can be created with a user attached", async () => {
    const [user] = await db.insert(users).values({ phone: TEST_PHONE }).returning();
    if (!user) throw new Error("user insert failed");
    const [ticket] = await db
      .insert(supportTickets)
      .values({
        userId: user.id,
        name: "Siti",
        email: "siti@example.test",
        message: "Bagaimana cara mengubah nomor rekening?",
      })
      .returning();
    expect(ticket?.userId).toBe(user.id);
  });

  test("deleting the attached user sets userId to null, not deleting the ticket", async () => {
    const [user] = await db.insert(users).values({ phone: "+6281199100002" }).returning();
    if (!user) throw new Error("user insert failed");
    const [ticket] = await db
      .insert(supportTickets)
      .values({ userId: user.id, name: "Dedi", email: "dedi@example.test", message: "Halo." })
      .returning();
    if (!ticket) throw new Error("ticket insert failed");

    await db.delete(users).where(eq(users.id, user.id));

    const [remaining] = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, ticket.id));
    expect(remaining?.userId).toBeNull();
    expect(remaining?.name).toBe("Dedi");
  });
});
