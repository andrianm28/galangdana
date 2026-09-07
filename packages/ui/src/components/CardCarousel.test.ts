import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test, vi } from "vitest";
import CardCarousel from "./CardCarousel.svelte";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function textSnippet(text: string) {
  return ((anchor: Node) => {
    anchor.parentNode?.insertBefore(document.createTextNode(text), anchor);
  }) as unknown as import("svelte").Snippet;
}

// happy-dom reports scrollWidth/clientWidth/scrollLeft as 0 by default (it
// does not compute real layout), so tests simulate overflow explicitly and
// fire the 'scroll' listener the component wires up to recompute from it.
function setOverflow(
  track: Element,
  {
    scrollWidth,
    clientWidth,
    scrollLeft,
  }: { scrollWidth: number; clientWidth: number; scrollLeft: number },
) {
  Object.defineProperty(track, "scrollWidth", { value: scrollWidth, configurable: true });
  Object.defineProperty(track, "clientWidth", { value: clientWidth, configurable: true });
  Object.defineProperty(track, "scrollLeft", { value: scrollLeft, configurable: true });
}

describe("CardCarousel", () => {
  test("renders the track with role=group and the given label, and no scroll-snap classes", () => {
    render(CardCarousel, { props: { label: "Kategori Populer", children: textSnippet("item") } });
    const track = screen.getByRole("group", { name: "Kategori Populer" });
    expect(track.className).not.toContain("snap");
    expect(track.className).toContain("overflow-x-auto");
  });

  test("hides the scroll-next button when the track has no overflow", () => {
    render(CardCarousel, { props: { label: "Kategori", children: textSnippet("item") } });
    expect(screen.queryByRole("button", { name: "Geser ke kanan" })).toBeNull();
  });

  test("shows the scroll-next button once the track can scroll further", async () => {
    render(CardCarousel, { props: { label: "Kategori", children: textSnippet("item") } });
    const track = screen.getByRole("group", { name: "Kategori" });

    setOverflow(track, { scrollWidth: 1000, clientWidth: 300, scrollLeft: 0 });
    await fireEvent.scroll(track);

    expect(screen.getByRole("button", { name: "Geser ke kanan" })).not.toBeNull();
  });

  test("hides the scroll-next button once the track has scrolled to its end", async () => {
    render(CardCarousel, { props: { label: "Kategori", children: textSnippet("item") } });
    const track = screen.getByRole("group", { name: "Kategori" });

    setOverflow(track, { scrollWidth: 1000, clientWidth: 300, scrollLeft: 0 });
    await fireEvent.scroll(track);
    expect(screen.getByRole("button", { name: "Geser ke kanan" })).not.toBeNull();

    setOverflow(track, { scrollWidth: 1000, clientWidth: 300, scrollLeft: 700 });
    await fireEvent.scroll(track);
    expect(screen.queryByRole("button", { name: "Geser ke kanan" })).toBeNull();
  });

  test("scrolls the track with smooth behavior by default", async () => {
    render(CardCarousel, { props: { label: "Kategori", children: textSnippet("item") } });
    const track = screen.getByRole("group", { name: "Kategori" });
    setOverflow(track, { scrollWidth: 1000, clientWidth: 300, scrollLeft: 0 });
    await fireEvent.scroll(track);

    const scrollBySpy = vi.fn();
    // biome-ignore lint/suspicious/noExplicitAny: happy-dom doesn't implement scrollBy
    (track as any).scrollBy = scrollBySpy;

    await fireEvent.click(screen.getByRole("button", { name: "Geser ke kanan" }));

    expect(scrollBySpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
  });

  test("scrolls the track with 'auto' behavior when the user prefers reduced motion", async () => {
    vi.stubGlobal("matchMedia", (_query: string) => ({ matches: true }) as MediaQueryList);

    render(CardCarousel, { props: { label: "Kategori", children: textSnippet("item") } });
    const track = screen.getByRole("group", { name: "Kategori" });
    setOverflow(track, { scrollWidth: 1000, clientWidth: 300, scrollLeft: 0 });
    await fireEvent.scroll(track);

    const scrollBySpy = vi.fn();
    // biome-ignore lint/suspicious/noExplicitAny: happy-dom doesn't implement scrollBy
    (track as any).scrollBy = scrollBySpy;

    await fireEvent.click(screen.getByRole("button", { name: "Geser ke kanan" }));

    expect(scrollBySpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
  });
});
