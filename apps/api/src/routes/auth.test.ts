import { beforeEach, describe, expect, test } from "bun:test";
import { db, oauthAccounts, otpChallenges, sessions, users } from "@fundforindonesia/db";
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
    // /auth/register and /auth/login are now rate-limited per normalized
    // email (5 registers, 10 logins per hour) to bound argon2id cost under
    // an unauthenticated hash-DoS. Same idempotency reasoning as the
    // `otp:ratelimit:` cleanup above: with a fixed EMAIL and no cleanup,
    // counts accumulate across runs within the hour and eventually flip a
    // genuinely valid register/login into a 429.
    await redis.del(`register:ratelimit:${where.email}`);
    await redis.del(`login:ratelimit:${where.email}`);
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
    await requestOtp(OTP_PHONE, "login", sms);

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
    const registerSetCookie = registerResp.headers.get("set-cookie") ?? "";
    const registerToken = extractCookieValue(registerSetCookie, "session");
    expect(registerToken).not.toBeNull();

    // The session cookie must carry SameSite (and HttpOnly). SameSite=Lax
    // is what makes /auth/logout un-exploitable by a plain cross-site form
    // POST -- the final whole-branch review found no cookie in this module
    // set Secure or SameSite at all. Matched case-insensitively because
    // Elysia's cookie serialization casing is not part of its contract.
    expect(registerSetCookie.toLowerCase()).toContain("samesite=lax");
    expect(registerSetCookie.toLowerCase()).toContain("httponly");

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
  test("redirects to Google's consent screen with a state and PKCE challenge, and sets verifier + state cookies", async () => {
    const resp = await app.handle(
      new Request("http://localhost/auth/google", { redirect: "manual" }),
    );
    expect(resp.status).toBe(302);
    const location = resp.headers.get("location");
    expect(location).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    const setCookie = resp.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("google_oauth_verifier");
    expect(setCookie).toContain("google_oauth_state");
  });
});

describe("GET /auth/google/callback", () => {
  test("rejects a callback whose state doesn't match the one issued to this browser", async () => {
    // A verifier + state cookie pair as GET /auth/google would have set,
    // but the query string's state deliberately doesn't match -- this is
    // exactly the shape of a forged/replayed callback URL. Every outcome of
    // this route (success AND failure) now redirects back to the web app
    // rather than returning JSON, so the failure path can never serialize a
    // raw error to the client.
    const resp = await app.handle(
      new Request("http://localhost/auth/google/callback?code=some-code&state=wrong-state", {
        headers: { cookie: "google_oauth_verifier=some-verifier; google_oauth_state=real-state" },
        redirect: "manual",
      }),
    );
    expect(resp.status).toBe(302);
    expect(resp.headers.get("location")).toContain("auth_error=invalid_request");
  });

  test("a failing token exchange redirects with a generic error, never a raw error body", async () => {
    // A well-formed callback (state matches) whose code is garbage: the
    // real exchangeGoogleCode call runs and fails -- unreachable/rejecting
    // Google, either way it throws. Before the fix this propagated as an
    // uncaught exception whose own enumerable properties were serialized
    // straight to the client (the review saw errno/syscall/address/port
    // from a connection failure). It must now be a redirect carrying a
    // generic reason.
    const resp = await app.handle(
      new Request("http://localhost/auth/google/callback?code=bogus-code&state=matching-state", {
        headers: {
          cookie: "google_oauth_verifier=some-verifier; google_oauth_state=matching-state",
        },
        redirect: "manual",
      }),
    );
    expect(resp.status).toBe(302);
    const location = resp.headers.get("location") ?? "";
    expect(location).toContain("auth_error=");
    // Nothing about the underlying failure may reach the client.
    expect(location).not.toContain("errno");
    expect(location).not.toContain("ECONNREFUSED");
    const body = await resp.text();
    expect(body).not.toContain("errno");
    expect(body).not.toContain("syscall");
  });

  test("the OAuth-flow cookies are cleared on the failure path too", async () => {
    const resp = await app.handle(
      new Request("http://localhost/auth/google/callback?code=some-code&state=wrong-state", {
        headers: { cookie: "google_oauth_verifier=some-verifier; google_oauth_state=real-state" },
        redirect: "manual",
      }),
    );
    const setCookie = (resp.headers.get("set-cookie") ?? "").toLowerCase();
    expect(setCookie).toContain("google_oauth_verifier=");
    expect(setCookie).toContain("google_oauth_state=");
    expect(setCookie).toContain("max-age=0");
  });
});

describe("request validation is not swallowed by the generic error handler", () => {
  test("POST /auth/register with a malformed email returns a 422 validation body, not internal_error", async () => {
    // Guards the VALIDATION exemption in withApiResponseMapping's onError:
    // TypeBox rejections must still surface Elysia's own structured 422,
    // not be replaced by the generic { error: "internal_error" } that every
    // other error code now gets.
    const resp = await app.handle(
      new Request("http://localhost/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "not-an-email", password: "long-enough-password" }),
      }),
    );
    expect(resp.status).toBe(422);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(body).not.toEqual({ error: "internal_error" });
    expect(body.type).toBe("validation");
    expect(body.on).toBe("body");
  });
});

describe("phone normalization at the route layer", () => {
  // Two spellings of ONE handset. Both must resolve to the same canonical
  // number, so the second request spends the same 3/hour budget rather than
  // opening a fresh one.
  const CANONICAL = "+6281199999402";
  const RESPELLED = "081199999402";

  beforeEach(async () => {
    await cleanupUser({ phone: CANONICAL });
  });

  test("POST /auth/otp/request rejects an unnormalizable phone with 400, not 429", async () => {
    const resp = await app.handle(
      new Request("http://localhost/auth/otp/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: "not-a-phone-at-all" }),
      }),
    );
    expect(resp.status).toBe(400);
    expect((await resp.json()) as { error: string }).toEqual({ error: "invalid_phone" });
  });

  test("respellings of one number share the 3/hour cap and return 429 on the fourth", async () => {
    async function requestFor(phone: string) {
      return app.handle(
        new Request("http://localhost/auth/otp/request", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ phone }),
        }),
      );
    }

    expect((await requestFor(CANONICAL)).status).toBe(200);
    expect((await requestFor(RESPELLED)).status).toBe(200);
    expect((await requestFor(`+62 ${CANONICAL.slice(3)}`)).status).toBe(200);

    // Fourth send to the same handset, spelled a fourth way -- refused.
    const fourth = await requestFor(`62${CANONICAL.slice(3)}`);
    expect(fourth.status).toBe(429);
    expect((await fourth.json()) as { error: string }).toEqual({ error: "rate_limited" });
  });
});
