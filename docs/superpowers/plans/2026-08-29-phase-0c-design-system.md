# Phase 0c: Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give GalangDana an original visual identity and a reusable Svelte component library (`packages/ui`), then prove it end-to-end by restyling the real homepage and standing up both layout shells the platform needs (mobile-first consumer, desktop-first B2B/admin).

**Architecture:** A new workspace package, `packages/ui`, holds design tokens (Tailwind v4 `@theme` CSS custom properties) and a small set of foundational Svelte 5 components, consumed directly from source (no build step) by `apps/web` — the same "raw TS/Svelte source across the workspace boundary" pattern `packages/money`/`contracts`/`db` already use. `apps/web` registers the Tailwind Vite plugin and imports `packages/ui`'s token file. Two route-group layouts (`(consumer)`, `(admin)`) wrap pages in the appropriate shell.

**Tech Stack:** Tailwind CSS v4 (`@tailwindcss/vite`), Svelte 5 (runes), Vitest + `@testing-library/svelte` + `happy-dom` for component tests (packages/ui and apps/web's new rendering tests use this stack; `bun:test` is NOT used here — it has no DOM environment or Svelte-SFC transform, and the existing `apps/web` test suite already established Vitest as this repo's Svelte-testing tool).

**Spec:** `/home/ubuntu/.claude/plans/plan-to-clone-1-1-quiet-snail.md` (Architecture section: `packages/ui: Svelte design system (consumer + B2B shells)`; Cross-cutting concerns: `id-ID formatting and a11y first-class`; Evidence base: `Layout split | Consumer apps are a mobile-width column even at 1600px; the CSR site is desktop-first B2B`)

**Brand direction (confirmed by the user, 2026-08-29):** Warm & trustworthy — soft green/teal primary with a warm accent, rounded corners, friendly sans-serif. This is original branding invented for GalangDana; nothing here is derived from Kitabisa's actual visual identity, consistent with this project's IP boundary (feature sets/IA are clonable, brand assets are not).

## Global Constraints

- **Every component's `$props()` destructuring uses `const`, EXCEPT `TextInput` (Task 2), which correctly keeps `let`.** This repo's installed Biome 1.9.4 has a genuine internal panic — `assertion failed: start.raw <= end.raw`, exit code 101, not just a lint warning — when computing the `useConst` diagnostic's range against a multi-line `let { ...destructuring }: Props = $props()` where every destructured binding is unreassigned, next to an `interface Props { ... }` block (found during Task 1, reproduced directly against this repo's actual Biome install). `const` is semantically identical everywhere this applies — Svelte 5's `$props()` return is never reassigned by any OTHER component in this plan — and fully avoids the panic. `TextInput` is the one exception: its `value` binding IS reassigned inside `handleInput` (`value = event.currentTarget.value;`), so its destructuring genuinely needs `let` — verified directly that this specific case does NOT trigger the panic (Biome's `useConst` doesn't fire when at least one destructured binding is truly reassigned), so leave `TextInput`'s `let` exactly as written; do not "fix" it to `const` or the component breaks (reassigning a `const` binding is a compile error).
- **Every task's verification step includes `bun run lint` from the repo root, not just `vitest`/`typecheck`.** Several tasks below list only `vitest run` and `typecheck` in their per-task verification step, written before the `let`/`const` panic above was found — treat `bun run lint` (clean, no errors) as an implicit requirement of every task's final verification regardless of what that task's own step text enumerates, so a Biome-breaking pattern is caught in the task that introduced it, not accumulated across several tasks until Task 7 or the final review.
- Component code blocks below show 2-space-indented `<script>` contents for readability in this document; this repo's actual Biome formatter (confirmed against the two pre-existing `.svelte` files before Task 1) formats `<script>` contents flush-left, with no extra indentation. Do not fight the formatter: implement the component, then run `bun run lint:fix` (or the workspace-appropriate lint-fix command) and accept its reformatting — verify afterward that no token values, prop names/types, or logic changed, only whitespace.
- All money/monetary display in future phases will use the `money` package's existing formatting — this phase does not touch money formatting, only visual/component primitives.
- Components are styled with Tailwind utility classes directly in the component's markup — no parallel `<style>` block CSS, no CSS-in-JS, no new styling library (`clsx`, `cva`, `tailwind-variants`, etc.). Svelte 5 already ships `clsx`-equivalent native `class` attribute handling (object/array syntax); variant-to-class-string mapping uses a plain `Record<Variant, string>` lookup object.
- Every component lives in `packages/ui/src/components/`, is re-exported from `packages/ui/src/index.ts`, and is consumed elsewhere only via `import { X } from "@galangdana/ui"` — never a deep import path.
- Every component ships with a real Vitest + `@testing-library/svelte` rendering test asserting actual DOM output (text content, attributes, class presence, event firing) — never a test that only checks the component doesn't throw.
- `packages/ui` has no build step: it is consumed directly from `.ts`/`.svelte` source by `apps/web`'s Vite/SvelteKit pipeline, the same pattern already used by `packages/money`, `packages/contracts`, and `packages/db`.
- Design tokens are the single source of truth for color/typography/radius values. A component must reference a token (`bg-primary`, `text-neutral-800`, `rounded-md`, etc.) — never a raw hex value or arbitrary Tailwind value (`bg-[#2f7a5f]`) in component markup.
- **Cross-package Tailwind content detection was verified, not assumed** (see Task 1): a plain `vite build` (no SvelteKit) does NOT auto-detect classes used only inside a sibling workspace package, but the actual stack this plan uses — `@tailwindcss/vite` running underneath `sveltekit()` — DOES, confirmed with a real two-package SvelteKit build (clean cache, three repeat runs) where a class used only in a sibling package's `.svelte` file reached the compiled CSS with zero extra configuration. `apps/web/src/app.css` still declares an explicit `@source` pointing at `packages/ui/src` anyway (harmless either way, and documents the dependency), but no task in this plan depends on it actually being load-bearing — if a future component is somehow still missing from the built CSS, that is a real bug to investigate, not "the expected/known limitation," since the limitation this bullet used to describe does not apply to this repo's actual build.
- `@testing-library/svelte` does not auto-cleanup between tests in the same file — verified empirically (see Task 1). Every package/app that renders Svelte components in tests needs a Vitest `setupFiles` entry calling `afterEach(() => cleanup())`, or the second test in a file can spuriously match DOM left over from the first.

---

