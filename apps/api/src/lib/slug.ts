import { campaigns, db } from "@galangdana/db";
import { eq } from "drizzle-orm";

// Every top-level route segment named anywhere in the master plan's Module
// Map, not just what's implemented so far -- a slug generated today must
// not collide with a route a LATER phase builds either. Kept as a flat,
// append-only set rather than trying to derive it from the live route
// tree, since most of these routes don't exist in the codebase yet.
export const RESERVED_SLUGS = new Set([
  "explore",
  "category",
  "search",
  "lihatsemua",
  "product",
  "initiative",
  "campaign",
  "contribute",
  "donation",
  "create",
  "dashboard",
  "kyc",
  "verification",
  "donasi-otomatis",
  "zakat",
  "user",
  "setting",
  "inbox",
  "doa-orang-baik",
  "orang-baik",
  "apps",
  "org",
  "help",
  "admin",
  "about-us",
  "login",
  "register",
  "healthz",
  "_offline",
  "contact",
]);

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      // biome-ignore lint/suspicious/noMisleadingCharacterClass: combining diacriticals (U+0300-U+036F)
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
  );
}

/**
 * Generates a URL-safe slug from a campaign title, guaranteed unique
 * against both this project's reserved route segments and every existing
 * campaigns.slug row. Appends "-2", "-3", ... on collision.
 */
export async function generateUniqueSlug(title: string): Promise<string> {
  const base = slugify(title) || "campaign";
  let candidate = base;
  let suffix = 1;

  while (true) {
    const reserved = RESERVED_SLUGS.has(candidate);
    const existing = reserved
      ? [{ slug: candidate }]
      : await db
          .select({ slug: campaigns.slug })
          .from(campaigns)
          .where(eq(campaigns.slug, candidate));

    if (existing.length === 0) return candidate;

    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}
