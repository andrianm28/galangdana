import { afterAll, describe, expect, test } from "bun:test";
import {
  allocationPolicies,
  campaignCategories,
  campaigners,
  campaigns,
  db,
  donations,
  notificationsOutbox,
} from "@fundforindonesia/db";
import { eq, inArray } from "drizzle-orm";
import { TransportNotConfiguredError, processDueRows } from "./processor";

const campaignIds: string[] = [];
const donationIds: string[] = [];
const outboxIds: string[] = [];

async function seedPaidDonation(contactChannel: "email" | "whatsapp", contactValue: string) {
  const [category] = await db.select().from(campaignCategories).limit(1);
  const [campaigner] = await db.select().from(campaigners).limit(1);
  const [policy] = await db.select().from(allocationPolicies).limit(1);
  if (!category || !campaigner || !policy) throw new Error("seed first");
  const [campaign] = await db
    .insert(campaigns)
    .values({
      slug: `worker-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: "Worker Test",
      shortDescription: "t",
      categoryId: category.id,
      campaignerId: campaigner.id,
      type: "donation",
      currency: "IDR",
      model: "goal",
      goalAmount: 1000000n,
      status: "active",
      publishedAt: new Date(),
    })
    .returning();
  if (!campaign) throw new Error("campaign insert failed");
  campaignIds.push(campaign.id);
  const [donation] = await db
    .insert(donations)
    .values({
      campaignId: campaign.id,
      allocationPolicyId: policy.id,
      amount: 50000n,
      currency: "IDR",
      contactChannel,
      contactValue,
      displayName: "Worker UAT",
      status: "paid",
      paidAt: new Date(),
    })
    .returning();
  if (!donation) throw new Error("donation insert failed");
  donationIds.push(donation.id);
  return donation;
}

async function enqueue(channel: string, donationId: string) {
  const [row] = await db
    .insert(notificationsOutbox)
    .values({ channel, template: "donation_receipt", payload: { donationId } })
    .returning();
  if (!row) throw new Error("outbox insert failed");
  outboxIds.push(row.id);
  return row;
}

async function outboxStatus(id: string) {
  const [row] = await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.id, id));
  return row;
}

afterAll(async () => {
  if (outboxIds.length > 0)
    await db.delete(notificationsOutbox).where(inArray(notificationsOutbox.id, outboxIds));
  if (donationIds.length > 0) await db.delete(donations).where(inArray(donations.id, donationIds));
  if (campaignIds.length > 0) await db.delete(campaigns).where(inArray(campaigns.id, campaignIds));
});

function fakeTransports(sent: { to: string; kind: string }[]) {
  return {
    sendEmail: async (to: string) => {
      sent.push({ to, kind: "email" });
    },
    sendWhatsapp: async (to: string) => {
      sent.push({ to, kind: "whatsapp" });
    },
  };
}

describe("processDueRows", () => {
  test("sends a pending email receipt and marks it sent", async () => {
    const donation = await seedPaidDonation("email", "worker-test@example.test");
    const row = await enqueue("email", donation.id);
    const sent: { to: string; kind: string }[] = [];
    await processDueRows(fakeTransports(sent), { maxAttempts: 5 });
    expect(sent).toContainEqual({ to: "worker-test@example.test", kind: "email" });
    expect((await outboxStatus(row.id))?.status).toBe("sent");
  });

  test("sends a pending whatsapp receipt via the whatsapp transport", async () => {
    const donation = await seedPaidDonation("whatsapp", "+62819000099");
    const row = await enqueue("whatsapp", donation.id);
    const sent: { to: string; kind: string }[] = [];
    await processDueRows(fakeTransports(sent), { maxAttempts: 5 });
    expect(sent).toContainEqual({ to: "+62819000099", kind: "whatsapp" });
    expect((await outboxStatus(row.id))?.status).toBe("sent");
  });

  test("a failed send stays pending with attempts counted and a future retry", async () => {
    const donation = await seedPaidDonation("email", "retry@example.test");
    const row = await enqueue("email", donation.id);
    const failing = {
      sendEmail: async () => {
        throw new Error("smtp down");
      },
      sendWhatsapp: async () => {},
    };
    await processDueRows(failing, { maxAttempts: 5 });
    const after = await outboxStatus(row.id);
    expect(after?.status).toBe("pending");
    expect(after?.attempts).toBe(1);
    expect((after?.nextAttemptAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  test("marks the row failed once attempts reach the cap", async () => {
    const donation = await seedPaidDonation("email", "dead@example.test");
    const row = await enqueue("email", donation.id);
    const failing = {
      sendEmail: async () => {
        throw new Error("smtp down");
      },
      sendWhatsapp: async () => {},
    };
    await processDueRows(failing, { maxAttempts: 1 });
    expect((await outboxStatus(row.id))?.status).toBe("failed");
  });

  test("skips rows whose donation is gone without calling any transport", async () => {
    const row = await enqueue("email", "00000000-0000-0000-0000-000000000000");
    // Exploding transports: the skipped row must never reach a send call.
    // (Ambient pending rows from other suites may still be sent; only this
    // row's skipped status is asserted.)
    const exploding = {
      sendEmail: async () => {
        throw new Error("must not be called");
      },
      sendWhatsapp: async () => {
        throw new Error("must not be called");
      },
    };
    await processDueRows(exploding, { maxAttempts: 5 });
    expect((await outboxStatus(row.id))?.status).toBe("skipped");
  });

  test("defers whatsapp rows without a configured transport: no attempt counted", async () => {
    // Missing vendor config is not a send failure -- retrying on backoff
    // would burn all attempts and lose the receipt. The row waits instead.
    const donation = await seedPaidDonation("whatsapp", "+62819000112");
    const row = await enqueue("whatsapp", donation.id);
    const unconfigured = {
      sendEmail: async () => {},
      sendWhatsapp: async () => {
        throw new TransportNotConfiguredError("KIRIMDEV_API_KEY is not configured");
      },
    };
    await processDueRows(unconfigured, { maxAttempts: 5 });
    const after = await outboxStatus(row.id);
    expect(after?.status).toBe("pending");
    expect(after?.attempts).toBe(0);
    expect((after?.nextAttemptAt as Date).getTime()).toBeGreaterThan(Date.now() + 20 * 60 * 1000);
  });
});