## Task 1: `packages/ui` scaffold, Tailwind v4 design tokens, test infrastructure, and the first component (Button)

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/svelte.config.js`
- Create: `packages/ui/vite.config.ts`
- Create: `packages/ui/vitest-setup.ts`
- Create: `packages/ui/src/theme.css`
- Create: `packages/ui/src/index.ts`
- Create: `packages/ui/src/components/Button.svelte`
- Test: `packages/ui/src/components/Button.test.ts`
- Modify: `apps/web/package.json` (add `@galangdana/ui`, `@tailwindcss/vite`, `tailwindcss`, `@testing-library/svelte`, `@testing-library/jest-dom`, `happy-dom` deps)
- Modify: `apps/web/vite.config.ts` (register the Tailwind plugin)
- Create: `apps/web/src/app.css`
- Modify: `apps/web/src/routes/+layout.svelte` (import `app.css`)
- Modify: `/home/ubuntu/galangdana/package.json` (root `test` script must stop globbing `packages/ui` under `bun:test`; add `test:ui`)
- Modify: `/home/ubuntu/galangdana/.github/workflows/ci.yml` (add a `Unit tests (ui)` step)

**Interfaces:**
- Consumes: nothing from earlier tasks (this is Phase 0c's first task).
- Produces: `@galangdana/ui` package importable as `import { Button } from "@galangdana/ui";`. Design tokens as Tailwind utility classes: `bg-primary`, `bg-primary-dark`, `bg-primary-light`, `bg-accent`, `bg-accent-dark`, `bg-accent-light`, `text-neutral-{50,100,200,400,600,800,900}`, `bg-success`, `bg-warning`, `bg-error`, `bg-info`, `rounded-sm` (0.5rem), `rounded-md` (0.75rem), `rounded-lg` (1.25rem), `font-sans` (Plus Jakarta Sans). `Button` props: `variant: "primary" | "secondary" | "ghost" | "danger"` (default `"primary"`), `size: "sm" | "md" | "lg"` (default `"md"`), `disabled?: boolean`, `loading?: boolean`, `onclick?: () => void`, `children` snippet for label content, `type?: "button" | "submit"` (default `"button"`).

- [ ] **Step 1: Scaffold `packages/ui/package.json`**

```json
{
  "name": "@galangdana/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "svelte-check --tsconfig ./tsconfig.json"
  },
  "dependencies": {
    "svelte": "^5.2.9"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^4.0.2",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/svelte": "^5.2.7",
    "happy-dom": "^15.11.7",
    "svelte-check": "^4.1.0",
    "vite": "^5.4.11",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: `packages/ui/tsconfig.json`**

Plain library tsconfig — no `.svelte-kit/tsconfig.json` extension (that file only exists for actual SvelteKit apps; `packages/ui` is a plain Vite/Svelte library):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"]
  },
  "include": ["src/**/*.ts", "src/**/*.svelte"]
}
```

`"lib": ["ES2022", "DOM"]` is required here (unlike the backend packages) because components reference DOM types (`HTMLButtonElement`, event types) — the base config's `"lib": ["ES2022"]` alone has no DOM types and every component would fail to typecheck.

- [ ] **Step 3: `packages/ui/svelte.config.js`**

```js
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/vite-plugin-svelte').Config} */
export default {
  preprocess: vitePreprocess(),
};
```

- [ ] **Step 4: `packages/ui/vite.config.ts`**

```ts
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte()],
  resolve: { conditions: ["browser"] },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./vitest-setup.ts"],
  },
});
```

`resolve.conditions: ["browser"]` matters: without it, Vitest resolves Svelte's package exports using its default Node conditions, which point at server-side rendering internals rather than the client runtime `@testing-library/svelte` needs to actually mount and interact with components.

- [ ] **Step 5: `packages/ui/vitest-setup.ts`**

```ts
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
```

- [ ] **Step 6: Design tokens — `packages/ui/src/theme.css`**

```css
@theme {
  /* Brand: warm & trustworthy. A muted green/teal primary (giving,
     growth, calm) paired with a warm terracotta accent for calls to
     action (donate buttons, primary CTAs) that need to stand out against
     the calmer brand color. Neutral scale is warm-tinted (toward beige),
     not cold blue-gray, to stay consistent with the rest of the palette. */
  --color-primary: #2f7a5f;
  --color-primary-light: #e8f3ee;
  --color-primary-dark: #1f5a44;

  --color-accent: #d97748;
  --color-accent-light: #fbeae0;
  --color-accent-dark: #b85a30;

  --color-neutral-50: #faf9f7;
  --color-neutral-100: #f3f1ed;
  --color-neutral-200: #e5e1d8;
  --color-neutral-400: #a69c8d;
  --color-neutral-600: #6b6355;
  --color-neutral-800: #3d372c;
  --color-neutral-900: #252017;

  /* success reuses the brand primary -- giving and "this worked" share
     the same color family in a donation product. warning/error/info are
     the only colors outside the warm family, kept deliberately close to
     conventional meanings so they read correctly at a glance. */
  --color-success: #2f7a5f;
  --color-warning: #d9a441;
  --color-error: #c4463a;
  --color-info: #3e7ca6;

  --font-sans:
    "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, sans-serif;

  /* Rounded, not sharp -- the "warm & trustworthy" personality's most
     visible signal after color. sm for buttons/inputs/badges, md for
     cards, lg for larger surfaces like modals. */
  --radius-sm: 0.5rem;
  --radius-md: 0.75rem;
  --radius-lg: 1.25rem;
}
```

- [ ] **Step 7: Barrel export — `packages/ui/src/index.ts`**

```ts
export { default as Button } from "./components/Button.svelte";
```

- [ ] **Step 8: Write the failing test for Button — `packages/ui/src/components/Button.test.ts`**

```ts
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test, vi } from "vitest";
import Button from "./Button.svelte";

afterEach(() => cleanup());

describe("Button", () => {
  test("renders its label and fires onclick", async () => {
    const onclick = vi.fn();
    render(Button, { props: { onclick, children: createSnippet("Donate now") } });

    const button = screen.getByRole("button", { name: "Donate now" });
    await fireEvent.click(button);

    expect(onclick).toHaveBeenCalledTimes(1);
  });

  test("defaults to the primary variant and medium size", () => {
    render(Button, { props: { children: createSnippet("Save") } });
    const button = screen.getByRole("button");
    expect(button.className).toContain("bg-primary");
    expect(button.className).not.toContain("bg-accent");
  });

  test("applies variant classes", () => {
    render(Button, { props: { variant: "danger", children: createSnippet("Delete") } });
    const button = screen.getByRole("button");
    expect(button.className).toContain("bg-error");
  });

  test("disabled buttons cannot be clicked and carry the disabled attribute", async () => {
    const onclick = vi.fn();
    render(Button, { props: { disabled: true, onclick, children: createSnippet("Wait") } });
    const button = screen.getByRole("button") as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    await fireEvent.click(button);
    expect(onclick).not.toHaveBeenCalled();
  });

  test("loading buttons show a spinner, are disabled, and keep the label for screen readers", () => {
    render(Button, { props: { loading: true, children: createSnippet("Submitting") } });
    const button = screen.getByRole("button") as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(button.querySelector('[data-testid="button-spinner"]')).not.toBeNull();
    expect(button.textContent).toContain("Submitting");
  });

  test("defaults to type=button so it never accidentally submits a form", () => {
    render(Button, { props: { children: createSnippet("Click") } });
    const button = screen.getByRole("button") as HTMLButtonElement;
    expect(button.type).toBe("button");
  });
});

// @testing-library/svelte's render() takes real Snippet values for a
// component's children prop, not plain strings -- this constructs one the
// same way Svelte's own compiler output does, so tests don't need a
// wrapper .svelte fixture file just to pass text content through.
function createSnippet(text: string) {
  return ((anchor: Node) => {
    const textNode = document.createTextNode(text);
    anchor.parentNode?.insertBefore(textNode, anchor);
  }) as unknown as import("svelte").Snippet;
}
```

- [ ] **Step 9: Run the test to verify it fails**

Run: `cd packages/ui && bun x vitest run src/components/Button.test.ts`
Expected: FAIL — `Button.svelte` does not exist yet (`Failed to resolve import "./Button.svelte"`).

- [ ] **Step 10: Implement `packages/ui/src/components/Button.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";

  type Variant = "primary" | "secondary" | "ghost" | "danger";
  type Size = "sm" | "md" | "lg";

  interface Props {
    variant?: Variant;
    size?: Size;
    disabled?: boolean;
    loading?: boolean;
    type?: "button" | "submit";
    onclick?: () => void;
    children: Snippet;
  }

  const {
    variant = "primary",
    size = "md",
    disabled = false,
    loading = false,
    type = "button",
    onclick,
    children,
  }: Props = $props();

  const variantClasses: Record<Variant, string> = {
    primary: "bg-primary text-white hover:bg-primary-dark",
    secondary: "bg-primary-light text-primary-dark hover:bg-primary/20",
    ghost: "bg-transparent text-neutral-800 hover:bg-neutral-100",
    danger: "bg-error text-white hover:bg-error/90",
  };

  const sizeClasses: Record<Size, string> = {
    sm: "px-3 py-1.5 text-sm gap-1.5",
    md: "px-4 py-2 text-base gap-2",
    lg: "px-6 py-3 text-lg gap-2.5",
  };

  const isDisabled = $derived(disabled || loading);

  function handleClick() {
    if (isDisabled) return;
    onclick?.();
  }
