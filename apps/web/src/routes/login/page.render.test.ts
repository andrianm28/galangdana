// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

vi.mock("$env/dynamic/public", () => ({
  env: {
    PUBLIC_API_URL: "http://localhost:3001",
  },
}));

describe("(login) page rendering", () => {
  test("shows the phone input by default", () => {
    render(Page);
    expect(screen.getByText("Masuk ke GalangDana")).not.toBeNull();
    expect(screen.getByLabelText("Nomor telepon")).not.toBeNull();
  });
});
