import { db } from "../client";
import { allocationPolicies } from "../schema/allocation-policies";

export async function seedAllocationPolicies(): Promise<void> {
  const existing = await db.select().from(allocationPolicies).limit(1);
  if (existing.length > 0) {
    console.log("Allocation policies already seeded, skipping.");
    return;
  }
  await db
    .insert(allocationPolicies)
    .values({ name: "default", platformFeeBps: 0, isDefault: true });
  console.log("Seeded 1 default allocation policy (0% platform fee).");
}
