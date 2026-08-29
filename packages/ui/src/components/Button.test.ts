import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test, vi } from "vitest";
import Button from "./Button.svelte";

afterEach(() => cleanup());

describe("Button", () => {
  test("renders its label and fires onclick", async () => {
    const onclick = vi.fn();
    render(Button, { props: { onclick, children: createSnippet("Donate now") } });

    const button = screen.getByRole("button", { name: "Donate now" });
    await fireEvent.click(button);

    expect(onclick).toHaveBeenCalledTimes(1);
  });

  test("defaults to the primary variant and medium size", () => {
    render(Button, { props: { children: createSnippet("Save") } });
    const button = screen.getByRole("button");
    expect(button.className).toContain("bg-primary");
    expect(button.className).not.toContain("bg-accent");
  });

  test("applies variant classes", () => {
    render(Button, { props: { variant: "danger", children: createSnippet("Delete") } });
    const button = screen.getByRole("button");
    expect(button.className).toContain("bg-error");
  });

  test("disabled buttons cannot be clicked and carry the disabled attribute", async () => {
    const onclick = vi.fn();
    render(Button, { props: { disabled: true, onclick, children: createSnippet("Wait") } });
    const button = screen.getByRole("button") as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    await fireEvent.click(button);
    expect(onclick).not.toHaveBeenCalled();
  });

  test("loading buttons show a spinner, are disabled, and keep the label for screen readers", () => {
    render(Button, { props: { loading: true, children: createSnippet("Submitting") } });
    const button = screen.getByRole("button") as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(button.querySelector('[data-testid="button-spinner"]')).not.toBeNull();
    expect(button.textContent).toContain("Submitting");
  });

  test("defaults to type=button so it never accidentally submits a form", () => {
    render(Button, { props: { children: createSnippet("Click") } });
    const button = screen.getByRole("button") as HTMLButtonElement;
    expect(button.type).toBe("button");
  });
});

// @testing-library/svelte's render() takes real Snippet values for a
// component's children prop, not plain strings -- this constructs one the
// same way Svelte's own compiler output does, so tests don't need a
// wrapper .svelte fixture file just to pass text content through.
function createSnippet(text: string) {
  return ((anchor: Node) => {
    const textNode = document.createTextNode(text);
    anchor.parentNode?.insertBefore(textNode, anchor);
  }) as unknown as import("svelte").Snippet;
}
