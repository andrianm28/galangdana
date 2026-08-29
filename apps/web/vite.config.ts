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
  resolve: mode === "test" ? { conditions: ["browser"] } : undefined,
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
}));
