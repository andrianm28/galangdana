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
