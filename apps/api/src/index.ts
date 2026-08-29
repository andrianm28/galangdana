import { Elysia } from "elysia";
import { withApiResponseMapping } from "./response-mapper";
import { authRoute } from "./routes/auth";
import { healthRoute } from "./routes/health";

// Every response body is run through the BigInt-safe serializer, so no
// route added later can accidentally hand a raw bigint to JSON.stringify
// and crash the response. Also preserves set.status, thrown-error status
// codes, and real Response objects returned directly from handlers -- see
// response-mapper.ts (shared with response-mapper.test.ts, so the two can
// never silently drift apart).
export const app = withApiResponseMapping(new Elysia()).use(healthRoute).use(authRoute);

export type App = typeof app;

if (import.meta.main) {
  const port = Number(process.env.API_PORT ?? 3001);
  app.listen(port);
  console.log(`API listening on http://localhost:${port}`);
}
