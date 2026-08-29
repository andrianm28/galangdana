import { describe, expect, test } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import { HealthResponseSchema } from "./health";

describe("HealthResponseSchema", () => {
  test("accepts a well-formed health payload", () => {
    const payload = { status: "ok", service: "api", timestamp: "2026-08-29T00:00:00.000Z" };
    expect(Value.Check(HealthResponseSchema, payload)).toBe(true);
  });

  test("rejects a payload missing required fields", () => {
    expect(Value.Check(HealthResponseSchema, { status: "ok" })).toBe(false);
  });
});
