import {
  AuthErrorSchema,
  AuthSuccessSchema,
  LoginBodySchema,
  OtpRequestBodySchema,
  OtpVerifyBodySchema,
  RegisterBodySchema,
  SimpleSuccessSchema,
  UserSchema,
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
import { createSession, revokeSession, validateSession } from "../auth/session";

const SESSION_COOKIE = "session";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

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

function toUserResponse(user: User) {
  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
  };
}

/**
 * Derives the current user from the session cookie on every request this
 * plugin is applied to. Downstream handlers read `user`/`session` from
 * context; both are `null` when there is no valid session, so a protected
 * route checks `if (!user) { set.status = 401; return ... }` rather than
 * this plugin throwing.
 */
const sessionDerive = new Elysia().derive({ as: "scoped" }, async ({ cookie }) => {
  const token = cookie[SESSION_COOKIE]?.value;
  if (!token) return { user: null, sessionToken: null };
  const result = await validateSession(token);
  if (!result) return { user: null, sessionToken: null };
  return { user: result.user, sessionToken: token };
});

export const authRoute = new Elysia({ prefix: "/auth" })
  .use(sessionDerive)
  .post(
    "/otp/request",
    async ({ body, set }) => {
      const result = await requestOtp(body.phone);
      if (!result.sent) {
        set.status = 429;
        return { error: "too_many_requests" };
      }
      return { success: true };
    },
    { body: OtpRequestBodySchema, response: { 200: SimpleSuccessSchema, 429: AuthErrorSchema } },
  )
  .post(
    "/otp/verify",
    async ({ body, cookie, set }) => {
      const result = await verifyOtp(body.phone, body.code);
      if (!result.success || !result.user) {
        set.status = 401;
        return { error: result.reason ?? "verification_failed" };
      }
      const { token, expiresAt } = await createSession(result.user.id);
      const sessionCookie = requiredCookie(cookie, SESSION_COOKIE);
      sessionCookie.value = token;
      sessionCookie.httpOnly = true;
      sessionCookie.path = "/";
      sessionCookie.maxAge = SESSION_MAX_AGE_SECONDS;
      sessionCookie.expires = expiresAt;
      return { user: toUserResponse(result.user) };
    },
    { body: OtpVerifyBodySchema, response: { 200: AuthSuccessSchema, 401: AuthErrorSchema } },
  )
  .post(
    "/register",
    async ({ body, cookie, set }) => {
      const result = await registerWithEmail(body.email, body.password, body.name);
      if (!result.success || !result.user) {
        set.status = 409;
        return { error: result.reason ?? "registration_failed" };
      }
      const { token, expiresAt } = await createSession(result.user.id);
      const sessionCookie = requiredCookie(cookie, SESSION_COOKIE);
      sessionCookie.value = token;
      sessionCookie.httpOnly = true;
      sessionCookie.path = "/";
      sessionCookie.maxAge = SESSION_MAX_AGE_SECONDS;
      sessionCookie.expires = expiresAt;
      return { user: toUserResponse(result.user) };
    },
    { body: RegisterBodySchema, response: { 200: AuthSuccessSchema, 409: AuthErrorSchema } },
  )
  .post(
    "/login",
    async ({ body, cookie, set }) => {
      const result = await loginWithEmail(body.email, body.password);
      if (!result.success || !result.user) {
        set.status = 401;
        return { error: result.reason ?? "login_failed" };
      }
      const { token, expiresAt } = await createSession(result.user.id);
      const sessionCookie = requiredCookie(cookie, SESSION_COOKIE);
      sessionCookie.value = token;
      sessionCookie.httpOnly = true;
      sessionCookie.path = "/";
      sessionCookie.maxAge = SESSION_MAX_AGE_SECONDS;
      sessionCookie.expires = expiresAt;
      return { user: toUserResponse(result.user) };
    },
    { body: LoginBodySchema, response: { 200: AuthSuccessSchema, 401: AuthErrorSchema } },
  )
  .post(
    "/logout",
    async ({ sessionToken, cookie, set }) => {
      if (sessionToken) {
        await revokeSession(sessionToken);
      }
      const sessionCookie = requiredCookie(cookie, SESSION_COOKIE);
      sessionCookie.value = "";
      sessionCookie.maxAge = 0;
      sessionCookie.path = "/";
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
  .get("/google", async ({ cookie, set }) => {
    const state = generateState();
    const verifier = generatePkceVerifier();
    const challenge = await pkceChallengeFromVerifier(verifier);
    const verifierCookie = requiredCookie(cookie, "google_oauth_verifier");
    verifierCookie.value = verifier;
    verifierCookie.httpOnly = true;
    verifierCookie.path = "/";
    verifierCookie.maxAge = 600;
    // A second, separate cookie from the PKCE verifier: PKCE alone already
    // defeats the classic OAuth login-CSRF attack here (Google's token
    // endpoint rejects a code exchanged with a verifier that doesn't match
    // the code_challenge the code was originally issued for, so a forged
    // callback using an attacker's own authorization code fails at the
    // token-exchange step regardless of state). state is still checked as
    // standard defense-in-depth rather than generated and silently ignored
    // -- verified empirically (matching state -> 200, mismatched -> 400).
    const stateCookie = requiredCookie(cookie, "google_oauth_state");
    stateCookie.value = state;
    stateCookie.httpOnly = true;
    stateCookie.path = "/";
    stateCookie.maxAge = 600;
    set.status = 302;
    set.headers.location = buildGoogleAuthUrl(state, challenge);
    return "";
  })
  .get(
    "/google/callback",
    async ({ query, cookie, set }) => {
      const verifier = cookie.google_oauth_verifier?.value;
      const expectedState = cookie.google_oauth_state?.value;
      const code = query.code;
      if (!verifier || !code || !expectedState || query.state !== expectedState) {
        set.status = 400;
        return { error: "missing_code_or_verifier" };
      }
      const tokens = await exchangeGoogleCode(code, verifier);
      const profile = await fetchGoogleUserInfo(tokens.access_token);
      const user = await findOrCreateGoogleUser(profile);
      const { token, expiresAt } = await createSession(user.id);
      const sessionCookie = requiredCookie(cookie, SESSION_COOKIE);
      sessionCookie.value = token;
      sessionCookie.httpOnly = true;
      sessionCookie.path = "/";
      sessionCookie.maxAge = SESSION_MAX_AGE_SECONDS;
      sessionCookie.expires = expiresAt;
      const clearedVerifierCookie = requiredCookie(cookie, "google_oauth_verifier");
      clearedVerifierCookie.value = "";
      clearedVerifierCookie.maxAge = 0;
      const clearedStateCookie = requiredCookie(cookie, "google_oauth_state");
      clearedStateCookie.value = "";
      clearedStateCookie.maxAge = 0;
      set.status = 302;
      set.headers.location = process.env.PUBLIC_WEB_URL ?? "http://localhost:5173";
      return "";
    },
    { query: t.Object({ code: t.Optional(t.String()), state: t.Optional(t.String()) }) },
  );
