import { bigIntSafeJSONStringify } from "@galangdana/money";
import { Elysia } from "elysia";
import { healthRoute } from "./routes/health";

export const app = new Elysia()
  // Every response body is run through the BigInt-safe serializer, so no
  // route added later can accidentally hand a raw bigint to JSON.stringify
  // and crash the response.
  .mapResponse(({ response }) => {
    if (response === undefined) return;
    return new Response(bigIntSafeJSONStringify(response), {
      headers: { "content-type": "application/json" },
    });
  })
  .use(healthRoute);

export type App = typeof app;

if (import.meta.main) {
  const port = Number(process.env.API_PORT ?? 3001);
  app.listen(port);
  console.log(`API listening on http://localhost:${port}`);
}
