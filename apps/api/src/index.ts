import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { initObservability, withRequestLogging } from "./lib/observability";
import { withApiResponseMapping } from "./response-mapper";
import { adminRoute } from "./routes/admin";
import { authRoute } from "./routes/auth";
import { bankAccountsRoute } from "./routes/bank-accounts";
import { campaignDraftsRoute } from "./routes/campaign-drafts";
import { campaignsRoute } from "./routes/campaigns";
import { categoriesRoute } from "./routes/categories";
import { disbursementsRoute } from "./routes/disbursements";
import { donationsRoute } from "./routes/donations";
import { healthRoute } from "./routes/health";
import { helpRoute } from "./routes/help";
import { searchRoute } from "./routes/search";

// Every response body is run through the BigInt-safe serializer, so no
// route added later can accidentally hand a raw bigint to JSON.stringify
// and crash the response. Also preserves set.status, thrown-error status
// codes, and real Response objects returned directly from handlers -- see
// response-mapper.ts (shared with response-mapper.test.ts, so the two can
// never silently drift apart).
// withRequestLogging wraps (not .use()s -- see observability.ts for why a
// mounted plugin's after-hooks never fire) so every route gets exactly one
// JSON access-log line. Order matters: the logger's onError must be
// registered BEFORE the response-mapper's, because Elysia stops the onError
// pipeline at the first hook that returns a body -- the mapper returns one,
// so a logger registered after it would never see error requests (verified
// empirically: error requests produced zero log lines until this swap).
// Sentry init is a no-op without SENTRY_DSN.
const observabilityOn = initObservability();
export const app = withApiResponseMapping(withRequestLogging(new Elysia()))
  // credentials: true + a specific origin (not `*`) is required for the
  // browser to actually attach the session cookie to a cross-origin
  // request -- verified directly against this repo's real elysia@1.1.26 +
  // @elysiajs/cors@1.1.1 (see this task's brief for the full spike).
  .use(
    cors({
      origin: process.env.PUBLIC_WEB_URL ?? "http://localhost:5173",
      credentials: true,
    }),
  )
  .use(healthRoute)
  .use(authRoute)
  .use(campaignsRoute)
  .use(categoriesRoute)
  .use(campaignDraftsRoute)
  .use(searchRoute)
  .use(adminRoute)
  .use(helpRoute)
  .use(donationsRoute)
  .use(bankAccountsRoute)
  .use(disbursementsRoute);

export type App = typeof app;

if (import.meta.main) {
  const port = Number(process.env.API_PORT ?? 3001);
  app.listen(port);
  console.log(`API listening on http://localhost:${port}`);
}
