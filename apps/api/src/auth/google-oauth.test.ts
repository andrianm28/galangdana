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
  // email_verified: true is the ordinary case for a real Google account
  // signing in with its own address. It is now REQUIRED for the
  // link-to-a-pre-existing-account branch (see the fail-closed test at the
  // bottom of this block); the create-a-brand-new-account branch doesn't
  // need it, since there is no pre-existing account to take over.
  const mockProfile = {
    sub: "google-sub-test-fc-1",
    email: "test-fc-1@example.test",
    email_verified: true,
    name: "FC Test",
  };

  beforeEach(async () => {
    await db.delete(users).where(eq(users.email, mockProfile.email));
  });

  test("creates a new user and links the Google account on first sign-in", async () => {
    const result = await findOrCreateGoogleUser(mockProfile);
    expect(result.success).toBe(true);
    expect(result.user?.email).toBe(mockProfile.email);

    const [link] = await db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.providerAccountId, mockProfile.sub));
    expect(link?.userId).toBe(result.user?.id);
  });

  test("returns the same user on a second sign-in with the same Google account", async () => {
    const first = await findOrCreateGoogleUser(mockProfile);
    const second = await findOrCreateGoogleUser(mockProfile);
    expect(second.success).toBe(true);
    expect(second.user?.id).toBe(first.user?.id);
  });

  test("links to an existing user with a matching email rather than creating a duplicate", async () => {
    const [existing] = await db
      .insert(users)
      .values({ email: mockProfile.email, name: "Pre-existing" })
      .returning();

    const result = await findOrCreateGoogleUser(mockProfile);
    expect(result.success).toBe(true);
    // biome-ignore lint/style/noNonNullAssertion: inserted above
    expect(result.user?.id).toBe(existing!.id);
  });

  test("links to a user created via a different auth method (e.g. registerWithEmail) with the same email, without throwing", async () => {
    // Simulates what registerWithEmail (Task 6) would have produced for this
    // email a moment earlier: a users row with a passwordHash, no Google
    // link yet. Before the fix, findOrCreateGoogleUser's create-branch
    // insert had no onConflictDoNothing at all, so if this row existed the
    // insert would throw an unhandled unique-constraint exception instead
    // of falling back to the existing row.
    const [existing] = await db
      .insert(users)
      .values({ email: mockProfile.email, passwordHash: "x" })
      .returning();

    const result = await findOrCreateGoogleUser(mockProfile);
    expect(result.success).toBe(true);
    // biome-ignore lint/style/noNonNullAssertion: inserted above
    expect(result.user?.id).toBe(existing!.id);

    const [link] = await db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.providerAccountId, mockProfile.sub));
    // biome-ignore lint/style/noNonNullAssertion: inserted above
    expect(link?.userId).toBe(existing!.id);
  });

  test("does not link to a pre-existing account when Google has not verified the email", async () => {
    // The account-takeover shape the final whole-branch review flagged: a
    // Google account whose email address Google itself has NOT verified
    // must not be silently linked to somebody else's existing
    // password/OTP account just because the strings match.
    const [existing] = await db
      .insert(users)
      .values({ email: mockProfile.email, passwordHash: "x" })
      .returning();
    expect(existing).toBeDefined();

    const result = await findOrCreateGoogleUser({ ...mockProfile, email_verified: false });
    expect(result.success).toBe(false);
    expect(result.reason).toBe("email_not_verified");
    expect(result.user).toBeUndefined();

    // Fail CLOSED: no oauth link may have been written on the way out.
    const links = await db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.providerAccountId, mockProfile.sub));
    expect(links.length).toBe(0);
  });

  test("an absent email_verified field is treated as unverified (fail closed)", async () => {
    // Google omits the claim rather than sending false in some responses;
    // an absent claim is not evidence of verification.
    const { email_verified: _omitted, ...withoutClaim } = mockProfile;
    await db.insert(users).values({ email: mockProfile.email, passwordHash: "x" });

    const result = await findOrCreateGoogleUser(withoutClaim);
    expect(result.success).toBe(false);
    expect(result.reason).toBe("email_not_verified");
  });

  test("normalizes the Google email, matching a mixed-case local account", async () => {
    // A local account registered as "Test-FC-1@Example.test" is stored
    // lowercased by registerWithEmail; Google asserts the lowercase form.
    // Both sides normalize, so they resolve to one account instead of the
    // insert colliding or a duplicate being created.
    const [existing] = await db
      .insert(users)
      .values({ email: mockProfile.email, passwordHash: "x" })
      .returning();

    const result = await findOrCreateGoogleUser({
      ...mockProfile,
      email: "  Test-FC-1@Example.TEST  ",
    });
    expect(result.success).toBe(true);
    // biome-ignore lint/style/noNonNullAssertion: inserted above
    expect(result.user?.id).toBe(existing!.id);
  });
});
