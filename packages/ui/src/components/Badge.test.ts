import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import Badge from "./Badge.svelte";

afterEach(() => cleanup());

describe("Badge", () => {
  test("defaults to the neutral variant", () => {
    render(Badge, { props: { children: textSnippet("Draft") } });
    const badge = screen.getByText("Draft");
    expect(badge.className).toContain("bg-neutral-100");
  });

  test("applies the success variant's classes", () => {
    render(Badge, { props: { variant: "success", children: textSnippet("Verified") } });
    const badge = screen.getByText("Verified");
    expect(badge.className).toContain("bg-primary-light");
  });
});

function textSnippet(text: string) {
  return ((anchor: Node) => {
    anchor.parentNode?.insertBefore(document.createTextNode(text), anchor);
  }) as unknown as import("svelte").Snippet;
}
