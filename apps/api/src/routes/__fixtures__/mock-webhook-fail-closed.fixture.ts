// Run as a fresh subprocess (see donations.test.ts's "fails closed when
// MOCK_MIDTRANS_SERVER_KEY is unset" test), mirroring
// sumopod-webhook-fail-closed.fixture.ts -- donations.ts reads
// process.env.MOCK_MIDTRANS_SERVER_KEY into a module-level const at import
// time, so deleting it from process.env after donations.ts is already
// imported (as it is at the top of donations.test.ts) would have no effect
// on that already-bound value. A fresh process is the only way to actually
// exercise the "unset at import time" code path.
import { donationsRoute } from "../donations";

const rawBody = process.argv[2];

const resp = await donationsRoute.handle(
  new Request("http://localhost/payments/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: rawBody ?? "",
  }),
);

console.log(resp.status);
