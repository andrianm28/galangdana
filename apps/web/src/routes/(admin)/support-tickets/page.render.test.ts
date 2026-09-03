// @vitest-environment happy-dom
vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

const SAMPLE_TICKET = {
  id: "1",
  name: "Rina",
  email: "rina@example.test",
  message: "Bagaimana cara membatalkan donasi berulang?",
  status: "open" as const,
  createdAt: new Date().toISOString(),
  resolvedAt: null,
};

describe("(admin) /support-tickets rendering", () => {
  test("with no tickets, shows an empty state", () => {
    render(Page, { props: { params: {}, form: null, data: { tickets: [] } } });
    expect(screen.getByText(/Tidak ada tiket/)).not.toBeNull();
  });

  test("lists open tickets with a resolve button", () => {
    render(Page, { props: { params: {}, form: null, data: { tickets: [SAMPLE_TICKET] } } });
    expect(screen.getByText("Rina")).not.toBeNull();
    expect(screen.getByText("Bagaimana cara membatalkan donasi berulang?")).not.toBeNull();
    expect(screen.getByText("Tandai Selesai")).not.toBeNull();
  });

  test("resolving a ticket removes it from the list", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "resolved" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(Page, { props: { params: {}, form: null, data: { tickets: [SAMPLE_TICKET] } } });
    await fireEvent.click(screen.getByText("Tandai Selesai"));

    await waitFor(() => {
      expect(screen.queryByText("Rina")).toBeNull();
    });
    expect(fetchSpy).toHaveBeenCalled();
  });

  test("when resolve API fails, error message renders and ticket stays in list", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Failed to resolve" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    render(Page, { props: { params: {}, form: null, data: { tickets: [SAMPLE_TICKET] } } });
    await fireEvent.click(screen.getByText("Tandai Selesai"));

    await waitFor(() => {
      expect(screen.getByText("Gagal menandai tiket sebagai selesai.")).not.toBeNull();
    });

    // Ticket should still be visible in the list
    expect(screen.getByText("Rina")).not.toBeNull();
    expect(screen.getByText("Bagaimana cara membatalkan donasi berulang?")).not.toBeNull();
    expect(fetchSpy).toHaveBeenCalled();
  });
});
