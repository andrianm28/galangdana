import { cleanup } from "@testing-library/svelte";
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// @testing-library/svelte does NOT auto-cleanup between tests in the same
// file (verified empirically -- omitting this made a later test's
// getByText() match a DOM node left mounted by an earlier test, throwing
// "found multiple elements" for text that should have been unambiguous).
afterEach(() => {
  cleanup();
});
