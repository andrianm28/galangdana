// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

describe("(admin) placeholder page", () => {
  test("renders without a data prop (no load function exists yet)", () => {
    render(Page, { props: {} });
    expect(screen.getByText(/admin dashboard doesn't exist yet/)).not.toBeNull();
  });
});
