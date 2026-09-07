<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
  label: string;
  children: Snippet;
}

const { label, children }: Props = $props();

// biome-ignore lint/style/useConst: bind:this reassigns this at mount, which biome's static analysis can't see
let track: HTMLDivElement | undefined = $state();
// Deliberately no scroll-snap on the track -- kitabisa.com's real carousel
// does not use it (verified live), and it fights a free-scrolling thumb drag.
let canScrollNext = $state(false);

// Recomputed on scroll/resize rather than once at mount: a carousel that fits
// its content today can overflow after a viewport resize, and one that
// overflows today reaches its end once the user scrolls it there.
function updateCanScrollNext() {
  if (!track) return;
  const { scrollWidth, scrollLeft, clientWidth } = track;
  // 1px slack: some browsers report a fractional scrollLeft that never quite
  // reaches scrollWidth - clientWidth exactly.
  canScrollNext = scrollWidth - scrollLeft - clientWidth > 1;
}

$effect(() => {
  const el = track;
  if (!el) return;
  updateCanScrollNext();
  el.addEventListener("scroll", updateCanScrollNext);
  globalThis.addEventListener?.("resize", updateCanScrollNext);
  return () => {
    el.removeEventListener("scroll", updateCanScrollNext);
    globalThis.removeEventListener?.("resize", updateCanScrollNext);
  };
});

function scrollNext() {
  if (!track) return;
  // CSS cannot override an explicit behavior: "smooth" passed to scrollBy,
  // so prefers-reduced-motion has to be checked here in JS instead.
  const reduce = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  track.scrollBy({ left: track.clientWidth * 0.8, behavior: reduce ? "auto" : "smooth" });
}
</script>

<div class="relative">
  <div
    bind:this={track}
    role="group"
    aria-label={label}
    class="flex gap-4 overflow-x-auto scroll-smooth"
  >
    {@render children()}
  </div>
  {#if canScrollNext}
    <button
      type="button"
      aria-label="Geser ke kanan"
      onclick={scrollNext}
      class="absolute right-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-white text-neutral-800 shadow transition-colors duration-150 hover:bg-neutral-100"
    >
      &rsaquo;
    </button>
  {/if}
</div>
