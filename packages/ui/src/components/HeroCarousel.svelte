<!--
  Auto-rotating hero carousel.

  Ported from kibi-clone's HeroBanner.tsx with behaviour parity: its 16 tests
  are the specification, and HeroCarousel.test.ts reproduces every one of them.
  The implementation differs because the stack does -- kibi drives transitions
  with framer-motion's AnimatePresence, which has no Svelte equivalent, so the
  slide change is a CSS opacity/translate transition here. Observable behaviour
  is the same; the mechanism is not, and could not be.

  Two deliberate departures from the original, both FFI requirements the source
  does not have:

  1. Auto-rotation stops under prefers-reduced-motion. An unattended carousel
     that advances every five seconds is exactly the vestibular trigger that
     setting exists for, and unlike a transition it cannot be neutralised by
     app.css's reduced-motion block -- that resets transition-duration, not a
     JS timer. Checked in JS for the same reason CardCarousel checks it there.

  2. The slide <img> carries an explicit width/height and object-cover. Without
     intrinsic dimensions the hero reflows the whole page as each image lands,
     which on the homepage means the tile row and urgent rail jump under the
     reader's thumb.
-->
<script lang="ts">
export interface HeroSlide {
  image: string;
  headline: string;
  cta: { label: string; href: string };
}

interface Props {
  slides: HeroSlide[];
  /** Milliseconds between automatic advances. Matches the source's default. */
  autoPlayInterval?: number;
  /** Accessible name for the carousel region. */
  label?: string;
}

const { slides, autoPlayInterval = 5000, label = "Sorotan" }: Props = $props();

let index = $state(0);
// `paused` IS reassigned -- by the onmouseenter/onmouseleave handlers in the
// template. Biome only analyses the <script> block, so it cannot see those and
// reports the declaration as write-once. Same false positive CardCarousel
// documents for its bind:this binding.
// biome-ignore lint/style/useConst: reassigned from template event handlers
let paused = $state(false);
let touchStartX: number | null = null;

// 50px, matching the source's "ignores swipes that are too short" case. Below
// this a swipe is indistinguishable from a tap that moved slightly, and
// treating it as navigation makes the carousel feel twitchy while scrolling.
const SWIPE_THRESHOLD = 50;

const count = $derived(slides.length);

function goTo(next: number) {
  if (count === 0) return;
  index = ((next % count) + count) % count;
}

function next() {
  goTo(index + 1);
}

function previous() {
  goTo(index - 1);
}

$effect(() => {
  if (count <= 1 || paused) return;

  // CSS cannot stop a setInterval, so the reduced-motion check has to happen
  // here. Read inside the effect rather than at module scope so a viewer who
  // changes the OS setting mid-session gets the new behaviour on the next
  // pause/resume rather than needing a reload.
  const reduce = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (reduce) return;

  const timer = setInterval(next, autoPlayInterval);
  return () => clearInterval(timer);
});

function onTouchStart(event: TouchEvent) {
  touchStartX = event.touches[0]?.clientX ?? null;
}

function onTouchEnd(event: TouchEvent) {
  if (touchStartX === null) return;
  const endX = event.changedTouches[0]?.clientX ?? touchStartX;
  const delta = endX - touchStartX;
  touchStartX = null;
  if (Math.abs(delta) < SWIPE_THRESHOLD) return;
  // Swiping left (negative delta) moves forward, the same direction the
  // content travels under the finger.
  if (delta < 0) next();
  else previous();
}
</script>

{#if count > 0}
  <section
    aria-label={label}
    aria-roledescription="carousel"
    class="relative overflow-hidden rounded-lg bg-neutral-100"
    onmouseenter={() => (paused = true)}
    onmouseleave={() => (paused = false)}
    ontouchstart={onTouchStart}
    ontouchend={onTouchEnd}
  >
    {#each slides as slide, i (slide.image)}
      <div
        data-testid="hero-slide"
        role="group"
        aria-roledescription="slide"
        aria-label="{i + 1} dari {count}"
        aria-hidden={i === index ? undefined : "true"}
        class="transition-opacity duration-500 {i === index
          ? 'relative opacity-100'
          : 'pointer-events-none absolute inset-0 opacity-0'}"
      >
        <img
          src={slide.image}
          alt=""
          width="1920"
          height="720"
          loading={i === 0 ? "eager" : "lazy"}
          fetchpriority={i === 0 ? "high" : "auto"}
          class="aspect-[16/9] w-full object-cover sm:aspect-[21/9]"
        />
        <div
          class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-neutral-900/80 to-transparent p-4 sm:p-6"
        >
          <p class="font-sans text-base font-semibold text-white sm:text-xl">{slide.headline}</p>
          <a
            href={slide.cta.href}
            class="mt-3 inline-flex items-center rounded-sm bg-primary px-4 py-2 font-sans text-sm font-semibold text-white transition-colors duration-150 hover:bg-primary-dark"
          >
            {slide.cta.label}
          </a>
        </div>
      </div>
    {/each}

    {#if count > 1}
      <div class="absolute inset-x-0 bottom-1 flex justify-center gap-1.5">
        {#each slides as slide, i (slide.image)}
          <button
            type="button"
            aria-label="Ke slide {i + 1}"
            aria-current={i === index ? "true" : undefined}
            onclick={() => goTo(i)}
            class="size-2 rounded-full transition-colors duration-150 {i === index
              ? 'bg-white'
              : 'bg-white/50'}"
          ></button>
        {/each}
      </div>
    {/if}
  </section>
{/if}
