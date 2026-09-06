vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

import { describe, expect, test, vi } from "vitest";

const PAID = {
  id: "11111111-1111-1111-1111-111111111111",
  campaignId: "22222222-2222-2222-2222-222222222222",
  campaignTitle: "Bantu Aldi Sembuh",
  campaignSlug: "bantu-aldi-sembuh",
  amount: { amount: "250000", currency: "IDR" },
  status: "paid",
  method: "bank_transfer_va",
  vaNumber: "88012345678901",
  redirectUrl: null,
  expiresAt: "2026-09-07T00:00:00.000Z",
  paidAt: "2026-09-06T03:20:00.000Z",
  displayName: "Budi",
};

function loadWith(donation: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(donation), {
          status,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
  return import("./+page.server.ts");
}

const params = { id: PAID.id };
const cookies = { get: () => undefined } as unknown as Parameters<
  Awaited<ReturnType<typeof loadWith>>["load"]
>[0]["cookies"];

describe("(consumer) donation/[id]/kuitansi load", () => {
  test("serves the receipt for a settled donation", async () => {
    const { load } = await loadWith(PAID);
    // biome-ignore lint/suspicious/noExplicitAny: SvelteKit's load event has far more fields than this load reads
    const result = await load({ params, cookies } as any);
    expect((result as { donation: { id: string } }).donation.id).toBe(PAID.id);
  });

  for (const status of ["pending", "expired", "failed"] as const) {
    test(`refuses to issue a receipt for a ${status} donation`, async () => {
      // A kuitansi says money arrived. Printing one before it has is a
      // forgery the platform issued about itself.
      const { load } = await loadWith({ ...PAID, status, paidAt: null });
      // biome-ignore lint/suspicious/noExplicitAny: SvelteKit's load event has far more fields than this load reads
      await expect(load({ params, cookies } as any)).rejects.toMatchObject({ status: 404 });
    });
  }

  test("404s when the donation does not exist", async () => {
    const { load } = await loadWith({ error: "donation_not_found" }, 404);
    // biome-ignore lint/suspicious/noExplicitAny: SvelteKit's load event has far more fields than this load reads
    await expect(load({ params, cookies } as any)).rejects.toMatchObject({ status: 404 });
  });
});
