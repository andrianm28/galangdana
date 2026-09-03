import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { paymentEvents } from "../schema/payment-events";

describe("payment_events", () => {
  test("provider + providerEventId is unique -- a duplicate insert rejects", async () => {
    const testId = `test-event-dedup-${Date.now()}`;
    await db.delete(paymentEvents).where(eq(paymentEvents.providerEventId, testId));
    await db.insert(paymentEvents).values({
      provider: "mock",
      providerEventId: testId,
      payload: { test: true },
    });
    let errorThrown = false;
    try {
      await db.insert(paymentEvents).values({
        provider: "mock",
        providerEventId: testId,
        payload: { test: true, second: true },
      });
    } catch (error) {
      if (error instanceof Error && /unique/i.test(error.message)) {
        errorThrown = true;
      } else {
        throw error;
      }
    }
    expect(errorThrown).toBe(true);
  });
});
