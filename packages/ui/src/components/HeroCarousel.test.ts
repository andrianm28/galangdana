// @vitest-environment happy-dom
//
// Behaviour parity with kibi-clone's HeroBanner.test.tsx. Every case there has
// a counterpart here, under the same name where the name still describes what
// is being checked. Two additions at the end cover FFI requirements the source
// does not have (reduced motion, and layout stability from intrinsic image
// dimensions).
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import HeroCarousel from "./HeroCarousel.svelte";

const SLIDES = [
  { image: "/a.jpg", headline: "Slide satu", cta: { label: "Donasi", href: "/explore" } },
  { image: "/b.jpg", headline: "Slide dua", cta: { label: "Galang", href: "/create/info" } },
  { image: "/c.jpg", headline: "Slide tiga", cta: { label: "Jejak", href: "/jejak-dana" } },
];

/** A standalone single slide: SLIDES[0] is `T | undefined` under this
 *  package's strict indexed-access setting. */
const ONE_SLIDE = {
  image: "/solo.jpg",
  headline: "Slide tunggal",
  cta: { label: "Lihat", href: "/explore" },
};

/** The visible slide is the one not marked aria-hidden. */
function visibleHeadline(): string | null {
  const slides = screen.queryAllByTestId("hero-slide");
  const shown = slides.find((s) => s.getAttribute("aria-hidden") === null);
  return shown?.querySelector("p")?.textContent ?? null;
}

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  setReducedMotion(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

describe("HeroCarousel", () => {
  test("renders nothing when slides array is empty", () => {
    const { container } = render(HeroCarousel, { props: { slides: [] } });
    expect(container.querySelector("section")).toBeNull();
  });

  test("renders the first slide initially", () => {
    render(HeroCarousel, { props: { slides: SLIDES } });
    expect(visibleHeadline()).toBe("Slide satu");
  });

  test("renders CTA button with correct href", () => {
    render(HeroCarousel, { props: { slides: SLIDES } });
    expect(screen.getByRole("link", { name: "Donasi" }).getAttribute("href")).toBe("/explore");
  });

  test("renders dot indicators for all slides", () => {
    render(HeroCarousel, { props: { slides: SLIDES } });
    expect(screen.getAllByRole("button", { name: /Ke slide/ })).toHaveLength(3);
  });

  test("marks the first dot as active initially", () => {
    render(HeroCarousel, { props: { slides: SLIDES } });
    expect(screen.getByRole("button", { name: "Ke slide 1" }).getAttribute("aria-current")).toBe(
      "true",
    );
  });

  test("navigates to a specific slide when dot is clicked", async () => {
    render(HeroCarousel, { props: { slides: SLIDES } });
    await fireEvent.click(screen.getByRole("button", { name: "Ke slide 3" }));
    expect(visibleHeadline()).toBe("Slide tiga");
  });

  test("auto-rotates to the next slide after default interval (5000ms)", async () => {
    render(HeroCarousel, { props: { slides: SLIDES } });
    await vi.advanceTimersByTimeAsync(5000);
    expect(visibleHeadline()).toBe("Slide dua");
  });

  test("respects custom autoPlayInterval", async () => {
    render(HeroCarousel, { props: { slides: SLIDES, autoPlayInterval: 1000 } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(visibleHeadline()).toBe("Slide dua");
  });

  test("pauses auto-rotation on mouse enter and resumes on mouse leave", async () => {
    const { container } = render(HeroCarousel, { props: { slides: SLIDES } });
    const region = container.querySelector("section") as HTMLElement;

    await fireEvent.mouseEnter(region);
    await vi.advanceTimersByTimeAsync(15000);
    expect(visibleHeadline()).toBe("Slide satu");

    await fireEvent.mouseLeave(region);
    await vi.advanceTimersByTimeAsync(5000);
    expect(visibleHeadline()).toBe("Slide dua");
  });

  test("cycles back to first slide after the last slide", async () => {
    render(HeroCarousel, { props: { slides: SLIDES } });
    await vi.advanceTimersByTimeAsync(5000 * 3);
    expect(visibleHeadline()).toBe("Slide satu");
  });

  test("handles swipe left (next slide)", async () => {
    const { container } = render(HeroCarousel, { props: { slides: SLIDES } });
    const region = container.querySelector("section") as HTMLElement;
    await fireEvent.touchStart(region, { touches: [{ clientX: 300 }] });
    await fireEvent.touchEnd(region, { changedTouches: [{ clientX: 200 }] });
    expect(visibleHeadline()).toBe("Slide dua");
  });

  test("handles swipe right (previous slide)", async () => {
    const { container } = render(HeroCarousel, { props: { slides: SLIDES } });
    const region = container.querySelector("section") as HTMLElement;
    await fireEvent.touchStart(region, { touches: [{ clientX: 200 }] });
    await fireEvent.touchEnd(region, { changedTouches: [{ clientX: 300 }] });
    // Wraps backwards from the first slide, matching the source.
    expect(visibleHeadline()).toBe("Slide tiga");
  });

  test("ignores swipes that are too short", async () => {
    const { container } = render(HeroCarousel, { props: { slides: SLIDES } });
    const region = container.querySelector("section") as HTMLElement;
    await fireEvent.touchStart(region, { touches: [{ clientX: 300 }] });
    await fireEvent.touchEnd(region, { changedTouches: [{ clientX: 280 }] });
    expect(visibleHeadline()).toBe("Slide satu");
  });

  test("does not show dots when there is only one slide", () => {
    render(HeroCarousel, { props: { slides: [ONE_SLIDE] } });
    expect(screen.queryAllByRole("button", { name: /Ke slide/ })).toHaveLength(0);
  });

  test("loads the first slide eagerly and the rest lazily", () => {
    const { container } = render(HeroCarousel, { props: { slides: SLIDES } });
    const imgs = Array.from(container.querySelectorAll("img"));
    expect(imgs.at(0)?.getAttribute("loading")).toBe("eager");
    expect(imgs.at(1)?.getAttribute("loading")).toBe("lazy");
  });

  test("has correct ARIA attributes for accessibility", () => {
    const { container } = render(HeroCarousel, { props: { slides: SLIDES, label: "Sorotan" } });
    const region = container.querySelector("section") as HTMLElement;
    expect(region.getAttribute("aria-label")).toBe("Sorotan");
    expect(region.getAttribute("aria-roledescription")).toBe("carousel");

    const slides = screen.getAllByTestId("hero-slide");
    expect(slides.at(0)?.getAttribute("aria-hidden")).toBeNull();
    expect(slides.at(1)?.getAttribute("aria-hidden")).toBe("true");
  });

  // --- beyond the source ---

  test("does not auto-rotate under prefers-reduced-motion", async () => {
    setReducedMotion(true);
    render(HeroCarousel, { props: { slides: SLIDES } });
    await vi.advanceTimersByTimeAsync(20000);
    expect(visibleHeadline()).toBe("Slide satu");
  });

  test("still allows manual navigation under prefers-reduced-motion", async () => {
    setReducedMotion(true);
    render(HeroCarousel, { props: { slides: SLIDES } });
    await fireEvent.click(screen.getByRole("button", { name: "Ke slide 2" }));
    expect(visibleHeadline()).toBe("Slide dua");
  });

  test("gives every image intrinsic dimensions so the page does not reflow", () => {
    const { container } = render(HeroCarousel, { props: { slides: SLIDES } });
    for (const img of Array.from(container.querySelectorAll("img"))) {
      expect(img.getAttribute("width")).toBeTruthy();
      expect(img.getAttribute("height")).toBeTruthy();
    }
  });
});
