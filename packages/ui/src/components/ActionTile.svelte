<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
  href: string;
  label: string;
  icon: Snippet;
}

const { href, label, icon }: Props = $props();
</script>

<!--
  icon must be a Snippet rendering inline SVG, never a Unicode glyph string --
  symbols like the gear/kebab glyphs are missing from common Android system
  fonts and render as tofu boxes there. The holder is aria-hidden: the label
  below carries the tile's meaning, so the icon needs no accessible name of
  its own.
-->
<a
  {href}
  class="flex flex-col items-center gap-2 text-center transition-transform duration-100 active:scale-[0.98]"
>
  <span
    aria-hidden="true"
    class="flex size-12 items-center justify-center rounded-full bg-primary-light text-primary-dark transition-colors duration-150"
  >
    {@render icon()}
  </span>
  <span class="font-sans text-xs text-neutral-800">{label}</span>
</a>
