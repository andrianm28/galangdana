import { db, oauthAccounts, users } from "@galangdana/db";
import type { User } from "@galangdana/db";
import { and, eq } from "drizzle-orm";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

// A plain callable type, not `typeof fetch`: Bun's global `fetch` is declared
// as a function merged with a `namespace fetch { export function preconnect
// ... }`, so `typeof fetch` requires a `.preconnect` property alongside the
// call signature. A test's mock `fetch` implementation is an ordinary async
// arrow function with no `preconnect`, so it structurally fails `typeof
// fetch` even though it's perfectly callable the one way this module ever
// calls it. This type captures only the call signature actually used.
export type GoogleFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function googleClientId(): string {
  return process.env.GOOGLE_CLIENT_ID ?? "";
}
function googleClientSecret(): string {
  return process.env.GOOGLE_CLIENT_SECRET ?? "";
}
function googleRedirectUri(): string {
  return process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3001/auth/google/callback";
}

export function buildGoogleAuthUrl(state: string, codeChallenge: string): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", googleClientId());
  url.searchParams.set("redirect_uri", googleRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export interface GoogleTokens {
  access_token: string;
  id_token?: string;
}

export async function exchangeGoogleCode(
  code: string,
  codeVerifier: string,
  fetchImpl: GoogleFetch = fetch,
): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    client_id: googleClientId(),
    client_secret: googleClientSecret(),
    redirect_uri: googleRedirectUri(),
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
  });

  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) {
    throw new Error(`Google token exchange failed: ${response.status}`);
  }
  return (await response.json()) as GoogleTokens;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

export async function fetchGoogleUserInfo(
  accessToken: string,
  fetchImpl: GoogleFetch = fetch,
): Promise<GoogleProfile> {
  const response = await fetchImpl(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Google userinfo fetch failed: ${response.status}`);
  }
  return (await response.json()) as GoogleProfile;
}

export async function findOrCreateGoogleUser(profile: GoogleProfile): Promise<User> {
  const [linked] = await db
    .select({ user: users })
    .from(oauthAccounts)
    .innerJoin(users, eq(oauthAccounts.userId, users.id))
    .where(
      and(eq(oauthAccounts.provider, "google"), eq(oauthAccounts.providerAccountId, profile.sub)),
    );
  if (linked) {
    return linked.user;
  }

  const [existingByEmail] = await db.select().from(users).where(eq(users.email, profile.email));
  if (existingByEmail) {
    await db
      .insert(oauthAccounts)
      .values({ userId: existingByEmail.id, provider: "google", providerAccountId: profile.sub });
    return existingByEmail;
  }

  const [created] = await db
    .insert(users)
    .values({ email: profile.email, name: profile.name, avatarUrl: profile.picture })
    .returning();
  // biome-ignore lint/style/noNonNullAssertion: insert().returning() on a single-row insert always returns that row
  const createdUser = created!;
  await db
    .insert(oauthAccounts)
    .values({ userId: createdUser.id, provider: "google", providerAccountId: profile.sub });
  return createdUser;
}
