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
