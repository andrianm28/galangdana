import { FormatRegistry, type Static, Type } from "@sinclair/typebox";

// Register date-time format for validation
FormatRegistry.Set("date-time", () => true);

export const HealthResponseSchema = Type.Object({
  status: Type.Literal("ok"),
  service: Type.String(),
  timestamp: Type.String({ format: "date-time" }),
});

export type HealthResponse = Static<typeof HealthResponseSchema>;
