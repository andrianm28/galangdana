import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [tailwindcss(), sveltekit()],
  // Only during `vitest` (mode === "test"): @testing-library/svelte's
  // render() calls Svelte's client-side mount(), but with sveltekit() in
  // the plugin list Vite/Vitest resolves Svelte's package exports using
  // server conditions by default -- verified empirically while writing
  // this plan (a real +page.svelte render() call failed with "mount(...)
  // is not available on the server" without this). Scoped to test mode
  // ONLY: applying resolve.conditions: ["browser"] globally was tried
  // and rejected -- it makes `vite build` succeed with no error, but the
  // resulting SERVER bundle silently gets Svelte's client internals
  // bundled in and crashes every real SSR request with "ReferenceError:
  // window is not defined" (confirmed by actually invoking the built
  // server's request handler, not just checking that the build exits 0).
  // The $env/dynamic/public alias is test-only for the same reason the browser
  // condition is: under vitest the SvelteKit plugin does not materialise that
  // virtual module, so importing it throws "Cannot read properties of undefined
  // (reading 'env')" at module scope -- failing the whole test FILE, not one
  // test. It surfaced when a COMPONENT first imported $lib/api-client (the
  // homepage's amiin handler); a +page.ts is imported dynamically inside tests
  // that stub fetch, but a component is imported at module scope by its render
  // test. Never applied outside test mode, where the real module must win.
  resolve:
    mode === "test"
      ? {
          conditions: ["browser"],
          alias: {
            "$env/dynamic/public": new URL(
              "./src/lib/test-stubs/env-dynamic-public.ts",
              import.meta.url,
            ).pathname,
          },
        }
      : undefined,
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./vitest-setup.ts"],
  },
}));