</script>

<button
  {type}
  disabled={isDisabled}
  onclick={handleClick}
  class="inline-flex items-center justify-center font-sans font-semibold rounded-sm
    transition-colors disabled:opacity-50 disabled:cursor-not-allowed
    {variantClasses[variant]} {sizeClasses[size]}"
>
  {#if loading}
    <span
      data-testid="button-spinner"
      class="size-4 rounded-full border-2 border-current border-t-transparent animate-spin"
    ></span>
  {/if}
  {@render children()}
</button>
```

- [ ] **Step 11: Run the test to verify it passes**

Run: `cd packages/ui && bun x vitest run src/components/Button.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 12: Wire `apps/web` to consume `packages/ui` and Tailwind**

Add to `apps/web/package.json` `dependencies`:

```json
"@galangdana/ui": "workspace:*",
```

Add to `apps/web/package.json` `devDependencies` (alongside the existing ones):

```json
"@tailwindcss/vite": "^4.3.3",
"tailwindcss": "^4.3.3",
"@testing-library/svelte": "^5.2.7",
"@testing-library/jest-dom": "^6.6.3",
"happy-dom": "^15.11.7",
```

Run `bun install` from the repo root after editing both `package.json` files, so the workspace link and new deps resolve.

- [ ] **Step 13: Register the Tailwind Vite plugin, and scope a browser-conditions override to test mode only — modify `apps/web/vite.config.ts`**

```ts
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
```

`tailwindcss()` is listed before `sveltekit()`, matching Tailwind's own documented convention — verified against this repo's actual Vite 5.4.21 + `@sveltejs/kit@2.70.3` + `@tailwindcss/vite@4.3.3` that BOTH plugin orders produce an identical, correctly populated CSS bundle, so this is a style convention to follow, not a functional requirement to defend. The `resolve` line, in contrast, IS load-bearing and version/config-sensitive — do not simplify it to an unconditional `resolve: { conditions: ["browser"] }` no matter how harmless that looks; it was verified to silently break production SSR.

- [ ] **Step 14: Create `apps/web/src/app.css`**

```css
@import "tailwindcss";
@import "@galangdana/ui/src/theme.css";

/* Not strictly required: verified empirically that @tailwindcss/vite
   running under sveltekit() already auto-detects classes used inside
   packages/ui with zero extra config (a plain, non-SvelteKit `vite
   build` does NOT do this, which is what an earlier, stack-mismatched
   spike for this plan got wrong -- corrected before this task was
   dispatched). Kept anyway as explicit, self-documenting evidence that
   apps/web's styling depends on packages/ui's source tree. */
@source "../../../packages/ui/src";

body {
  @apply bg-neutral-50 text-neutral-900 font-sans;
}
```

- [ ] **Step 15: Load the Plus Jakarta Sans font and import `app.css` — modify `apps/web/src/routes/+layout.svelte`**

```svelte
<script lang="ts">
  import "../app.css";

  const { children } = $props();
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800&display=swap"
    rel="stylesheet"
  />
</svelte:head>

{@render children()}
```

Loaded from Google Fonts' CDN rather than self-hosted for this phase — simpler to verify and iterate on; self-hosting the variable font file is a cheap follow-up once the design is stable, tracked as a deferred item rather than blocking this task.

- [ ] **Step 16: Verify the token pipeline builds real CSS end to end**

Run: `cd apps/web && bun x vite build`
Expected: build succeeds; inspect `apps/web/build/client/_app/immutable/assets/*.css` (or wherever the emitted CSS lands — check the actual `build/` output path printed by the build) and confirm it contains `.bg-primary{background-color:var(--color-primary)}` (or equivalent, possibly minified) and `--color-primary:#2f7a5f` in a `:root`/`@theme`-derived custom-property block. If either is missing, something in Steps 12-15 is wrong (bad dependency install, plugin not registered, `app.css` not imported) — do not proceed until this is confirmed, since every later component task depends on it.

- [ ] **Step 17: Scope the root `test` script away from `packages/ui`, add `test:ui` — modify `/home/ubuntu/galangdana/package.json`**

`bun:test` has no Svelte-SFC transform and no DOM environment; running it against `packages/ui` would fail to even parse a `.svelte` file. The existing `"test": "bun test packages apps/api"` script passes a bare `packages` directory, which would now incorrectly sweep up `packages/ui`. Enumerate the `bun:test`-compatible packages explicitly instead of globbing the whole `packages/` directory:

```json
"test": "bun test packages/money packages/contracts packages/db apps/api",
"test:ui": "bun run --cwd packages/ui test",
```

(Leave `"test:web": "bun run --cwd apps/web test"` as-is.)

- [ ] **Step 18: Add a CI step for `packages/ui` — modify `/home/ubuntu/galangdana/.github/workflows/ci.yml`**

Insert a new step immediately after the existing `Unit tests (web)` step:

```yaml
      - name: Unit tests (ui)
        run: bun run test:ui
```

- [ ] **Step 19: Run the full local verification**

Run: `bun install && bun run lint && bun run typecheck && bun run test && bun run test:ui && bun run test:web`
Expected: all clean/passing. `bun run test` must NOT attempt to load any `.svelte` file (confirms Step 17's scoping fix worked); `bun run test:ui` must show 6 passing Button tests.

- [ ] **Step 20: Commit**

```bash
git add packages/ui apps/web/package.json apps/web/vite.config.ts apps/web/src/app.css apps/web/src/routes/+layout.svelte package.json .github/workflows/ci.yml bun.lock
git commit -m "feat(ui): scaffold design system package, Tailwind v4 tokens, Button component"
```

---

## Task 2: Form primitives — TextInput, Label, FormField

**Files:**
- Create: `packages/ui/src/components/Label.svelte`
- Create: `packages/ui/src/components/TextInput.svelte`
- Create: `packages/ui/src/components/FormField.svelte`
- Test: `packages/ui/src/components/Label.test.ts`
- Test: `packages/ui/src/components/TextInput.test.ts`
- Test: `packages/ui/src/components/FormField.test.ts`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: nothing new from Task 1 beyond the established token classes and test setup.
- Produces: `Label` (`for: string`, `children: Snippet`), `TextInput` (`id: string`, `type?: "text" | "email" | "tel" | "password"` default `"text"`, `value: string` bindable, `placeholder?: string`, `disabled?: boolean`, `invalid?: boolean`, `oninput?: (value: string) => void`), `FormField` (`label: string`, `id: string`, `error?: string`, `hint?: string`, `children: Snippet` — the input itself is passed as `children`, `FormField` only wraps label/error/hint layout around it).

- [ ] **Step 1: Write the failing test for Label — `packages/ui/src/components/Label.test.ts`**

```ts
import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import Label from "./Label.svelte";

afterEach(() => cleanup());

describe("Label", () => {
  test("associates with its input via the for/id relationship", () => {
    render(Label, { props: { for: "donor-name", children: textSnippet("Full name") } });
    const label = screen.getByText("Full name");
    expect(label.getAttribute("for")).toBe("donor-name");
  });
});

function textSnippet(text: string) {
  return ((anchor: Node) => {
    anchor.parentNode?.insertBefore(document.createTextNode(text), anchor);
  }) as unknown as import("svelte").Snippet;
}
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd packages/ui && bun x vitest run src/components/Label.test.ts`
Expected: FAIL — `Label.svelte` doesn't exist.

- [ ] **Step 3: Implement `packages/ui/src/components/Label.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    for: string;
    children: Snippet;
  }

  const { for: htmlFor, children }: Props = $props();
</script>

<label for={htmlFor} class="block text-sm font-medium text-neutral-800 mb-1 font-sans">
  {@render children()}
</label>
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd packages/ui && bun x vitest run src/components/Label.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for TextInput — `packages/ui/src/components/TextInput.test.ts`**

```ts
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test, vi } from "vitest";
import TextInput from "./TextInput.svelte";

afterEach(() => cleanup());

describe("TextInput", () => {
  test("renders with the given id, type, and placeholder", () => {
    render(TextInput, {
      props: { id: "email", type: "email", value: "", placeholder: "you@example.com" },
    });
    const input = screen.getByPlaceholderText("you@example.com") as HTMLInputElement;
    expect(input.id).toBe("email");
    expect(input.type).toBe("email");
  });

  test("defaults to type=text", () => {
    render(TextInput, { props: { id: "name", value: "" } });
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.type).toBe("text");
  });

  test("calls oninput with the new value on every keystroke", async () => {
    const oninput = vi.fn();
    render(TextInput, { props: { id: "name", value: "", oninput } });
    const input = screen.getByRole("textbox");

    await fireEvent.input(input, { target: { value: "Budi" } });

    expect(oninput).toHaveBeenCalledWith("Budi");
  });

  test("applies invalid styling and aria-invalid when invalid is true", () => {
    render(TextInput, { props: { id: "email", value: "not-an-email", invalid: true } });
    const input = screen.getByRole("textbox");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.className).toContain("border-error");
  });

  test("disabled inputs cannot be edited", () => {
    render(TextInput, { props: { id: "name", value: "locked", disabled: true } });
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });
});
```

- [ ] **Step 6: Run it, verify it fails**

Run: `cd packages/ui && bun x vitest run src/components/TextInput.test.ts`
Expected: FAIL.

- [ ] **Step 7: Implement `packages/ui/src/components/TextInput.svelte`**

```svelte
<script lang="ts">
  interface Props {
    id: string;
    type?: "text" | "email" | "tel" | "password";
    value: string;
    placeholder?: string;
    disabled?: boolean;
    invalid?: boolean;
    oninput?: (value: string) => void;
  }

  let {
    id,
    type = "text",
    value = $bindable(),
    placeholder,
    disabled = false,
    invalid = false,
    oninput,
  }: Props = $props();

  function handleInput(event: Event & { currentTarget: HTMLInputElement }) {
    value = event.currentTarget.value;
    oninput?.(value);
  }
