import { beforeAll, describe, expect, test } from "bun:test";
import { db, helpArticles, sessions, supportTickets, users } from "@galangdana/db";
import { eq, inArray } from "drizzle-orm";
import { helpRoute } from "./help";

const app = helpRoute;

const USER_ID = "44444444-5555-6666-7777-888888888901";
const TOKEN = "help-test-user-token";

function authedRequest(url: string, token: string, init: RequestInit = {}) {
  return new Request(url, { ...init, headers: { ...init.headers, cookie: `session=${token}` } });
}

beforeAll(async () => {
  await db.delete(users).where(inArray(users.id, [USER_ID]));
  await db.insert(users).values({ id: USER_ID, phone: "+6281199200001" });
  await db
    .insert(sessions)
    .values({ id: TOKEN, userId: USER_ID, expiresAt: new Date(Date.now() + 86400000) });
  await db.delete(helpArticles).where(eq(helpArticles.slug, "help-test-article"));
});

describe("GET /help-articles", () => {
  test("lists articles, publicly, no auth required", async () => {
    await db.insert(helpArticles).values({
      slug: "help-test-article",
      question: "Apakah donasi saya aman?",
      answer: "Ya, semua transaksi diproses melalui payment gateway resmi.",
    });
    const resp = await app.handle(new Request("http://localhost/help-articles"));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { articles: Array<{ slug: string }> };
    expect(body.articles.some((a) => a.slug === "help-test-article")).toBe(true);
  });
});

describe("POST /support-tickets", () => {
  test("creates a ticket without authentication", async () => {
    const resp = await app.handle(
      new Request("http://localhost/support-tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Rina",
          email: "rina@example.test",
          message: "Bagaimana cara membatalkan donasi berulang?",
        }),
      }),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { id: string };
    const [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, body.id));
    expect(row?.userId).toBeNull();
    expect(row?.status).toBe("open");
  });

  test("attaches the caller's userId when authenticated", async () => {
    const resp = await app.handle(
      authedRequest("http://localhost/support-tickets", TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Test User",
          email: "test-user@example.test",
          message: "Saya butuh bantuan mengubah email akun.",
        }),
      }),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { id: string };
    const [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, body.id));
    expect(row?.userId).toBe(USER_ID);
  });

  test("422s on an invalid email", async () => {
    const resp = await app.handle(
      new Request("http://localhost/support-tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "X", email: "not-an-email", message: "Halo." }),
      }),
    );
    expect(resp.status).toBe(422);
  });
});
