import { Elysia } from "elysia";
import { validateSession } from "../auth/session";

export const SESSION_COOKIE = "session";

/**
 * Derives the current user from the session cookie on every request this
 * plugin is applied to. Downstream handlers read `user`/`sessionToken`
 * from context; both are `null` when there is no valid session, so a
 * protected route checks `if (!user) { set.status = 401; ... }` rather
 * than this plugin throwing. Shared across every route file that needs
 * auth (originally private to auth.ts; extracted here in Phase 2a when
 * campaign-drafts routes became the second consumer).
 */
export const sessionDerive = new Elysia().derive({ as: "scoped" }, async ({ cookie }) => {
  const token = cookie[SESSION_COOKIE]?.value;
  if (!token) return { user: null, sessionToken: null };
  const result = await validateSession(token);
  if (!result) return { user: null, sessionToken: null };
  return { user: result.user, sessionToken: token };
});
