import type { User } from "@galangdana/db";

/**
 * The admin authorization gate, checked inline at the top of every
 * /admin/* route handler -- matching this codebase's established idiom
 * (sessionDerive never rejects on its own; each handler checks `user`
 * itself). Unlike the ownership-scoped 404-not-403 pattern every other
 * endpoint in this codebase uses, admin routes are role-scoped: a 403
 * for "authenticated but not an admin" is the correct, intentional
 * signal here -- there's no reason to hide that /admin/* exists from a
 * non-admin user the way ownership-scoped routes hide a campaign's
 * existence from a non-owner.
 */
export function checkAdmin(user: User | null): { status: 401 | 403 } | null {
  if (!user) return { status: 401 };
  if (user.role !== "admin") return { status: 403 };
  return null;
}