</script>

<input
  {id}
  {type}
  {value}
  {placeholder}
  {disabled}
  aria-invalid={invalid}
  oninput={handleInput}
  class="w-full rounded-sm border px-3 py-2 font-sans text-base text-neutral-900
    placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary/40
    disabled:bg-neutral-100 disabled:text-neutral-400 disabled:cursor-not-allowed
    {invalid ? 'border-error' : 'border-neutral-200'}"
/>
```

- [ ] **Step 8: Run it, verify it passes**

Run: `cd packages/ui && bun x vitest run src/components/TextInput.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing test for FormField — `packages/ui/src/components/FormField.test.ts`**

FormField's contract is "wraps arbitrary children with label/error/hint layout" — it does not care what the child control is, so its own test proves that contract with a plain `<input>` element rather than a real `TextInput` component. This keeps FormField's test independent of `TextInput`'s implementation (verified empirically while writing this plan: `TextInput` itself is exercised separately in its own test above).

```ts
import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import FormField from "./FormField.svelte";

afterEach(() => cleanup());

function inputSnippet(id: string) {
  return ((anchor: Node) => {
    const input = document.createElement("input");
    input.id = id;
    input.type = "text";
    anchor.parentNode?.insertBefore(input, anchor);
  }) as unknown as import("svelte").Snippet;
}

describe("FormField", () => {
  test("renders the label, the wrapped input, and no error/hint when neither is given", () => {
    render(FormField, {
      props: { label: "Email", id: "email", children: inputSnippet("email") },
    });
    expect(screen.getByText("Email")).not.toBeNull();
    expect(screen.getByRole("textbox")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("the label's for attribute matches the input's id", () => {
    render(FormField, {
      props: { label: "Email", id: "email-field", children: inputSnippet("email-field") },
    });
    const label = screen.getByText("Email");
    expect(label.getAttribute("for")).toBe("email-field");
  });

  test("shows an error message with role=alert when error is set", () => {
    render(FormField, {
      props: {
        label: "Email",
        id: "email",
        error: "Enter a valid email address",
        children: inputSnippet("email"),
      },
    });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Enter a valid email address");
  });

  test("shows a hint when hint is set and there is no error", () => {
    render(FormField, {
      props: {
        label: "Phone",
        id: "phone",
        hint: "We'll text you a code",
        children: inputSnippet("phone"),
      },
    });
    expect(screen.getByText("We'll text you a code")).not.toBeNull();
  });
});
```

- [ ] **Step 10: Run it, verify it fails**

Run: `cd packages/ui && bun x vitest run src/components/FormField.test.ts`
Expected: FAIL — `FormField.svelte` doesn't exist.

- [ ] **Step 11: Implement `packages/ui/src/components/FormField.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";
  import Label from "./Label.svelte";

  interface Props {
    label: string;
    id: string;
    error?: string;
    hint?: string;
    children: Snippet;
  }

  const { label, id, error, hint, children }: Props = $props();
</script>

<div class="mb-4">
  <Label for={id}>{label}</Label>
  {@render children()}
  {#if error}
    <p role="alert" class="mt-1 text-sm text-error font-sans">{error}</p>
  {:else if hint}
    <p class="mt-1 text-sm text-neutral-600 font-sans">{hint}</p>
  {/if}
</div>
```

- [ ] **Step 12: Run it, verify it passes**

Run: `cd packages/ui && bun x vitest run src/components/FormField.test.ts`
Expected: PASS.

- [ ] **Step 13: Update the barrel — `packages/ui/src/index.ts`**

```ts
export { default as Button } from "./components/Button.svelte";
export { default as FormField } from "./components/FormField.svelte";
export { default as Label } from "./components/Label.svelte";
export { default as TextInput } from "./components/TextInput.svelte";
```

- [ ] **Step 14: Run the full `packages/ui` suite and typecheck**

Run: `cd packages/ui && bun x vitest run && bun run typecheck`
Expected: all tests pass, `svelte-check` reports 0 errors.

- [ ] **Step 15: Commit**

```bash
git add packages/ui/src
git commit -m "feat(ui): add TextInput, Label, and FormField form primitives"
```

---

## Task 3: Presentational primitives — Card, Badge, Avatar, Spinner

**Files:**
- Create: `packages/ui/src/components/Card.svelte`
- Create: `packages/ui/src/components/Badge.svelte`
- Create: `packages/ui/src/components/Avatar.svelte`
- Create: `packages/ui/src/components/Spinner.svelte`
- Test: `packages/ui/src/components/Card.test.ts`
- Test: `packages/ui/src/components/Badge.test.ts`
- Test: `packages/ui/src/components/Avatar.test.ts`
- Test: `packages/ui/src/components/Spinner.test.ts`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: none new.
- Produces: `Card` (`children: Snippet`, `padded?: boolean` default `true`), `Badge` (`variant: "neutral" | "success" | "warning" | "error" | "info"` default `"neutral"`, `children: Snippet`), `Avatar` (`name: string` — used for initials fallback, `src?: string`, `size?: "sm" | "md" | "lg"` default `"md"`), `Spinner` (`size?: "sm" | "md" | "lg"` default `"md"`, standalone version of the inline spinner `Button` already renders internally — `Button`'s loading state is intentionally NOT refactored to import this component, since `Button`'s spinner has no independent size prop and refactoring a working, already-tested component purely for internal DRY-ness is out of scope here).

- [ ] **Step 1: Write the failing test for Card — `packages/ui/src/components/Card.test.ts`**

