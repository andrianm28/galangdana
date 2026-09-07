<script lang="ts">
import type { Snippet } from "svelte";

type Variant = "neutral" | "success" | "warning" | "error" | "info" | "ledger";

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
  // Proof-state only -- see docs/design/2026-09-06-visual-redesign-plan.md's
  // Signature section. Never the default for a generic badge.
  ledger: "bg-ledger/10 text-ledger font-mono",
};
</script>

<span
  class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium font-sans {variantClasses[
    variant
  ]}"
>
  {@render children()}
</span>
