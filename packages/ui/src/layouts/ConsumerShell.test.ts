import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import ConsumerShell from "./ConsumerShell.svelte";

afterEach(() => cleanup());

describe("ConsumerShell", () => {
  test("renders the FundForIndonesia wordmark and the page content", () => {
    const { container } = render(ConsumerShell, {
      props: { children: textSnippet("Homepage content") },
    });
    expect(screen.getByText("FundForIndonesia")).not.toBeNull();
    expect(screen.getByText("Homepage content")).not.toBeNull();
  });

  test("constrains content to a mobile-width column even on a wide viewport", () => {
    const { container } = render(ConsumerShell, { props: { children: textSnippet("x") } });
    const main = container.querySelector("main");
    expect(main?.className).toContain("max-w-md");
  });

  test("credits Yayasan Indonesia Emas as the operating foundation, linking to its site", () => {
    render(ConsumerShell, { props: { children: textSnippet("x") } });
    const link = screen.getByRole("link", { name: "Yayasan Indonesia Emas" });
    expect(link.getAttribute("href")).toBe("https://yayasanindonesiaemas.com/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

function textSnippet(text: string) {
  return ((anchor: Node) => {
    anchor.parentNode?.insertBefore(document.createTextNode(text), anchor);
  }) as unknown as import("svelte").Snippet;
}