```ts
import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import Card from "./Card.svelte";

afterEach(() => cleanup());

describe("Card", () => {
  test("renders its children inside a rounded, bordered container", () => {
    const { container } = render(Card, { props: { children: textSnippet("Campaign summary") } });
    expect(screen.getByText("Campaign summary")).not.toBeNull();
    const card = container.querySelector("[data-testid='card']");
    expect(card?.className).toContain("rounded-md");
  });

  test("padded defaults to true, adding padding classes", () => {
    const { container } = render(Card, { props: { children: textSnippet("x") } });
    const card = container.querySelector("[data-testid='card']");
    expect(card?.className).toContain("p-4");
  });

  test("padded=false removes the padding classes", () => {
    const { container } = render(Card, { props: { padded: false, children: textSnippet("x") } });
    const card = container.querySelector("[data-testid='card']");
    expect(card?.className).not.toContain("p-4");
  });
});

function textSnippet(text: string) {
  return ((anchor: Node) => {
    anchor.parentNode?.insertBefore(document.createTextNode(text), anchor);
  }) as unknown as import("svelte").Snippet;
}
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd packages/ui && bun x vitest run src/components/Card.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/ui/src/components/Card.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    padded?: boolean;
    children: Snippet;
  }

  const { padded = true, children }: Props = $props();
</script>

<div
  data-testid="card"
  class="rounded-md border border-neutral-200 bg-white {padded ? 'p-4' : ''}"
>
  {@render children()}
</div>
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd packages/ui && bun x vitest run src/components/Card.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for Badge — `packages/ui/src/components/Badge.test.ts`**

```ts
import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import Badge from "./Badge.svelte";

afterEach(() => cleanup());

describe("Badge", () => {
  test("defaults to the neutral variant", () => {
    render(Badge, { props: { children: textSnippet("Draft") } });
    const badge = screen.getByText("Draft");
    expect(badge.className).toContain("bg-neutral-100");
  });

  test("applies the success variant's classes", () => {
    render(Badge, { props: { variant: "success", children: textSnippet("Verified") } });
    const badge = screen.getByText("Verified");
    expect(badge.className).toContain("bg-primary-light");
  });
});

function textSnippet(text: string) {
  return ((anchor: Node) => {
    anchor.parentNode?.insertBefore(document.createTextNode(text), anchor);
  }) as unknown as import("svelte").Snippet;
}
```

- [ ] **Step 6: Run it, verify it fails**

Run: `cd packages/ui && bun x vitest run src/components/Badge.test.ts`
Expected: FAIL.

- [ ] **Step 7: Implement `packages/ui/src/components/Badge.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";

  type Variant = "neutral" | "success" | "warning" | "error" | "info";

  interface Props {
    variant?: Variant;
    children: Snippet;
  }

  const { variant = "neutral", children }: Props = $props();

  const variantClasses: Record<Variant, string> = {
    neutral: "bg-neutral-100 text-neutral-800",
    success: "bg-primary-light text-primary-dark",
    warning: "bg-warning/15 text-warning",
    error: "bg-error/15 text-error",
    info: "bg-info/15 text-info",
  };
</script>

<span
  class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium font-sans {variantClasses[
    variant
  ]}"
>
  {@render children()}
</span>
```

- [ ] **Step 8: Run it, verify it passes**

Run: `cd packages/ui && bun x vitest run src/components/Badge.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing test for Avatar — `packages/ui/src/components/Avatar.test.ts`**

```ts
import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import Avatar from "./Avatar.svelte";

afterEach(() => cleanup());

describe("Avatar", () => {
  test("renders an img with the given src and alt text when src is provided", () => {
    render(Avatar, { props: { name: "Budi Santoso", src: "https://example.test/budi.jpg" } });
    const img = screen.getByRole("img", { name: "Budi Santoso" }) as HTMLImageElement;
    expect(img.src).toBe("https://example.test/budi.jpg");
  });

  test("falls back to initials when no src is given", () => {
    render(Avatar, { props: { name: "Budi Santoso" } });
    expect(screen.getByText("BS")).not.toBeNull();
  });

  test("derives initials from a single-word name using its first two letters", () => {
    render(Avatar, { props: { name: "Madonna" } });
    expect(screen.getByText("MA")).not.toBeNull();
  });
});
```

- [ ] **Step 10: Run it, verify it fails**

Run: `cd packages/ui && bun x vitest run src/components/Avatar.test.ts`
Expected: FAIL.

- [ ] **Step 11: Implement `packages/ui/src/components/Avatar.svelte`**

```svelte
<script lang="ts">
  type Size = "sm" | "md" | "lg";

  interface Props {
    name: string;
    src?: string;
    size?: Size;
  }

  const { name, src, size = "md" }: Props = $props();

  const sizeClasses: Record<Size, string> = {
    sm: "size-8 text-xs",
    md: "size-10 text-sm",
    lg: "size-14 text-lg",
  };

  const initials = $derived.by(() => {
    const words = name.trim().split(/\s+/);
    if (words.length >= 2) {
      return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
    }
    return (words[0] ?? "").slice(0, 2).toUpperCase();
  });
</script>

{#if src}
  <img
    {src}
    alt={name}
    class="rounded-full object-cover {sizeClasses[size]}"
  />
{:else}
  <span
    role="img"
    aria-label={name}
    class="inline-flex items-center justify-center rounded-full bg-primary-light
      text-primary-dark font-sans font-semibold {sizeClasses[size]}"
  >
    {initials}
  </span>
{/if}
```

- [ ] **Step 12: Run it, verify it passes**

Run: `cd packages/ui && bun x vitest run src/components/Avatar.test.ts`
Expected: PASS.

- [ ] **Step 13: Write the failing test for Spinner — `packages/ui/src/components/Spinner.test.ts`**

```ts
import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import Spinner from "./Spinner.svelte";

afterEach(() => cleanup());

describe("Spinner", () => {
  test("renders with an accessible label and defaults to medium size", () => {
    const { getByRole } = render(Spinner, { props: {} });
    const spinner = getByRole("status");
    expect(spinner.className).toContain("size-6");
  });

  test("applies the small size class", () => {
    const { getByRole } = render(Spinner, { props: { size: "sm" } });
    const spinner = getByRole("status");
    expect(spinner.className).toContain("size-4");
  });
});
```

- [ ] **Step 14: Run it, verify it fails**

Run: `cd packages/ui && bun x vitest run src/components/Spinner.test.ts`
Expected: FAIL.

- [ ] **Step 15: Implement `packages/ui/src/components/Spinner.svelte`**

```svelte
<script lang="ts">
  type Size = "sm" | "md" | "lg";

  interface Props {
    size?: Size;
  }

  const { size = "md" }: Props = $props();

  const sizeClasses: Record<Size, string> = {
    sm: "size-4",
    md: "size-6",
    lg: "size-10",
  };
</script>

<span
  role="status"
  aria-label="Loading"
  class="inline-block rounded-full border-2 border-primary-light border-t-primary
    animate-spin {sizeClasses[size]}"
></span>
```

- [ ] **Step 16: Run it, verify it passes**

Run: `cd packages/ui && bun x vitest run src/components/Spinner.test.ts`
Expected: PASS.

- [ ] **Step 17: Update the barrel — `packages/ui/src/index.ts`**

```ts
export { default as Avatar } from "./components/Avatar.svelte";
export { default as Badge } from "./components/Badge.svelte";
export { default as Button } from "./components/Button.svelte";
export { default as Card } from "./components/Card.svelte";
export { default as FormField } from "./components/FormField.svelte";
export { default as Label } from "./components/Label.svelte";
export { default as Spinner } from "./components/Spinner.svelte";
export { default as TextInput } from "./components/TextInput.svelte";
```

- [ ] **Step 18: Run the full suite and typecheck**

