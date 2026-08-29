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
