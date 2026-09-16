/**
 * Test-only stand-in for SvelteKit's `$env/dynamic/public` virtual module.
 *
 * Aliased in by vite.config.ts when `mode === "test"` only -- see the comment
 * there. Under vitest the SvelteKit plugin does not materialise that virtual
 * module, so anything importing it (here: $lib/api-client) blows up at import
 * time with "Cannot read properties of undefined (reading 'env')", which fails
 * the whole test FILE rather than a single test.
 *
 * That only started mattering when a component -- not just a +page.ts -- began
 * importing the API client: the homepage's amiin handler. Route load files are
 * imported dynamically inside tests that stub fetch; a component is imported at
 * module scope by its render test.
 *
 * Empty on purpose. api-client falls back to http://localhost:3001 when
 * PUBLIC_API_URL is unset, and render tests never make a real request -- they
 * assert markup. A test that needs a specific base URL should stub fetch, not
 * lean on this.
 */
export const env: Record<string, string | undefined> = {};