Run: `cd packages/ui && bun x vitest run && bun run typecheck`
Expected: all pass, 0 typecheck errors.

- [ ] **Step 19: Commit**

```bash
git add packages/ui/src
git commit -m "feat(ui): add Card, Badge, Avatar, and Spinner presentational primitives"
```

---

## Task 4: Alert component

**Files:**
- Create: `packages/ui/src/components/Alert.svelte`
- Test: `packages/ui/src/components/Alert.test.ts`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: none new.
- Produces: `Alert` (`variant: "success" | "warning" | "error" | "info"` default `"info"`, `dismissible?: boolean` default `false`, `onDismiss?: () => void`, `children: Snippet`). Rendered with `role="alert"` (matching `FormField`'s error text convention from Task 2, so both surface consistently to assistive tech).

- [ ] **Step 1: Write the failing test — `packages/ui/src/components/Alert.test.ts`**

```ts
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test, vi } from "vitest";
import Alert from "./Alert.svelte";

afterEach(() => cleanup());

describe("Alert", () => {
  test("renders its message with role=alert and defaults to the info variant", () => {
    render(Alert, { props: { children: textSnippet("Your donation was received") } });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Your donation was received");
    expect(alert.className).toContain("bg-info/10");
  });

  test("applies the error variant's classes", () => {
    render(Alert, { props: { variant: "error", children: textSnippet("Payment failed") } });
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("bg-error/10");
  });

  test("has no dismiss button when dismissible is false (the default)", () => {
    render(Alert, { props: { children: textSnippet("Info") } });
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("shows a dismiss button when dismissible is true, and calls onDismiss when clicked", async () => {
    const onDismiss = vi.fn();
    render(Alert, { props: { dismissible: true, onDismiss, children: textSnippet("Info") } });

    const dismissButton = screen.getByRole("button", { name: "Dismiss" });
    await fireEvent.click(dismissButton);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

function textSnippet(text: string) {
  return ((anchor: Node) => {
    anchor.parentNode?.insertBefore(document.createTextNode(text), anchor);
  }) as unknown as import("svelte").Snippet;
}
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd packages/ui && bun x vitest run src/components/Alert.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/ui/src/components/Alert.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";

  type Variant = "success" | "warning" | "error" | "info";

  interface Props {
    variant?: Variant;
    dismissible?: boolean;
    onDismiss?: () => void;
    children: Snippet;
  }

  const { variant = "info", dismissible = false, onDismiss, children }: Props = $props();

  const variantClasses: Record<Variant, string> = {
    success: "bg-primary-light/60 text-primary-dark border-primary/30",
    warning: "bg-warning/10 text-warning border-warning/30",
    error: "bg-error/10 text-error border-error/30",
    info: "bg-info/10 text-info border-info/30",
  };
</script>

<div
  role="alert"
  class="flex items-start justify-between gap-3 rounded-sm border px-4 py-3 font-sans text-sm {variantClasses[
    variant
  ]}"
>
  <div>{@render children()}</div>
  {#if dismissible}
    <button
      type="button"
      aria-label="Dismiss"
      onclick={() => onDismiss?.()}
      class="shrink-0 rounded-sm px-1 text-current opacity-60 hover:opacity-100"
    >
      &times;
    </button>
  {/if}
</div>
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd packages/ui && bun x vitest run src/components/Alert.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the barrel — `packages/ui/src/index.ts`**

```ts
export { default as Alert } from "./components/Alert.svelte";
export { default as Avatar } from "./components/Avatar.svelte";
export { default as Badge } from "./components/Badge.svelte";
export { default as Button } from "./components/Button.svelte";
export { default as Card } from "./components/Card.svelte";
export { default as FormField } from "./components/FormField.svelte";
export { default as Label } from "./components/Label.svelte";
export { default as Spinner } from "./components/Spinner.svelte";
export { default as TextInput } from "./components/TextInput.svelte";
```

- [ ] **Step 6: Run the full suite and typecheck**

Run: `cd packages/ui && bun x vitest run && bun run typecheck`
Expected: all pass, 0 errors.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src
git commit -m "feat(ui): add Alert component"
```

---

## Task 5: Consumer layout shell (mobile-first) and homepage restyle

**Files:**
- Create: `packages/ui/src/layouts/ConsumerShell.svelte`
- Test: `packages/ui/src/layouts/ConsumerShell.test.ts`
- Modify: `packages/ui/src/index.ts`
- Create: `apps/web/src/routes/(consumer)/+layout.svelte`
- Move: `apps/web/src/routes/+page.svelte` → `apps/web/src/routes/(consumer)/+page.svelte`
- Move: `apps/web/src/routes/+page.ts` → `apps/web/src/routes/(consumer)/+page.ts`
- Move: `apps/web/src/routes/page.test.ts` → `apps/web/src/routes/(consumer)/page.test.ts`
- Create: `apps/web/src/routes/(consumer)/page.render.test.ts`

**Interfaces:**
- Consumes: `Badge`, `Card` from Task 3.
- Produces: `ConsumerShell` (`children: Snippet`) — a mobile-width column shell (per the spec's evidence: "Consumer apps are a mobile-width column even at 1600px") with a simple top bar carrying the GalangDana wordmark. This is later reused by `(donor)`/`(campaigner)` route groups once those exist — Phase 0c only wires it into the one route group that has real pages today.

- [ ] **Step 1: Write the failing test — `packages/ui/src/layouts/ConsumerShell.test.ts`**

```ts
import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import ConsumerShell from "./ConsumerShell.svelte";

afterEach(() => cleanup());

describe("ConsumerShell", () => {
  test("renders the GalangDana wordmark and the page content", () => {
    const { container } = render(ConsumerShell, { props: { children: textSnippet("Homepage content") } });
    expect(screen.getByText("GalangDana")).not.toBeNull();
    expect(screen.getByText("Homepage content")).not.toBeNull();
  });

  test("constrains content to a mobile-width column even on a wide viewport", () => {
    const { container } = render(ConsumerShell, { props: { children: textSnippet("x") } });
    const main = container.querySelector("main");
    expect(main?.className).toContain("max-w-md");
  });
});

function textSnippet(text: string) {
  return ((anchor: Node) => {
    anchor.parentNode?.insertBefore(document.createTextNode(text), anchor);
  }) as unknown as import("svelte").Snippet;
}
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd packages/ui && bun x vitest run src/layouts/ConsumerShell.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/ui/src/layouts/ConsumerShell.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    children: Snippet;
  }

  const { children }: Props = $props();
</script>

<div class="min-h-screen bg-neutral-50">
  <header class="border-b border-neutral-200 bg-white">
    <div class="mx-auto max-w-md px-4 py-3">
      <span class="font-sans text-lg font-bold text-primary-dark">GalangDana</span>
    </div>
  </header>
  <main class="mx-auto max-w-md px-4 py-6">
    {@render children()}
  </main>
</div>
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd packages/ui && bun x vitest run src/layouts/ConsumerShell.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the barrel — `packages/ui/src/index.ts`**

Add, alongside the existing exports:

```ts
export { default as ConsumerShell } from "./layouts/ConsumerShell.svelte";
```

- [ ] **Step 6: Create the `(consumer)` route group and move the existing homepage files into it**

```bash
mkdir -p apps/web/src/routes/\(consumer\)
git mv apps/web/src/routes/+page.svelte apps/web/src/routes/\(consumer\)/+page.svelte
git mv apps/web/src/routes/+page.ts apps/web/src/routes/\(consumer\)/+page.ts
git mv apps/web/src/routes/page.test.ts apps/web/src/routes/\(consumer\)/page.test.ts
```

A SvelteKit route group (`(consumer)`) is invisible in the URL — `/` still resolves to this file after the move. `+page.ts`'s `load` function and its existing test are untouched by the move (same file content, new path); do not edit their contents in this step.

- [ ] **Step 7: Wire `ConsumerShell` into the route group — `apps/web/src/routes/(consumer)/+layout.svelte`**

```svelte
<script lang="ts">
  import { ConsumerShell } from "@galangdana/ui";

  const { children } = $props();
</script>

<ConsumerShell>
  {@render children()}
</ConsumerShell>
```

- [ ] **Step 8: Restyle the homepage using real design-system components — `apps/web/src/routes/(consumer)/+page.svelte`**

```svelte
<script lang="ts">
  import { Badge, Card } from "@galangdana/ui";
  import type { PageProps } from "./$types";

  const { data }: PageProps = $props();

  const isHealthy = $derived(data.apiStatus === "ok");
</script>

<div class="flex flex-col gap-4">
  <h1 class="font-sans text-2xl font-bold text-neutral-900">Welcome to GalangDana</h1>
  <p class="font-sans text-neutral-600">
    A platform for giving that puts trust and transparency first.
  </p>
  <Card>
    <div class="flex items-center justify-between">
      <span class="font-sans text-sm text-neutral-600">API status</span>
      <Badge variant={isHealthy ? "success" : "error"}>{data.apiStatus}</Badge>
    </div>
  </Card>
</div>
```

- [ ] **Step 9: Write a rendering test proving the restyled homepage actually mounts — `apps/web/src/routes/(consumer)/page.render.test.ts`**

```ts
// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import Page from "./+page.svelte";

afterEach(() => cleanup());

describe("(consumer) homepage rendering", () => {
  test("shows a success badge when the API is healthy", () => {
    render(Page, { props: { data: { apiStatus: "ok", apiService: "api" } } });
    expect(screen.getByText("ok")).not.toBeNull();
    expect(screen.getByText("Welcome to GalangDana")).not.toBeNull();
  });

  test("shows an error-variant badge when the API status is unknown", () => {
    render(Page, { props: { data: { apiStatus: "unknown", apiService: "unknown" } } });
    const badge = screen.getByText("unknown");
    expect(badge.className).toContain("bg-error");
  });
});
```

This test needs `@testing-library/svelte` + `happy-dom`, which `apps/web`'s `package.json` already gained in Task 1 Step 12 — but `apps/web`'s Vitest config (`apps/web/vite.config.ts`) still defaults to `environment: "node"` globally (correct for the existing `page.test.ts`, which only tests the plain `load` function). The `// @vitest-environment happy-dom` docblock at the top of this file overrides the environment for this one file only, via Vitest's per-file environment mechanism — verified as the right mechanism rather than switching the whole `apps/web` suite to `happy-dom` and risking an unrelated regression in the existing node-environment test. The OTHER piece this test needs — `resolve: { conditions: ["browser"] }`, scoped to `mode === "test"` — was already added to `apps/web/vite.config.ts` in Task 1 Step 13; without it, mounting a real `+page.svelte` fails with "mount(...) is not available on the server" regardless of the environment setting, since that error comes from Svelte package resolution, not the DOM environment.

- [ ] **Step 10: Run it, verify it fails**

Run: `cd apps/web && bun x vitest run src/routes/\(consumer\)/page.render.test.ts`
Expected: FAIL until Step 8's `+page.svelte` change lands — run this after Step 8, not before, since Step 8 is what makes the test meaningful (the file already existed with a bare `<h1>` before this task).

- [ ] **Step 11: Run the full `apps/web` suite**

Run: `cd apps/web && bun x vitest run`
Expected: PASS — both the pre-existing `(consumer)/page.test.ts` (unmodified logic, new path) and the new `page.render.test.ts`.

- [ ] **Step 12: Verify the moved files didn't break the production build**

Run: `cd apps/web && bun x vite build`
Expected: succeeds; the emitted CSS bundle still contains `.bg-primary`/`.bg-error` etc. (same check as Task 1 Step 16, now exercised through real page markup instead of just the Button component).

- [ ] **Step 13: Run root-level lint/typecheck to catch anything the moves missed**

Run: `cd /home/ubuntu/galangdana && bun run lint && bun run typecheck`
Expected: clean.

- [ ] **Step 14: Commit**

```bash
git add packages/ui/src apps/web/src
git commit -m "feat(web): add consumer layout shell and restyle the homepage with the design system"
```

---

## Task 6: Admin/B2B layout shell (desktop-first)

**Files:**
- Create: `packages/ui/src/layouts/AdminShell.svelte`
- Test: `packages/ui/src/layouts/AdminShell.test.ts`
- Modify: `packages/ui/src/index.ts`
- Create: `apps/web/src/routes/(admin)/+layout.svelte`
- Create: `apps/web/src/routes/(admin)/dashboard/+page.svelte`
- Create: `apps/web/src/routes/(admin)/dashboard/page.render.test.ts`

**Interfaces:**
- Consumes: none new from `packages/ui`.
- Produces: `AdminShell` (`children: Snippet`, `title?: string`) — a desktop-first sidebar-plus-topbar shell, per the spec's evidence: "the CSR site is desktop-first B2B" (this shell is the one later CSR/admin route groups will reuse; Phase 0c stands up exactly one placeholder page under it so the shell is proven inside real SvelteKit routing, not just a component-level test — no actual admin features exist yet, so the page's content is intentionally minimal).

- [ ] **Step 1: Write the failing test — `packages/ui/src/layouts/AdminShell.test.ts`**

```ts
import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import AdminShell from "./AdminShell.svelte";

afterEach(() => cleanup());

describe("AdminShell", () => {
  test("renders a sidebar with the GalangDana wordmark, a title, and the page content", () => {
    render(AdminShell, { props: { title: "Dashboard", children: textSnippet("Panel content") } });
    expect(screen.getByText("GalangDana")).not.toBeNull();
    expect(screen.getByText("Dashboard")).not.toBeNull();
    expect(screen.getByText("Panel content")).not.toBeNull();
  });

  test("does not constrain content width the way ConsumerShell does", () => {
    const { container } = render(AdminShell, { props: { children: textSnippet("x") } });
    const main = container.querySelector("main");
    expect(main?.className).not.toContain("max-w-md");
  });
});

function textSnippet(text: string) {
  return ((anchor: Node) => {
    anchor.parentNode?.insertBefore(document.createTextNode(text), anchor);
  }) as unknown as import("svelte").Snippet;
}
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd packages/ui && bun x vitest run src/layouts/AdminShell.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/ui/src/layouts/AdminShell.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title?: string;
    children: Snippet;
  }

  const { title, children }: Props = $props();
</script>

<div class="flex min-h-screen bg-neutral-50">
  <aside class="w-56 shrink-0 border-r border-neutral-200 bg-white px-4 py-6">
    <span class="font-sans text-lg font-bold text-primary-dark">GalangDana</span>
  </aside>
  <div class="flex-1">
    {#if title}
      <header class="border-b border-neutral-200 bg-white px-6 py-4">
        <h1 class="font-sans text-xl font-semibold text-neutral-900">{title}</h1>
      </header>
    {/if}
    <main class="px-6 py-6">
      {@render children()}
    </main>
  </div>
</div>
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd packages/ui && bun x vitest run src/layouts/AdminShell.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the barrel — `packages/ui/src/index.ts`**

Add, alongside the existing exports:

```ts
export { default as AdminShell } from "./layouts/AdminShell.svelte";
```

- [ ] **Step 6: Wire the `(admin)` route group's layout — `apps/web/src/routes/(admin)/+layout.svelte`**

A route group's name is never a URL segment — `(consumer)` and `(admin)` are both invisible in the URL, they only group which pages share a layout. `(consumer)/+page.svelte` (Task 5) already resolves to `/`, so this route group must NOT also place a `+page.svelte` directly inside `(admin)/` (SvelteKit would fail to build on the resulting route conflict, both resolving to `/`). The layout itself is safe to place directly in `(admin)/`, since a `+layout.svelte` alone renders nothing on its own — it only wraps whatever page ends up nested under it, at whatever depth. Step 7 places that page one level deeper, at `(admin)/dashboard/+page.svelte`, specifically to avoid the collision.

```svelte
<script lang="ts">
  import { AdminShell } from "@galangdana/ui";

  const { children } = $props();
</script>

<AdminShell title="Dashboard">
  {@render children()}
</AdminShell>
```

- [ ] **Step 7: Add a minimal placeholder page at a real path — `apps/web/src/routes/(admin)/dashboard/+page.svelte`**

```svelte
<p class="font-sans text-neutral-600">
  The admin dashboard doesn't exist yet — this route exists to prove the B2B shell renders
  correctly inside real SvelteKit routing. Real admin/moderation features land in a later phase.
</p>
```

This resolves to `/dashboard` (not `/` — see Step 6's note), still wrapped by `(admin)/+layout.svelte`'s `AdminShell`, since SvelteKit layouts apply to every page nested under them regardless of how many extra path segments sit in between.

- [ ] **Step 8: Write the rendering test — `apps/web/src/routes/(admin)/dashboard/page.render.test.ts`**

```ts
// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import Page from "./+page.svelte";

afterEach(() => cleanup());

describe("(admin) placeholder page", () => {
  test("renders without a data prop (no load function exists yet)", () => {
    render(Page, { props: {} });
    expect(screen.getByText(/admin dashboard doesn't exist yet/)).not.toBeNull();
  });
});
```

- [ ] **Step 9: Run it, verify it passes**

Run: `cd apps/web && bun x vitest run src/routes/\(admin\)/dashboard/page.render.test.ts`
Expected: PASS.

- [ ] **Step 10: Build and verify the route conflict from Step 7 is actually resolved**

Run: `cd apps/web && bun x vite build`
Expected: succeeds with no route-conflict error, and the build output lists both `/` and `/dashboard` as prerendered/server routes (check the build's route manifest output in its logs).

- [ ] **Step 11: Add the new admin page to the CI link-check's reachable surface**

Check `scripts/check-links.ts` (referenced by the CI workflow's `Link check` step) — if it crawls links reachable from `/` rather than a fixed route list, `/dashboard` may not be discovered automatically since nothing on the homepage links to it yet. Read the script to confirm its crawl strategy; if it only follows in-page links, this is fine to leave as-is for now (the admin section intentionally has no consumer-facing entry point yet) — do NOT add a footer/nav link to `/dashboard` from the consumer homepage just to satisfy the link checker, since a real admin section needs authentication-gated access, not a public link, and that's out of scope for this phase.

- [ ] **Step 12: Run the full local verification**

Run: `bun install && bun run lint && bun run typecheck && bun run test && bun run test:ui && bun run test:web`
Expected: all clean.

- [ ] **Step 13: Commit**

```bash
git add packages/ui/src apps/web/src
git commit -m "feat(web): add desktop-first admin/B2B layout shell with a placeholder route"
```

---

## Task 7: CI verification pass and final `.env.example`/documentation check

**Files:**
- Modify: `.github/workflows/ci.yml` (only if Task 1's Step 18 addition needs adjustment after real CI feedback — see below)

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: nothing new — this task is a verification checkpoint, not a feature addition, matching the shape of Phase 0a/0b's final CI-focused task.

- [ ] **Step 1: Run the complete verification suite one more time, exactly as CI will**

Run:
```bash
bun install
bun run lint
bun run typecheck
bun run test
bun run test:ui
bun run test:web
bun run --cwd apps/web build
```
Expected: every command exits 0.

- [ ] **Step 2: Confirm `packages/ui` has no stray build artifacts or a build step CI would need**

Run: `git status --porcelain packages/ui`
Expected: clean (no untracked `dist/`, `.svelte-kit/`, etc. — `packages/ui` is consumed from source, per this plan's Global Constraints, so there should be nothing to build or gitignore-miss here).

- [ ] **Step 3: Confirm the CI workflow's new `Unit tests (ui)` step (added in Task 1) is positioned correctly**

Read `.github/workflows/ci.yml` and confirm the step order is: install → lint → migrate → typecheck → test (packages+api) → test (web) → **test (ui)** → build web → start API → wait → start web → wait → link check. If the `Unit tests (ui)` step ended up misplaced (e.g. after `Build web`), move it back to directly follow `Unit tests (web)` — unit tests should run before the build/e2e-style steps that depend on a working build, matching the existing ordering rationale for `test` and `test:web`.

- [ ] **Step 4: Commit any fix from Step 3 (skip this step if nothing needed changing)**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: fix Unit tests (ui) step ordering"
```

---

## Verification

- **Unit** (Vitest, `packages/ui` and `apps/web`): every component (`Button`, `TextInput`, `Label`, `FormField`, `Card`, `Badge`, `Avatar`, `Spinner`, `Alert`, `ConsumerShell`, `AdminShell`) has a real rendering test asserting DOM output, not just "doesn't throw." `apps/web`'s `page.render.test.ts` files prove the design system actually renders inside real SvelteKit page components, not just in isolation.
- **Build integrity**: Task 1 Step 16 and Task 5 Step 12 both inspect the built CSS output directly to confirm design-token classes survive the full Vite build pipeline, including classes used only inside `packages/ui` — verified working via SvelteKit's own auto-detection (see Global Constraints), and checked twice against the real build rather than assumed once.
- **CI**: the existing `ci.yml` link-check and `vite preview`-based smoke test already exercise the real built app; Task 1/7 add `packages/ui`'s own unit-test step alongside the existing `packages` and `web` steps.
- No visual/screenshot regression testing is set up in this phase — there is no existing visual baseline to regress against (this is the first UI Phase 0 has built), and standing up a visual-diff pipeline for a single homepage and one placeholder page is disproportionate. Revisit once Phase 1 (Discovery + campaign read) adds enough real pages to make visual regression worth the setup cost.

## Risks

- **Google Fonts CDN dependency.** Loading Plus Jakarta Sans from `fonts.googleapis.com` (Task 1 Step 15) adds a third-party network dependency and a minor privacy/performance cost (an extra DNS lookup + request on every page load, and Google can see requests from GalangDana's users). Self-hosting the variable font file removes both; deferred here because it requires fetching and vetting an actual font binary, which is disproportionate for a phase whose goal is proving the design system works, not finalizing production asset delivery. Track as a follow-up before this leaves Phase 0.
- **The spec's "id-ID formatting and a11y first-class" concern is only partly addressed here.** Basic accessibility semantics are established as a pattern every future component should follow (`Label`'s `for`/`id` pairing, `TextInput`'s `aria-invalid`, `Alert`'s `role="alert"`, `Spinner`'s `role="status"`, `Avatar`'s `alt`/`aria-label` fallback) — but keyboard/focus management for multi-step flows and Indonesian-locale date/Rupiah formatting are explicitly NOT covered, because nothing built in this phase has a multi-step flow or displays money/dates yet. Real focus-trap behavior belongs with the first modal/wizard component (Phase 4's creation wizard); Rupiah/date formatting belongs with the first component that renders real campaign/donation data (Phase 1). Flagged so neither is mistaken for "already handled."
- **Two shells, one CSS pipeline.** `ConsumerShell` and `AdminShell` are visually very different (mobile column vs. desktop sidebar) but share one Tailwind build and one token file by design — this is intentional (one brand, two layouts) and not a risk in itself, but a future task that tries to give the admin/CSR shell a *different* color palette (per the master plan's note that Kitabisa ORG has its own distinct visual treatment) would need a second `@theme` scope or a data-attribute-driven token override, neither of which exists yet. Out of scope for Phase 0c; flagged so Phase 8 (CSR module) doesn't assume it for free.
