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
