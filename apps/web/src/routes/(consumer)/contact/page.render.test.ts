// @vitest-environment happy-dom
vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

describe("(consumer) /contact rendering", () => {
  test("shows the contact form", () => {
    render(Page, { props: { params: {}, data: {} } });
    expect(screen.getByLabelText("Nama")).not.toBeNull();
    expect(screen.getByLabelText("Email")).not.toBeNull();
    expect(screen.getByLabelText("Pesan")).not.toBeNull();
  });

  test("submits the form and shows a confirmation", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "11111111-1111-1111-1111-111111111111" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(Page, { props: { params: {}, data: {} } });
    await fireEvent.input(screen.getByLabelText("Nama"), { target: { value: "Rina" } });
    await fireEvent.input(screen.getByLabelText("Email"), {
      target: { value: "rina@example.test" },
    });
    await fireEvent.input(screen.getByLabelText("Pesan"), {
      target: { value: "Saya butuh bantuan." },
    });
    await fireEvent.click(screen.getByText("Kirim"));

    await waitFor(() => {
      expect(screen.getByText(/Pesan Anda telah terkirim/)).not.toBeNull();
    });
    expect(fetchSpy).toHaveBeenCalled();
  });
});
