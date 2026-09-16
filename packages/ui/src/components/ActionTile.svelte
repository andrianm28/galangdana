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
  <!--
    White holder, not bg-primary-light. The tile icons are two-tone -- a light
    blue fill inside a deeper blue outline -- and primary-light IS that same
    light blue, so on a tinted holder the icon's own fill disappeared into the
    background and only the outline read. White also matches what Kitabisa
    does: a plain light holder with a coloured illustration sitting on it.

    ring rather than shadow: a 1px ring stays crisp at 2x, where a soft shadow
    on a 56px circle turns into a grey halo.
  -->
  <span
    aria-hidden="true"
    class="flex size-14 items-center justify-center rounded-full bg-white ring-1 ring-neutral-200 transition-colors duration-150"
  >
    {@render icon()}
  </span>
  <span class="font-sans text-xs text-neutral-800">{label}</span>
</a>
