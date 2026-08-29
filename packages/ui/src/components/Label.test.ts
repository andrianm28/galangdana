import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import Label from "./Label.svelte";

afterEach(() => cleanup());

describe("Label", () => {
  test("associates with its input via the for/id relationship", () => {
    render(Label, { props: { for: "donor-name", children: textSnippet("Full name") } });
    const label = screen.getByText("Full name");
    expect(label.getAttribute("for")).toBe("donor-name");
  });
});

function textSnippet(text: string) {
  return ((anchor: Node) => {
    anchor.parentNode?.insertBefore(document.createTextNode(text), anchor);
  }) as unknown as import("svelte").Snippet;
}
