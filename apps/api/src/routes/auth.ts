import {
  AuthErrorSchema,
  AuthSuccessSchema,
  LoginBodySchema,
  OtpRequestBodySchema,
  OtpVerifyBodySchema,
  RegisterBodySchema,
  SimpleSuccessSchema,
} from "@galangdana/contracts";
import type { User } from "@galangdana/db";
import { type Cookie, Elysia, t } from "elysia";
import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  findOrCreateGoogleUser,
} from "../auth/google-oauth";
import { requestOtp, verifyOtp } from "../auth/otp";
import { loginWithEmail, registerWithEmail } from "../auth/password";
import { generatePkceVerifier, generateState, pkceChallengeFromVerifier } from "../auth/pkce";
import { createSession, revokeSession } from "../auth/session";
import { sessionDerive } from "../lib/session";

const SESSION_COOKIE = "session";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * Elysia's cookie jar (createCookieJar) always returns a real Cookie proxy
 * for any name accessed on it -- verified empirically against this repo's
 * installed Elysia 1.1.26 -- but the jar's type is a plain
 * Record<string, Cookie<unknown>> index signature, so this repo's
 * noUncheckedIndexedAccess tsconfig setting sees `cookie[name]` as possibly
 * undefined. `cookie[name]?.value = x` isn't valid assignment syntax
 * either way, so every write site needs this narrowed -- centralized here
 * once instead of a bare `!` scattered through every handler.
 */
function requiredCookie(
  jar: Record<string, Cookie<unknown> | undefined>,
  name: string,
): Cookie<unknown> {
  // biome-ignore lint/style/noNonNullAssertion: see function doc comment above
  return jar[name]!;
}

/**
 * Every session (and OAuth-flow) cookie write goes through this, not
 * individual per-route assignments: the final whole-branch review found
 * every cookie write in this file missing `secure`/`sameSite` entirely,
 * which let the 30-day session token travel over plaintext HTTP and left
 * /auth/logout's state change exploitable via a plain cross-site form
 * POST (SameSite=Lax alone closes that: Lax cookies aren't attached to
 * cross-site POSTs). `secure` is gated on NODE_ENV rather than always-on
 * because local dev runs the API over plain http://localhost.
 */
function setAuthCookie(
  jar: Record<string, Cookie<unknown> | undefined>,
  name: string,
  value: string,
  maxAge: number,
  expires?: Date,
): void {
  const cookie = requiredCookie(jar, name);
  cookie.value = value;
  cookie.httpOnly = true;
  cookie.path = "/";
  cookie.secure = IS_PRODUCTION;
  cookie.sameSite = "lax";
  cookie.maxAge = maxAge;
  if (expires) cookie.expires = expires;
}

function clearAuthCookie(jar: Record<string, Cookie<unknown> | undefined>, name: string): void {
  const cookie = requiredCookie(jar, name);
  cookie.value = "";
  cookie.httpOnly = true;
  cookie.path = "/";
  cookie.secure = IS_PRODUCTION;
  cookie.sameSite = "lax";
  cookie.maxAge = 0;
}

function toUserResponse(user: User) {
  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
  };
}

