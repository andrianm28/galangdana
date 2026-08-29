import { describe, expect, test } from "bun:test";
import { type HealthResponse, HealthResponseSchema } from "@galangdana/contracts";
import { Value } from "@sinclair/typebox/value";
import { app } from "../index";

describe("GET /healthz", () => {
  test("returns a well-formed, schema-valid health payload", async () => {
    const response = await app.handle(new Request("http://localhost/healthz"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as HealthResponse;
    expect(Value.Check(HealthResponseSchema, body)).toBe(true);
    expect(body.status).toBe("ok");
    expect(body.service).toBe("api");
  });
});
