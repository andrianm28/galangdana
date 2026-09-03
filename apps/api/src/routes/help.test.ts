import { beforeAll, describe, expect, test } from "bun:test";
import { db, helpArticles, sessions, supportTickets, users } from "@galangdana/db";
import { eq, inArray } from "drizzle-orm";
import { helpRoute } from "./help";

const app = helpRoute;

const USER_ID = "44444444-5555-6666-7777-888888888901";
const TOKEN = "help-test-user-token";
const ADMIN_USER_ID = "44444444-5555-6666-7777-888888888902";
const ADMIN_TOKEN = "help-test-admin-token";

function authedRequest(url: string, token: string, init: RequestInit = {}) {
  return new Request(url, { ...init, headers: { ...init.headers, cookie: `session=${token}` } });
}

beforeAll(async () => {
  await db.delete(users).where(inArray(users.id, [USER_ID, ADMIN_USER_ID]));
  await db.insert(users).values([
    { id: USER_ID, phone: "+6281199200001" },
    { id: ADMIN_USER_ID, phone: "+6281199200002", role: "admin" },
  ]);
  await db.insert(sessions).values([
    { id: TOKEN, userId: USER_ID, expiresAt: new Date(Date.now() + 86400000) },
    { id: ADMIN_TOKEN, userId: ADMIN_USER_ID, expiresAt: new Date(Date.now() + 86400000) },
  ]);
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

describe("POST /admin/help-articles", () => {
  test("401s for an unauthenticated request", async () => {
    const resp = await app.handle(
      new Request("http://localhost/admin/help-articles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "x", question: "Q", answer: "A" }),
      }),
    );
    expect(resp.status).toBe(401);
  });

  test("403s for an authenticated non-admin", async () => {
    const resp = await app.handle(
      authedRequest("http://localhost/admin/help-articles", TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "x", question: "Q", answer: "A" }),
      }),
    );
    expect(resp.status).toBe(403);
  });

  test("creates an article for an admin", async () => {
    await db.delete(helpArticles).where(eq(helpArticles.slug, "help-test-admin-create"));
    const resp = await app.handle(
      authedRequest("http://localhost/admin/help-articles", ADMIN_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: "help-test-admin-create",
          question: "Bagaimana cara menghubungi tim?",
          answer: "Gunakan formulir kontak.",
        }),
      }),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { id: string; slug: string };
    expect(body.slug).toBe("help-test-admin-create");
  });
});

describe("PUT /admin/help-articles/:id", () => {
  test("updates question and answer", async () => {
    await db.delete(helpArticles).where(eq(helpArticles.slug, "help-test-admin-update"));
    const [article] = await db
      .insert(helpArticles)
      .values({ slug: "help-test-admin-update", question: "Q1", answer: "A1" })
      .returning();
    if (!article) throw new Error("article insert failed");

    const resp = await app.handle(
      authedRequest(`http://localhost/admin/help-articles/${article.id}`, ADMIN_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "Q1 diperbarui", answer: "A1 diperbarui" }),
      }),
    );
    expect(resp.status).toBe(200);
    const [row] = await db.select().from(helpArticles).where(eq(helpArticles.id, article.id));
    expect(row?.question).toBe("Q1 diperbarui");
  });
});

describe("DELETE /admin/help-articles/:id", () => {
  test("deletes an article", async () => {
    await db.delete(helpArticles).where(eq(helpArticles.slug, "help-test-admin-delete"));
    const [article] = await db
      .insert(helpArticles)
      .values({ slug: "help-test-admin-delete", question: "Q", answer: "A" })
      .returning();
    if (!article) throw new Error("article insert failed");

    const resp = await app.handle(
      authedRequest(`http://localhost/admin/help-articles/${article.id}`, ADMIN_TOKEN, {
        method: "DELETE",
      }),
    );
    expect(resp.status).toBe(200);
    const remaining = await db.select().from(helpArticles).where(eq(helpArticles.id, article.id));
    expect(remaining).toHaveLength(0);
  });
});

describe("GET /admin/support-tickets", () => {
  test("401s for an unauthenticated request", async () => {
    const resp = await app.handle(new Request("http://localhost/admin/support-tickets"));
    expect(resp.status).toBe(401);
  });

  test("lists open tickets by default, for an admin", async () => {
    const [ticket] = await db
      .insert(supportTickets)
      .values({ name: "Queue Test", email: "queue@example.test", message: "Test message." })
      .returning();
    if (!ticket) throw new Error("ticket insert failed");

    const resp = await app.handle(
      authedRequest("http://localhost/admin/support-tickets", ADMIN_TOKEN),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { tickets: Array<{ id: string; status: string }> };
    expect(body.tickets.some((t) => t.id === ticket.id && t.status === "open")).toBe(true);
  });
});

describe("POST /admin/support-tickets/:id/resolve", () => {
  test("resolves an open ticket", async () => {
    const [ticket] = await db
      .insert(supportTickets)
      .values({ name: "Resolve Test", email: "resolve@example.test", message: "Test." })
      .returning();
    if (!ticket) throw new Error("ticket insert failed");

    const resp = await app.handle(
      authedRequest(`http://localhost/admin/support-tickets/${ticket.id}/resolve`, ADMIN_TOKEN, {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(200);
    const [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, ticket.id));
    expect(row?.status).toBe("resolved");
    expect(row?.resolvedAt).not.toBeNull();
  });

  test("409s on an already-resolved ticket", async () => {
    const [ticket] = await db
      .insert(supportTickets)
      .values({
        name: "Already Resolved",
        email: "already@example.test",
        message: "Test.",
        status: "resolved",
        resolvedAt: new Date(),
      })
      .returning();
    if (!ticket) throw new Error("ticket insert failed");

    const resp = await app.handle(
      authedRequest(`http://localhost/admin/support-tickets/${ticket.id}/resolve`, ADMIN_TOKEN, {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(409);
  });
});
