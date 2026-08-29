// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import Page from "./+page.svelte";

afterEach(() => cleanup());

describe("(consumer) homepage rendering", () => {
  test("shows a success badge when the API is healthy", () => {
    // `params` is required by the generated PageProps type (it's `{}` for
    // this route, since there are no dynamic segments) even though
    // +page.svelte never reads it -- svelte-check fails without it.
    render(Page, { props: { params: {}, data: { apiStatus: "ok", apiService: "api" } } });
    expect(screen.getByText("ok")).not.toBeNull();
    expect(screen.getByText("Welcome to GalangDana")).not.toBeNull();
  });

  test("shows an error-variant badge when the API status is unknown", () => {
    render(Page, { props: { params: {}, data: { apiStatus: "unknown", apiService: "unknown" } } });
    const badge = screen.getByText("unknown");
    expect(badge.className).toContain("bg-error");
  });
});
