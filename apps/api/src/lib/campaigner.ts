import { type Campaigner, campaigners, db, users } from "@galangdana/db";
import { eq } from "drizzle-orm";

/**
 * Resolves the requesting user's own `campaigners` row, creating one
 * (type: "individual") on first use. This is intentionally the simplest
 * viable auth linkage -- no separate "become a campaigner" flow, no
 * organization onboarding (that's a distinct, out-of-scope track).
 */
export async function getOrCreateCampaignerForUser(userId: string): Promise<Campaigner> {
  const [existing] = await db.select().from(campaigners).where(eq(campaigners.userId, userId));
  if (existing) return existing;

  const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));

  const [created] = await db
    .insert(campaigners)
    .values({
      type: "individual",
      displayName: user?.name ?? "Penggalang Dana",
      userId,
    })
    .returning();
  if (!created) throw new Error("campaigner creation failed");
  return created;
}
