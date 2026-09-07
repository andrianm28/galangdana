// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Layout from "./+layout.svelte";

vi.mock("$app/state", () => ({
  page: {
    url: new URL("http://localhost/campaigns/123"),
  },
}));

function textSnippet(text: string) {
  return ((anchor: Node) => {
    anchor.parentNode?.insertBefore(document.createTextNode(text), anchor);
  }) as unknown as import("svelte").Snippet;
}

describe("(admin) layout rendering", () => {
  test("gives /campaigns/[id] an explicit header title, since it has no nav entry of its own", () => {
    render(Layout, {
      props: { children: textSnippet("Panel content") },
    });
    expect(screen.getByRole("heading", { name: "Tinjau Kampanye" })).not.toBeNull();
  });
});
