import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import AdminShell from "./AdminShell.svelte";

afterEach(() => cleanup());

describe("AdminShell", () => {
  test("renders a sidebar with the FundForIndonesia wordmark, a title, and the page content", () => {
    render(AdminShell, { props: { title: "Dashboard", children: textSnippet("Panel content") } });
    expect(screen.getByText("FundForIndonesia")).not.toBeNull();
    expect(screen.getByText("Dashboard")).not.toBeNull();
    expect(screen.getByText("Panel content")).not.toBeNull();
  });

  test("does not constrain content width the way ConsumerShell does", () => {
    const { container } = render(AdminShell, { props: { children: textSnippet("x") } });
    const main = container.querySelector("main");
    expect(main?.className).not.toContain("max-w-md");
  });
});

function textSnippet(text: string) {
  return ((anchor: Node) => {
    anchor.parentNode?.insertBefore(document.createTextNode(text), anchor);
  }) as unknown as import("svelte").Snippet;
}