export const authRoute = new Elysia({ prefix: "/auth" })
  .use(sessionDerive)
  .post(
    "/otp/request",
    async ({ body, set }) => {
      const result = await requestOtp(body.phone);
      if (!result.sent) {
        set.status = result.reason === "invalid_phone" ? 400 : 429;
        return { error: result.reason ?? "too_many_requests" };
      }
      return { success: true };
    },
    {
      body: OtpRequestBodySchema,
      response: { 200: SimpleSuccessSchema, 400: AuthErrorSchema, 429: AuthErrorSchema },
    },
  )
  .post(
    "/otp/verify",
    async ({ body, cookie, set }) => {
      const result = await verifyOtp(body.phone, body.code);
      if (!result.success || !result.user) {
        set.status = result.reason === "invalid_phone" ? 400 : 401;
        return { error: result.reason ?? "verification_failed" };
      }
      const { token, expiresAt } = await createSession(result.user.id);
      setAuthCookie(cookie, SESSION_COOKIE, token, SESSION_MAX_AGE_SECONDS, expiresAt);
      return { user: toUserResponse(result.user) };
    },
    {
      body: OtpVerifyBodySchema,
      response: { 200: AuthSuccessSchema, 400: AuthErrorSchema, 401: AuthErrorSchema },
    },
  )
  .post(
    "/register",
    async ({ body, cookie, set }) => {
      const result = await registerWithEmail(body.email, body.password, body.name);
      if (!result.success || !result.user) {
        set.status = result.reason === "rate_limited" ? 429 : 409;
        return { error: result.reason ?? "registration_failed" };
      }
      const { token, expiresAt } = await createSession(result.user.id);
      setAuthCookie(cookie, SESSION_COOKIE, token, SESSION_MAX_AGE_SECONDS, expiresAt);
      return { user: toUserResponse(result.user) };
    },
    {
      body: RegisterBodySchema,
      response: { 200: AuthSuccessSchema, 409: AuthErrorSchema, 429: AuthErrorSchema },
    },
  )
  .post(
    "/login",
    async ({ body, cookie, set }) => {
      const result = await loginWithEmail(body.email, body.password);
      if (!result.success || !result.user) {
        set.status = result.reason === "rate_limited" ? 429 : 401;
        return { error: result.reason ?? "login_failed" };
      }
      const { token, expiresAt } = await createSession(result.user.id);
      setAuthCookie(cookie, SESSION_COOKIE, token, SESSION_MAX_AGE_SECONDS, expiresAt);
      return { user: toUserResponse(result.user) };
    },
    {
      body: LoginBodySchema,
      response: { 200: AuthSuccessSchema, 401: AuthErrorSchema, 429: AuthErrorSchema },
    },
  )
  .post(
    "/logout",
    async ({ sessionToken, cookie, set }) => {
      if (sessionToken) {
        await revokeSession(sessionToken);
      }
      clearAuthCookie(cookie, SESSION_COOKIE);
      set.status = 200;
      return { success: true };
    },
    { response: { 200: SimpleSuccessSchema } },
  )
  .get(
    "/me",
    ({ user, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      return { user: toUserResponse(user) };
    },
    { response: { 200: AuthSuccessSchema, 401: AuthErrorSchema } },
  )
  .get(
    "/google",
    async ({ cookie, set }) => {
      const state = generateState();
      const verifier = generatePkceVerifier();
      const challenge = await pkceChallengeFromVerifier(verifier);
      setAuthCookie(cookie, "google_oauth_verifier", verifier, 600);
      // A second, separate cookie from the PKCE verifier: PKCE alone
      // already defeats the classic OAuth login-CSRF attack here
      // (Google's token endpoint rejects a code exchanged with a
      // verifier that doesn't match the code_challenge the code was
      // originally issued for), so state is checked as standard
      // defense-in-depth rather than generated and silently ignored.
      setAuthCookie(cookie, "google_oauth_state", state, 600);
      set.status = 302;
      set.headers.location = buildGoogleAuthUrl(state, challenge);
      return "";
    },
    { response: { 302: t.String() } },
  )
  .get(
    "/google/callback",
    async ({ query, cookie, set }) => {
      const webUrl = process.env.PUBLIC_WEB_URL ?? "http://localhost:5173";
      const verifier = cookie.google_oauth_verifier?.value;
      const expectedState = cookie.google_oauth_state?.value;
      const code = query.code;

      function redirectWithError(reason: string): string {
        clearAuthCookie(cookie, "google_oauth_verifier");
        clearAuthCookie(cookie, "google_oauth_state");
        set.status = 302;
        set.headers.location = `${webUrl}/?auth_error=${reason}`;
        return "";
      }

      if (!verifier || !code || !expectedState || query.state !== expectedState) {
        return redirectWithError("invalid_request");
      }

      // Every failure past this point -- a stale/expired code, Google
      // being unreachable, exchangeGoogleCode/fetchGoogleUserInfo
      // throwing on a non-2xx response -- used to propagate as an
      // uncaught exception, which this app's response mapping then
      // serialized directly to the client (proven in the final
      // whole-branch review: a downstream connection failure leaked
      // internal error fields like `errno`/`syscall`/`port`/`address`).
      // These are ordinary user-facing events (expired code, back-button
      // replay, upstream hiccup), not server faults -- redirect back to
      // the web app with a generic reason instead of ever returning the
      // raw error.
      try {
        const tokens = await exchangeGoogleCode(code, verifier);
        const profile = await fetchGoogleUserInfo(tokens.access_token);
        const result = await findOrCreateGoogleUser(profile);
        if (!result.success || !result.user) {
          return redirectWithError(result.reason ?? "google_auth_failed");
        }
        const { token, expiresAt } = await createSession(result.user.id);
        clearAuthCookie(cookie, "google_oauth_verifier");
        clearAuthCookie(cookie, "google_oauth_state");
        setAuthCookie(cookie, SESSION_COOKIE, token, SESSION_MAX_AGE_SECONDS, expiresAt);
        set.status = 302;
        set.headers.location = webUrl;
        return "";
      } catch (err) {
        console.error("Google OAuth callback failed:", err);
        return redirectWithError("google_auth_failed");
      }
    },
    {
      query: t.Object({ code: t.Optional(t.String()), state: t.Optional(t.String()) }),
      response: { 302: t.String() },
    },
  );
