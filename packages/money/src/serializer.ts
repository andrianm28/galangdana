/**
 * `JSON.stringify` throws a TypeError on any `bigint`. Every money value in
 * this codebase is a bigint, so the API layer must never call the native
 * `JSON.stringify` on a response body directly — use this instead. Bigints
 * are serialized as decimal strings (not numbers, to avoid precision loss
 * for values beyond Number.MAX_SAFE_INTEGER).
 */
export function bigIntSafeJSONStringify(value: unknown, space?: number): string {
  return JSON.stringify(
    value,
    (_key, val) => (typeof val === "bigint" ? val.toString() : val),
    space,
  );
}
