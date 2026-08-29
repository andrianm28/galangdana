import { HealthResponseSchema } from "@galangdana/contracts";
import { Elysia } from "elysia";

export const healthRoute = new Elysia().get(
  "/healthz",
  () => ({
    status: "ok" as const,
    service: "api",
    timestamp: new Date().toISOString(),
  }),
  { response: HealthResponseSchema },
);
