import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test, vi } from "vitest";
import TextInput from "./TextInput.svelte";

afterEach(() => cleanup());

describe("TextInput", () => {
  test("renders with the given id, type, and placeholder", () => {
    render(TextInput, {
      props: { id: "email", type: "email", value: "", placeholder: "you@example.com" },
    });
    const input = screen.getByPlaceholderText("you@example.com") as HTMLInputElement;
    expect(input.id).toBe("email");
    expect(input.type).toBe("email");
  });

  test("defaults to type=text", () => {
    render(TextInput, { props: { id: "name", value: "" } });
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.type).toBe("text");
  });

  test("calls oninput with the new value on every keystroke", async () => {
    const oninput = vi.fn();
    render(TextInput, { props: { id: "name", value: "", oninput } });
    const input = screen.getByRole("textbox");

    await fireEvent.input(input, { target: { value: "Budi" } });

    expect(oninput).toHaveBeenCalledWith("Budi");
  });

  test("applies invalid styling and aria-invalid when invalid is true", () => {
    render(TextInput, { props: { id: "email", value: "not-an-email", invalid: true } });
    const input = screen.getByRole("textbox");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.className).toContain("border-error");
  });

  test("disabled inputs cannot be edited", () => {
    render(TextInput, { props: { id: "name", value: "locked", disabled: true } });
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });
});
