// @vitest-environment happy-dom
//
// Behaviour parity with kibi-clone's PrayerWall.test.tsx for the parts that
// exist here: both variants, and the optimistic amiin with revert on failure.
// Its SSE cases have no counterpart -- the stream is deliberately not ported
// (see the component comment), and a test for a feature that is not there
// would assert nothing.
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test, vi } from "vitest";
import PrayerWall from "./PrayerWall.svelte";

const BASE = {
  id: "p1",
  displayName: "Budi",
  message: "Semoga lekas sembuh",
  amiinCount: 3,
  createdAt: "2026-09-01T10:00:00.000Z",
};

const WITH_CAMPAIGN = {
  ...BASE,
  id: "p2",
  campaignSlug: "bantu-aldi",
  campaignTitle: "Bantu Aldi Sembuh",
};

afterEach(() => cleanup());

describe("PrayerWall", () => {
  test("shows an empty message when there are no prayers", () => {
    render(PrayerWall, { props: { prayers: [] } });
    expect(screen.getByText(/Belum ada doa/)).not.toBeNull();
  });

  test("accepts a custom empty message", () => {
    render(PrayerWall, { props: { prayers: [], emptyMessage: "Sunyi dulu" } });
    expect(screen.getByText("Sunyi dulu")).not.toBeNull();
  });

  test("renders the name, message and amiin count", () => {
    render(PrayerWall, { props: { prayers: [BASE] } });
    expect(screen.getByText("Budi")).not.toBeNull();
    expect(screen.getByText("Semoga lekas sembuh")).not.toBeNull();
    expect(screen.getByTestId("amiin-count").textContent).toBe("3");
  });

  test("links to the campaign when the item carries campaign fields", () => {
    render(PrayerWall, { props: { prayers: [WITH_CAMPAIGN] } });
    expect(screen.getByRole("link", { name: "Bantu Aldi Sembuh" }).getAttribute("href")).toBe(
      "/campaign/bantu-aldi",
    );
  });

  test("renders no campaign link when the item has none", () => {
    render(PrayerWall, { props: { prayers: [BASE] } });
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("renders no amiin button when onAmiin is not given", () => {
    render(PrayerWall, { props: { prayers: [BASE] } });
    expect(screen.queryByRole("button", { name: /Aamiin/ })).toBeNull();
    // The count is still shown -- read-only, not hidden.
    expect(screen.getByTestId("amiin-count").textContent).toBe("3");
  });

  test("bumps the count immediately, before the request resolves", async () => {
    let release: ((n: number) => void) | undefined;
    const onAmiin = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          release = resolve;
        }),
    );

    render(PrayerWall, { props: { prayers: [BASE], onAmiin } });
    await fireEvent.click(screen.getByRole("button", { name: /Aamiin/ }));

    // Optimistic: 3 -> 4 with the promise still pending.
    expect(screen.getByTestId("amiin-count").textContent).toBe("4");
    release?.(4);
  });

  test("reconciles to the server's authoritative count, not the guess", async () => {
    // Server says 9 -- another visitor tapped in between. The optimistic value
    // would have been 4, and keeping it would leave a stale count that never
    // self-corrects.
    const onAmiin = vi.fn(async () => 9);
    render(PrayerWall, { props: { prayers: [BASE], onAmiin } });

    await fireEvent.click(screen.getByRole("button", { name: /Aamiin/ }));
    await vi.waitFor(() => expect(screen.getByTestId("amiin-count").textContent).toBe("9"));
  });

  test("reverts the count when the request fails", async () => {
    const onAmiin = vi.fn(async () => {
      throw new Error("offline");
    });
    render(PrayerWall, { props: { prayers: [BASE], onAmiin } });

    await fireEvent.click(screen.getByRole("button", { name: /Aamiin/ }));
    await vi.waitFor(() => expect(screen.getByTestId("amiin-count").textContent).toBe("3"));
  });

  test("ignores a second tap while one is already in flight", async () => {
    let release: ((n: number) => void) | undefined;
    const onAmiin = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          release = resolve;
        }),
    );

    render(PrayerWall, { props: { prayers: [BASE], onAmiin } });
    const button = screen.getByRole("button", { name: /Aamiin/ });

    await fireEvent.click(button);
    await fireEvent.click(button);

    // One request, one bump -- not two bumps against a single revert.
    expect(onAmiin).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("amiin-count").textContent).toBe("4");
    release?.(4);
  });

  test("a fresh prayers prop wins over a local optimistic value", async () => {
    const onAmiin = vi.fn(async () => 4);
    const { rerender } = render(PrayerWall, { props: { prayers: [BASE], onAmiin } });

    await fireEvent.click(screen.getByRole("button", { name: /Aamiin/ }));
    await vi.waitFor(() => expect(screen.getByTestId("amiin-count").textContent).toBe("4"));

    // A reload brings a different id, so no stale override applies to it.
    await rerender({ prayers: [{ ...BASE, id: "p9", amiinCount: 11 }], onAmiin });
    expect(screen.getByTestId("amiin-count").textContent).toBe("11");
  });

  test("each prayer keeps its own count", async () => {
    const onAmiin = vi.fn(async (id: string) => (id === "p1" ? 4 : 99));
    render(PrayerWall, {
      props: {
        // Distinct displayName on purpose: the amiin button's accessible name
        // is derived from it, so two prayers sharing a name give two buttons
        // the same name and getByRole matches both.
        prayers: [BASE, { ...WITH_CAMPAIGN, displayName: "Sari", amiinCount: 7 }],
        onAmiin,
      },
    });

    await fireEvent.click(screen.getByRole("button", { name: /doa dari Budi/ }));
    await vi.waitFor(() => {
      const counts = screen.getAllByTestId("amiin-count").map((n) => n.textContent);
      expect(counts).toEqual(["4", "7"]);
    });
  });
});
