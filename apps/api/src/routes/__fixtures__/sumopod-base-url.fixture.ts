import { db, donations, idempotencyKeys, payments } from "@fundforindonesia/db";
import { eq } from "drizzle-orm";
import { donationsRoute } from "../donations";

// Run as a fresh subprocess (see donations.test.ts's "Sumopod base URL
// configuration" describe) rather than imported directly by the test file --
// donations.ts reads process.env.SUMOPOD_BASE_URL into a module-level const
// at import time, so setting it in process.env after donations.ts is already
// imported (as it is at the top of donations.test.ts) would have no effect
// on that already-bound value. A fresh process is the only way to actually
// exercise the "set/unset at import time" code path.

const [campaignId] = process.argv.slice(2);
if (!campaignId) {
  console.error("usage: sumopod-base-url.fixture.ts <campaignId>");
  process.exit(1);
}

// Intercept the provider's charge call: capture WHERE it would POST and
// the return URLs it would send, and answer with a canned Sumopod-shaped
// success, so this fixture never touches the real network while still
// proving which base URL and return URLs the route used.
let capturedUrl: string | null = null;
let capturedBody = "";
globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
  capturedUrl = typeof input === "string" ? input : String(input);
  capturedBody = typeof init?.body === "string" ? init.body : "";
  return new Response(
    JSON.stringify({
      payment_id: `pay-fixture-${Date.now()}`,
      order_id: "fixture-order",
      payment_link_url: "https://sumopod.example.test/pay/fixture",
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}) as typeof fetch;

const idempotencyKey = crypto.randomUUID();
const resp = await donationsRoute.handle(
  new Request("http://localhost/donations", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({
      campaignId,
      amountStr: "50000",
      paymentMethod: "qris_redirect",
    }),
  }),
);
if (resp.status !== 200) {
  console.error(`POST /donations failed: ${resp.status} ${await resp.text()}`);
  process.exit(1);
}
const { donationId } = (await resp.json()) as { donationId: string };

// Clean up everything this fixture created -- the parent test file tracks
// the campaign itself and deletes it in afterAll.
await db.delete(payments).where(eq(payments.donationId, donationId));
await db.delete(donations).where(eq(donations.id, donationId));
await db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, idempotencyKey));

console.log(capturedUrl ?? "NO_CHARGE_CALL_MADE");
console.log(capturedBody || "NO_CHARGE_BODY");

// Close the postgres pool explicitly: unlike the fail-closed fixtures
// (which never reach the DB), this fixture writes rows, and the open pool
// would keep this subprocess alive forever so `proc.exited` never resolves.
await db.$client.end();
