import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test, vi } from "vitest";
import Alert from "./Alert.svelte";

afterEach(() => cleanup());

describe("Alert", () => {
  test("renders its message with role=alert and defaults to the info variant", () => {
    render(Alert, { props: { children: textSnippet("Your donation was received") } });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Your donation was received");
    expect(alert.className).toContain("bg-info/10");
  });

  test("applies the error variant's classes", () => {
    render(Alert, { props: { variant: "error", children: textSnippet("Payment failed") } });
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("bg-error/10");
  });

  test("has no dismiss button when dismissible is false (the default)", () => {
    render(Alert, { props: { children: textSnippet("Info") } });
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("shows a dismiss button when dismissible is true, and calls onDismiss when clicked", async () => {
    const onDismiss = vi.fn();
    render(Alert, { props: { dismissible: true, onDismiss, children: textSnippet("Info") } });

    const dismissButton = screen.getByRole("button", { name: "Dismiss" });
    await fireEvent.click(dismissButton);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

function textSnippet(text: string) {
  return ((anchor: Node) => {
    anchor.parentNode?.insertBefore(document.createTextNode(text), anchor);
  }) as unknown as import("svelte").Snippet;
}
