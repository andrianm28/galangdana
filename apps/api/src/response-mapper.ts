import { bigIntSafeJSONStringify } from "@galangdana/money";
import type { AnyElysia } from "elysia";

/**
 * Wires the shared response-mapping behavior onto an Elysia instance.
 * Used both by the real app (see index.ts) and by tests that build a
 * throwaway instance with the exact same behavior, so response-shaping
 * tests can never silently drift from what production actually does.
 *
 * Responsibilities, all required because Elysia's own `.mapResponse()`
 * default behavior does none of this:
 *  - BigInt-safe JSON serialization (money values are bigints, and the
 *    native JSON.stringify throws on them).
 *  - Preserve `set.status` (e.g. `set.status = 404`) instead of always
 *    answering 200.
 *  - Preserve a real `Response` object returned directly from a handler
 *    instead of replacing its body with `{}`.
 *  - Let a thrown error flow through with Elysia's own default error
 *    status (500) instead of being coerced into `200 {}`.
 */
export function withApiResponseMapping<T extends AnyElysia>(instance: T) {
  return instance.mapResponse(({ response, set }) => {
    if (response === undefined) return;
    if (response instanceof Response) return response;
    return new Response(bigIntSafeJSONStringify(response), {
      status: typeof set.status === "number" ? set.status : 200,
      headers: { "content-type": "application/json" },
    });
  });
}
