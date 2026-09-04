vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

import { describe, expect, test, vi } from "vitest";

const REQUESTED_ITEM = {
  id: "11111111-1111-1111-1111-111111111111",
  campaignId: "22222222-2222-2222-2222-222222222222",
  campaignTitle: "Bantu Aldi Sembuh",
  type: "partial",
  amount: { amount: "500000", currency: "IDR" },
  status: "requested",
  createdAt: new Date().toISOString(),
};

const APPROVED_ITEM = {
  ...REQUESTED_ITEM,
  id: "33333333-3333-3333-3333-333333333333",
  campaignTitle: "Bantu Sari Sekolah",
  status: "approved",
};

describe("(admin) /disbursements load", () => {
  test("fetches both the requested and approved queues and merges them", async () => {
    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString());
      const status = url.searchParams.get("status");
      if (status === "requested") {
        return new Response(JSON.stringify({ disbursements: [REQUESTED_ITEM] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (status === "approved") {
        return new Response(JSON.stringify({ disbursements: [APPROVED_ITEM] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected status query on ${url.toString()}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { load } = await import("./+page.server");
    const result = (await load({ cookies: { get: () => "session-token" } } as never)) as {
      disbursements: Array<{ id: string; status: string }>;
    };

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.disbursements.map((d) => d.id)).toEqual([REQUESTED_ITEM.id, APPROVED_ITEM.id]);
    expect(result.disbursements.find((d) => d.id === APPROVED_ITEM.id)?.status).toBe("approved");
  });
});
