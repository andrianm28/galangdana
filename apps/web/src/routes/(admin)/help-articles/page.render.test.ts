// @vitest-environment happy-dom
vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

const SAMPLE_ARTICLE = {
  id: "1",
  slug: "cara-berdonasi",
  question: "Bagaimana cara berdonasi?",
  answer: "Pilih campaign, tentukan nominal, lalu pilih metode pembayaran.",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("(admin) /help-articles rendering", () => {
  test("lists existing articles", () => {
    render(Page, { props: { params: {}, form: null, data: { articles: [SAMPLE_ARTICLE] } } });
    expect(screen.getByText("Bagaimana cara berdonasi?")).not.toBeNull();
    expect(screen.getByText("cara-berdonasi")).not.toBeNull();
  });

  test("creates a new article via the form", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "2",
          slug: "cara-daftar",
          question: "Bagaimana cara mendaftar?",
          answer: "Klik tombol daftar di halaman utama.",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    render(Page, { props: { params: {}, form: null, data: { articles: [] } } });
    await fireEvent.input(screen.getByLabelText("Slug"), { target: { value: "cara-daftar" } });
    await fireEvent.input(screen.getByLabelText("Pertanyaan"), {
      target: { value: "Bagaimana cara mendaftar?" },
    });
    await fireEvent.input(screen.getByLabelText("Jawaban"), {
      target: { value: "Klik tombol daftar di halaman utama." },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Tambah Artikel" }));

    await waitFor(() => {
      expect(screen.getByText("Bagaimana cara mendaftar?")).not.toBeNull();
    });
    expect(fetchSpy.mock.calls[0]?.[0]?.toString()).toContain("/admin/help-articles");
  });

  test("shows error when article creation fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Failed to create article" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    render(Page, { props: { params: {}, form: null, data: { articles: [SAMPLE_ARTICLE] } } });
    await fireEvent.input(screen.getByLabelText("Slug"), { target: { value: "cara-daftar" } });
    await fireEvent.input(screen.getByLabelText("Pertanyaan"), {
      target: { value: "Bagaimana cara mendaftar?" },
    });
    await fireEvent.input(screen.getByLabelText("Jawaban"), {
      target: { value: "Klik tombol daftar di halaman utama." },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Tambah Artikel" }));

    await waitFor(() => {
      expect(screen.getByText("Gagal menambahkan artikel.")).not.toBeNull();
    });
    expect(screen.getByText("Bagaimana cara berdonasi?")).not.toBeNull();
    expect(fetchSpy).toHaveBeenCalled();
  });

  test("shows a distinct error when article creation fails with a duplicate slug", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "slug_already_exists" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );

    render(Page, { props: { params: {}, form: null, data: { articles: [SAMPLE_ARTICLE] } } });
    await fireEvent.input(screen.getByLabelText("Slug"), {
      target: { value: "cara-berdonasi" },
    });
    await fireEvent.input(screen.getByLabelText("Pertanyaan"), {
      target: { value: "Bagaimana cara mendaftar?" },
    });
    await fireEvent.input(screen.getByLabelText("Jawaban"), {
      target: { value: "Klik tombol daftar di halaman utama." },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Tambah Artikel" }));

    await waitFor(() => {
      expect(screen.getByText("Slug sudah digunakan, gunakan slug lain.")).not.toBeNull();
    });
    expect(fetchSpy).toHaveBeenCalled();
  });

  test("deletes an article successfully", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(Page, { props: { params: {}, form: null, data: { articles: [SAMPLE_ARTICLE] } } });
    expect(screen.getByText("Bagaimana cara berdonasi?")).not.toBeNull();

    const deleteButton = screen.getByRole("button", { name: "Hapus" });
    await fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(screen.queryByText("Bagaimana cara berdonasi?")).toBeNull();
    });
    expect(fetchSpy.mock.calls[0]?.[0]?.toString()).toContain(
      `/admin/help-articles/${SAMPLE_ARTICLE.id}`,
    );
  });

  test("shows error when article deletion fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Failed to delete article" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    render(Page, { props: { params: {}, form: null, data: { articles: [SAMPLE_ARTICLE] } } });
    expect(screen.getByText("Bagaimana cara berdonasi?")).not.toBeNull();

    const deleteButton = screen.getByRole("button", { name: "Hapus" });
    await fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(screen.getByText("Gagal menghapus artikel.")).not.toBeNull();
    });
    expect(screen.getByText("Bagaimana cara berdonasi?")).not.toBeNull();
    expect(fetchSpy).toHaveBeenCalled();
  });
});
