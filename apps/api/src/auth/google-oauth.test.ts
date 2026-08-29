import { beforeEach, describe, expect, test } from "bun:test";
import { db, oauthAccounts, users } from "@galangdana/db";
import { eq } from "drizzle-orm";
import {
  type GoogleFetch,
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  findOrCreateGoogleUser,
} from "./google-oauth";

describe("buildGoogleAuthUrl", () => {
  test("includes the state and PKCE code challenge in the URL", () => {
    const url = buildGoogleAuthUrl("test-state-value", "test-code-challenge");
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(parsed.searchParams.get("state")).toBe("test-state-value");
    expect(parsed.searchParams.get("code_challenge")).toBe("test-code-challenge");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("response_type")).toBe("code");
  });
});

describe("exchangeGoogleCode", () => {
  test("posts the code and verifier to Google's token endpoint and returns the tokens", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: string | undefined;
    const mockFetch: GoogleFetch = async (url, init) => {
      capturedUrl = String(url);
      capturedBody = String(init?.body);
      return new Response(
        JSON.stringify({ access_token: "mock-access-token", id_token: "mock-id-token" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    const tokens = await exchangeGoogleCode("mock-auth-code", "mock-code-verifier", mockFetch);
    expect(capturedUrl).toBe("https://oauth2.googleapis.com/token");
    expect(capturedBody).toContain("code=mock-auth-code");
    expect(capturedBody).toContain("code_verifier=mock-code-verifier");
    expect(tokens.access_token).toBe("mock-access-token");
  });
});

describe("fetchGoogleUserInfo", () => {
  test("sends the access token as a bearer header and returns the profile", async () => {
    let capturedAuth: string | null = null;
    const mockFetch: GoogleFetch = async (_url, init) => {
      capturedAuth = new Headers(init?.headers).get("authorization");
      return new Response(
        JSON.stringify({ sub: "google-sub-mock-1", email: "mock@example.test", name: "Mock User" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const profile = await fetchGoogleUserInfo("mock-access-token", mockFetch);
    // `as string | null` re-asserts the declared type: TypeScript's control
    // flow analysis narrows `capturedAuth` to its initializer's literal type
    // (`null`) here because the only assignment it tracks in THIS function's
    // flow graph is `= null` above -- the reassignment inside the `mockFetch`
    // closure lives in a separate flow graph that a call like
    // `fetchGoogleUserInfo(...)` doesn't get credit for having run. Without
    // this, `expect(capturedAuth)` infers `Matchers<null>` and `.toBe(...)`
    // rejects the real string value as a type error, even though the runtime
    // assertion is correct (proven by the 6/6 passing test run).
    expect(capturedAuth as string | null).toBe("Bearer mock-access-token");
    expect(profile.sub).toBe("google-sub-mock-1");
    expect(profile.email).toBe("mock@example.test");
  });
});

describe("findOrCreateGoogleUser", () => {
  const mockProfile = {
    sub: "google-sub-test-fc-1",
    email: "test-fc-1@example.test",
    name: "FC Test",
  };

  beforeEach(async () => {
    await db.delete(users).where(eq(users.email, mockProfile.email));
  });

  test("creates a new user and links the Google account on first sign-in", async () => {
    const user = await findOrCreateGoogleUser(mockProfile);
    expect(user.email).toBe(mockProfile.email);

    const [link] = await db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.providerAccountId, mockProfile.sub));
    expect(link?.userId).toBe(user.id);
  });

  test("returns the same user on a second sign-in with the same Google account", async () => {
    const first = await findOrCreateGoogleUser(mockProfile);
    const second = await findOrCreateGoogleUser(mockProfile);
    expect(second.id).toBe(first.id);
  });

  test("links to an existing user with a matching email rather than creating a duplicate", async () => {
    const [existing] = await db
      .insert(users)
      .values({ email: mockProfile.email, name: "Pre-existing" })
      .returning();

    const linked = await findOrCreateGoogleUser(mockProfile);
    // biome-ignore lint/style/noNonNullAssertion: inserted above
    expect(linked.id).toBe(existing!.id);
  });
});
