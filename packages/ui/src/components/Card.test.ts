import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import Card from "./Card.svelte";

afterEach(() => cleanup());

describe("Card", () => {
  test("renders its children inside a rounded, bordered container", () => {
    const { container } = render(Card, { props: { children: textSnippet("Campaign summary") } });
    expect(screen.getByText("Campaign summary")).not.toBeNull();
    const card = container.querySelector("[data-testid='card']");
    expect(card?.className).toContain("rounded-md");
  });

  test("padded defaults to true, adding padding classes", () => {
    const { container } = render(Card, { props: { children: textSnippet("x") } });
    const card = container.querySelector("[data-testid='card']");
    expect(card?.className).toContain("p-4");
  });

  test("padded=false removes the padding classes", () => {
    const { container } = render(Card, { props: { padded: false, children: textSnippet("x") } });
    const card = container.querySelector("[data-testid='card']");
    expect(card?.className).not.toContain("p-4");
  });
});

function textSnippet(text: string) {
  return ((anchor: Node) => {
    anchor.parentNode?.insertBefore(document.createTextNode(text), anchor);
  }) as unknown as import("svelte").Snippet;
}
