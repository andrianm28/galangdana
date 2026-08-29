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
