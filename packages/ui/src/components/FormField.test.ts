import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import FormField from "./FormField.svelte";

afterEach(() => cleanup());

function inputSnippet(id: string) {
  return ((anchor: Node) => {
    const input = document.createElement("input");
    input.id = id;
    input.type = "text";
    anchor.parentNode?.insertBefore(input, anchor);
  }) as unknown as import("svelte").Snippet;
}

describe("FormField", () => {
  test("renders the label, the wrapped input, and no error/hint when neither is given", () => {
    render(FormField, {
      props: { label: "Email", id: "email", children: inputSnippet("email") },
    });
    expect(screen.getByText("Email")).not.toBeNull();
    expect(screen.getByRole("textbox")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("the label's for attribute matches the input's id", () => {
    render(FormField, {
      props: { label: "Email", id: "email-field", children: inputSnippet("email-field") },
    });
    const label = screen.getByText("Email");
    expect(label.getAttribute("for")).toBe("email-field");
  });

  test("shows an error message with role=alert when error is set", () => {
    render(FormField, {
      props: {
        label: "Email",
        id: "email",
        error: "Enter a valid email address",
        children: inputSnippet("email"),
      },
    });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Enter a valid email address");
  });

  test("shows a hint when hint is set and there is no error", () => {
    render(FormField, {
      props: {
        label: "Phone",
        id: "phone",
        hint: "We'll text you a code",
        children: inputSnippet("phone"),
      },
    });
    expect(screen.getByText("We'll text you a code")).not.toBeNull();
  });

  test("the error paragraph's id is derived from the field id, for aria-describedby wiring", () => {
    render(FormField, {
      props: {
        label: "Email",
        id: "email",
        error: "Enter a valid email address",
        children: inputSnippet("email"),
      },
    });
    const alert = screen.getByRole("alert");
    expect(alert.id).toBe("email-error");
  });

  test("the hint paragraph's id is derived from the field id, for aria-describedby wiring", () => {
    render(FormField, {
      props: {
        label: "Phone",
        id: "phone",
        hint: "We'll text you a code",
        children: inputSnippet("phone"),
      },
    });
    const hint = screen.getByText("We'll text you a code");
    expect(hint.id).toBe("phone-hint");
  });
});
