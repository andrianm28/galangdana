import { bigIntSafeJSONStringify } from "@fundforindonesia/money";
import type { AnyElysia } from "elysia";

/**
 * Wires the shared response-mapping behavior onto an Elysia instance.
 * Used both by the real app (see index.ts) and by tests that build a
 * throwaway instance with the exact same behavior, so response-shaping
 * tests can never silently drift from what production actually does.
 *
 * Responsibilities, all required because Elysia's own default behavior
 * does none of this:
 *  - BigInt-safe JSON serialization (money values are bigints, and the
 *    native JSON.stringify throws on them).
 *  - Preserve `set.status` (e.g. `set.status = 404`) instead of always
 *    answering 200.
 *  - Preserve a real `Response` object returned directly from a handler
 *    instead of replacing its body with `{}`.
 *  - Replace an unhandled thrown error's body with a generic message
 *    instead of serializing the thrown value's own enumerable
 *    properties straight to the client -- proven exploitable in the
 *    final whole-branch review (a real connection error leaked
 *    `{"errno":-111,"syscall":"connect","port":1,"address":
 *    "127.0.0.1","code":"ECONNREFUSED"}`, i.e. internal network
 *    topology, to any caller who could trigger a failure). VALIDATION
 *    errors are exempted -- Elysia's own 422 body for those is already
 *    safe and structured, and IS the intended response.
 */
export function withApiResponseMapping<T extends AnyElysia>(instance: T) {
  return instance
    .onError(({ code, error, set }) => {
      if (code === "VALIDATION") return;
      console.error("Unhandled error:", error);
      // The status comes off the error object, NOT off `set.status`, and
      // this is load-bearing -- all four behaviors below were established
      // empirically against this repo's Elysia 1.1.26 before this was
      // written, and three of them are not what you'd guess:
      //  - NOT_FOUND reaches onError with `set.status` still 200 and the
      //    real 404 only on `error.status`, so keying off `set.status`
      //    would silently turn every 404 into a 500.
      //  - PARSE likewise carries its 400 on `error.status`.
      //  - A thrown value's OWN `code` property becomes Elysia's `code`
      //    argument -- the real leak the review found reported as
      //    `code: "ECONNREFUSED"`, not `"UNKNOWN"`. Exempting by code
      //    name (an "only intercept UNKNOWN" guard) would therefore have
      //    missed precisely the case being fixed, which is why this
      //    intercepts everything except VALIDATION.
      //  - A plain thrown Error carries no `status` at all, hence 500.
      //
      // `errorStatus` is also range-clamped, not used as-is: a thrown
      // value fully controls its own `status` property (same as `code`
      // above), and `new Response(..., { status })` throws a RangeError
      // for anything outside 200-599 -- an attacker-shaped error with an
      // out-of-range status would otherwise crash this handler itself.
      const errorStatus = (error as { status?: unknown }).status;
      const status =
        typeof errorStatus === "number" && errorStatus >= 400 && errorStatus <= 599
          ? errorStatus
          : 500;
      set.status = status;
      // "not_found" is a plain re-labeling of the status, not a code-name
      // exemption -- the raw error body still never escapes either way,
      // so an attacker-controlled `code`/`status` can only pick which of
      // these two generic strings comes back, never real error content.
      return { error: status === 404 ? "not_found" : "internal_error" };
    })
    .mapResponse(({ response, set }) => {
      if (response === undefined) return;
      if (response instanceof Response) return response;
      return new Response(bigIntSafeJSONStringify(response), {
        status: typeof set.status === "number" ? set.status : 200,
        headers: { "content-type": "application/json" },
      });
    });
}
