import { FormatRegistry, type Static, Type } from "@sinclair/typebox";

// Required: without a registered "date-time" checker, TypeBox's Value.Check
// rejects every payload matching a schema that uses format: "date-time",
// valid or not. Date.parse returning NaN is JavaScript's standard way to
// detect an unparseable date string.
FormatRegistry.Set("date-time", (value) => !Number.isNaN(Date.parse(value)));

export const HealthResponseSchema = Type.Object({
  status: Type.Literal("ok"),
  service: Type.String(),
  timestamp: Type.String({ format: "date-time" }),
});

export type HealthResponse = Static<typeof HealthResponseSchema>;
