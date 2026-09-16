<!--
  shrink-0 and whitespace-nowrap are both load-bearing, not tidying.

  The chip row is `flex gap-2 overflow-x-auto`. Flex items shrink by default, so
  without shrink-0 the chips compress to fit the viewport instead of overflowing
  into a scroll -- and once they are narrower than their label, the text wraps.
  A rounded-full pill with three wrapped lines and py-1.5 renders as a tall
  circle, which is what was shipping: "Balita & Anak Sakit" was a blob.

  The carousel never had this bug because its children carry an explicit
  `w-64 shrink-0`. The chip row was the one place relying on the default.
-->
<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
  href: string;
  label: string;
  icon?: Snippet;
}

const { href, label, icon }: Props = $props();
</script>

<a
  {href}
  class="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-neutral-200 bg-white px-3.5 py-1.5 font-sans text-sm text-neutral-800 transition-colors duration-150 hover:bg-neutral-100"
>
  {#if icon}
    <span aria-hidden="true" class="flex size-4 items-center justify-center">
      {@render icon()}
    </span>
  {/if}
  {label}
</a>
