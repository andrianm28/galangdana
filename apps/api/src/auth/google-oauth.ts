import { db, oauthAccounts, users } from "@galangdana/db";
import type { User } from "@galangdana/db";
import { and, eq } from "drizzle-orm";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

// A narrow callable type, not `typeof fetch`: Bun's global `fetch` is a
// function+namespace merge (it also carries a static `.preconnect` method),
// so under this repo's tsconfig (no DOM lib) a plain mock function assigned
// to a `typeof fetch`-typed parameter fails to typecheck ("Property
// 'preconnect' is missing") even though it's perfectly callable at runtime.
// Reproduced and confirmed against this repo's actual tsconfig before this
// plan was corrected.
export type GoogleFetch = (url: string, init?: RequestInit) => Promise<Response>;

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

  // Atomic insert-or-select on users.email, not a SELECT then a
  // conditional INSERT: two concurrent signups for the SAME email via
  // DIFFERENT auth methods (e.g. this Google flow and registerWithEmail's
  // email/password path both completing around the same instant) could
  // otherwise both pass a "no existing user" check, and this function's
  // insert had NO conflict guard at all -- it would throw an unhandled
  // unique-constraint exception instead of gracefully picking up whichever
  // row actually won. onConflictDoNothing makes a colliding insert affect
  // zero rows (verified empirically: a pre-existing row causes this insert
  // to return undefined, and a plain SELECT then finds that same row).
  const [created] = await db
    .insert(users)
    .values({ email: profile.email, name: profile.name, avatarUrl: profile.picture })
    .onConflictDoNothing({ target: users.email })
    .returning();

  const [existing] = created
    ? []
    : await db.select().from(users).where(eq(users.email, profile.email));
  const user = created ?? existing;
  if (!user) {
    throw new Error(
      `findOrCreateGoogleUser: no user found for ${profile.email} after insert-or-select`,
    );
  }

  // Same reasoning applied to the link itself: two truly concurrent Google
  // sign-ins for the same profile (e.g. two browser tabs) could both reach
  // this point and both try to link the same (provider, providerAccountId)
  // pair -- onConflictDoNothing on the composite unique index makes the
  // second one a no-op instead of a thrown exception. Verified empirically
  // against the real composite unique index.
  await db
    .insert(oauthAccounts)
    .values({ userId: user.id, provider: "google", providerAccountId: profile.sub })
    .onConflictDoNothing({ target: [oauthAccounts.provider, oauthAccounts.providerAccountId] });

  return user;
}
