// Run as a fresh subprocess (see donations.test.ts's "fails closed when
// SUMOPOD_WEBHOOK_SECRET is unset" test) rather than imported directly by
// the test file -- donations.ts reads process.env.SUMOPOD_WEBHOOK_SECRET
// into a module-level const at import time, so deleting it from
// process.env after donations.ts is already imported (as it is at the top
// of donations.test.ts) would have no effect on that already-bound value.
// A fresh process is the only way to actually exercise the "unset at
// import time" code path.
import { donationsRoute } from "../donations";

const [svixId, svixTimestamp, signature, rawBody] = process.argv.slice(2);

const resp = await donationsRoute.handle(
  new Request("http://localhost/payments/webhook/sumopod", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": svixId ?? "",
      "svix-timestamp": svixTimestamp ?? "",
      "svix-signature": signature ?? "",
    },
    body: rawBody ?? "",
  }),
);

console.log(resp.status);
