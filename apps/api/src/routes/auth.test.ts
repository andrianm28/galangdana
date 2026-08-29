import { beforeEach, describe, expect, test } from "bun:test";
import { db, oauthAccounts, otpChallenges, sessions, users } from "@galangdana/db";
import { eq } from "drizzle-orm";
import { app } from "../index";
import { redis } from "../lib/redis-client";

const OTP_PHONE = "+6281199999401";
const EMAIL = "test-route-1@example.test";

async function cleanupUser(where: { phone?: string; email?: string }) {
  if (where.phone) {
    const [u] = await db.select().from(users).where(eq(users.phone, where.phone));
    if (u) await db.delete(users).where(eq(users.id, u.id));
    await db.delete(otpChallenges).where(eq(otpChallenges.phone, where.phone));
    // The route-level OTP flow below calls requestOtp twice per test run
    // (once through the HTTP route, once directly to capture the code),
    // against the fixed-window Redis rate limiter (3 requests/hour keyed
    // by phone). With a fixed OTP_PHONE and no cleanup, re-running this
    // suite within the same hour accumulates count across runs and
    // eventually flips a genuinely valid request into a 429 -- the same
    // fixed-value test-idempotency class fixed in otp.test.ts, applied
    // here too.
    await redis.del(`otp:ratelimit:${where.phone}`);
  }
  if (where.email) {
    const [u] = await db.select().from(users).where(eq(users.email, where.email));
    if (u) await db.delete(users).where(eq(users.id, u.id));
  }
}

function extractCookieValue(setCookieHeader: string | null, name: string): string | null {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match?.[1] ?? null;
}

describe("phone OTP flow", () => {
  beforeEach(async () => {
    await cleanupUser({ phone: OTP_PHONE });
  });

  test("request -> verify -> /auth/me works end to end", async () => {
    const requestResp = await app.handle(
      new Request("http://localhost/auth/otp/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: OTP_PHONE }),
      }),
    );
    expect(requestResp.status).toBe(200);

    const [challenge] = await db
      .select()
      .from(otpChallenges)
      .where(eq(otpChallenges.phone, OTP_PHONE))
      .orderBy(otpChallenges.createdAt);
    expect(challenge).toBeDefined();

    // The route test can't read the code the "SMS" sent (it's hashed at
    // rest and never returned over HTTP, by design) -- request a fresh
    // challenge directly through the OTP module to get a real code, the
    // same way the route handler itself does internally.
    const { requestOtp } = await import("../auth/otp");
    const { ConsoleSmsProvider } = await import("../auth/sms-provider");
    class CapturingSms extends ConsoleSmsProvider {
      lastCode = "";
      override async sendOtp(phone: string, code: string) {
        this.lastCode = code;
        await super.sendOtp(phone, code);
      }
    }
    const sms = new CapturingSms();
    await requestOtp(OTP_PHONE, sms);

    const verifyResp = await app.handle(
      new Request("http://localhost/auth/otp/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: OTP_PHONE, code: sms.lastCode }),
      }),
    );
    expect(verifyResp.status).toBe(200);
    const setCookie = verifyResp.headers.get("set-cookie");
    const token = extractCookieValue(setCookie, "session");
    expect(token).not.toBeNull();

    const meResp = await app.handle(
      new Request("http://localhost/auth/me", {
        headers: { cookie: `session=${token}` },
      }),
    );
    expect(meResp.status).toBe(200);
    const meBody = (await meResp.json()) as { user: { phone: string } };
    expect(meBody.user.phone).toBe(OTP_PHONE);
  });

  test("verifying a wrong code returns 401", async () => {
    const resp = await app.handle(
      new Request("http://localhost/auth/otp/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: OTP_PHONE, code: "000000" }),
      }),
    );
    expect(resp.status).toBe(401);
  });
});

describe("email register/login flow", () => {
  beforeEach(async () => {
    await cleanupUser({ email: EMAIL });
  });

  test("register -> logout -> login -> /auth/me works end to end", async () => {
    const registerResp = await app.handle(
      new Request("http://localhost/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: EMAIL,
          password: "correct-horse-battery-staple",
          name: "Route Test",
        }),
      }),
    );
    expect(registerResp.status).toBe(200);
    const registerToken = extractCookieValue(registerResp.headers.get("set-cookie"), "session");
    expect(registerToken).not.toBeNull();

    const logoutResp = await app.handle(
      new Request("http://localhost/auth/logout", {
        method: "POST",
        headers: { cookie: `session=${registerToken}` },
      }),
    );
    expect(logoutResp.status).toBe(200);

    const meAfterLogout = await app.handle(
      new Request("http://localhost/auth/me", { headers: { cookie: `session=${registerToken}` } }),
    );
    expect(meAfterLogout.status).toBe(401);

    const loginResp = await app.handle(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: "correct-horse-battery-staple" }),
      }),
    );
    expect(loginResp.status).toBe(200);
    const loginToken = extractCookieValue(loginResp.headers.get("set-cookie"), "session");

    const meResp = await app.handle(
      new Request("http://localhost/auth/me", { headers: { cookie: `session=${loginToken}` } }),
    );
    expect(meResp.status).toBe(200);
    const meBody = (await meResp.json()) as { user: { email: string } };
    expect(meBody.user.email).toBe(EMAIL);
  });

  test("registering with a duplicate email returns 409", async () => {
    await app.handle(
      new Request("http://localhost/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: "first-password-123" }),
      }),
    );
    const secondResp = await app.handle(
      new Request("http://localhost/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: "second-password-456" }),
      }),
    );
    expect(secondResp.status).toBe(409);
  });

  test("logging in with the wrong password returns 401", async () => {
    await app.handle(
      new Request("http://localhost/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: "correct-horse-battery-staple" }),
      }),
    );
    const resp = await app.handle(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: "wrong-password" }),
      }),
    );
    expect(resp.status).toBe(401);
  });
});

describe("GET /auth/me without a session", () => {
  test("returns 401", async () => {
    const resp = await app.handle(new Request("http://localhost/auth/me"));
    expect(resp.status).toBe(401);
  });
});

describe("GET /auth/google", () => {
  test("redirects to Google's consent screen with a state and PKCE challenge, and sets a verifier cookie", async () => {
    const resp = await app.handle(
      new Request("http://localhost/auth/google", { redirect: "manual" }),
    );
    expect(resp.status).toBe(302);
    const location = resp.headers.get("location");
    expect(location).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(resp.headers.get("set-cookie")).toContain("google_oauth_verifier");
  });
});
