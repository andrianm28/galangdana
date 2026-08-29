import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import Avatar from "./Avatar.svelte";

afterEach(() => cleanup());

describe("Avatar", () => {
  test("renders an img with the given src and alt text when src is provided", () => {
    render(Avatar, { props: { name: "Budi Santoso", src: "https://example.test/budi.jpg" } });
    const img = screen.getByRole("img", { name: "Budi Santoso" }) as HTMLImageElement;
    expect(img.src).toBe("https://example.test/budi.jpg");
  });

  test("falls back to initials when no src is given", () => {
    render(Avatar, { props: { name: "Budi Santoso" } });
    expect(screen.getByText("BS")).not.toBeNull();
  });

  test("derives initials from a single-word name using its first two letters", () => {
    render(Avatar, { props: { name: "Madonna" } });
    expect(screen.getByText("MA")).not.toBeNull();
  });
});
