// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

const goto = vi.fn();
vi.mock("$app/navigation", () => ({ goto: (...args: unknown[]) => goto(...args) }));

const REVISIONS = [
  {
    id: "r1",
    field: "cerita",
    note: "Cerita terlalu singkat, tambahkan detail.",
    status: "open",
    createdAt: "2026-09-02T00:00:00.000Z",
    resolvedAt: null,
  },
];

describe("campaigner revision-fix page", () => {
  test("shows each open revision request with the moderator's note", () => {
    render(Page, {
      props: { data: { campaignId: "c1", revisions: REVISIONS }, params: { id: "c1" }, form: null },
    });
    expect(screen.getByText("Cerita terlalu singkat, tambahkan detail.")).not.toBeNull();
  });

  test("saving a fixed story calls the story endpoint", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(Page, {
      props: { data: { campaignId: "c1", revisions: REVISIONS }, params: { id: "c1" }, form: null },
    });
    await fireEvent.input(screen.getByLabelText("Cerita baru"), {
      target: { value: "Cerita yang sudah lebih lengkap dan jelas." },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Simpan Cerita" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test("clicking Ajukan Ulang resubmits and navigates to the dashboard", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "pending_review" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(Page, {
      props: { data: { campaignId: "c1", revisions: REVISIONS }, params: { id: "c1" }, form: null },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Ajukan Ulang" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchSpy).toHaveBeenCalled();
    expect(goto).toHaveBeenCalledWith("/dashboard/campaigns");
    fetchSpy.mockRestore();
  });

  test("uploading two different documents submits each with its own file, not swapped", async () => {
    const uploadedBodies: Record<string, unknown> = {};
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.includes("/documents/presign") && method === "POST") {
        const body = JSON.parse(init?.body as string) as { documentType: string };
        return new Response(
          JSON.stringify({
            uploadUrl: `http://upload.test/${body.documentType}`,
            objectKey: `key-${body.documentType}`,
            expiresInSeconds: 300,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.startsWith("http://upload.test/") && method === "PUT") {
        const documentType = url.replace("http://upload.test/", "");
        uploadedBodies[documentType] = init?.body;
        return new Response(null, { status: 200 });
      }
      if (url.includes("/documents/confirm") && method === "POST") {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch call: ${method} ${url}`);
    });

    const documentRevisions = [
      {
        id: "r1",
        field: "kartu_mahasiswa",
        note: "Unggah ulang kartu mahasiswa yang jelas.",
        status: "open",
        createdAt: "2026-09-02T00:00:00.000Z",
        resolvedAt: null,
      },
      {
        id: "r2",
        field: "kartu_pelajar",
        note: "Unggah ulang kartu pelajar yang jelas.",
        status: "open",
        createdAt: "2026-09-02T00:00:00.000Z",
        resolvedAt: null,
      },
    ];

    const { container } = render(Page, {
      props: {
        data: { campaignId: "c1", revisions: documentRevisions },
        params: { id: "c1" },
        form: null,
      },
    });

    const fileInputs = container.querySelectorAll<HTMLInputElement>('input[type="file"]');
    expect(fileInputs.length).toBe(2);

    const kartuMahasiswaFile = new File(["a"], "kartu-mahasiswa.jpg", { type: "image/jpeg" });
    const kartuPelajarFile = new File(["b"], "kartu-pelajar.jpg", { type: "image/jpeg" });

    await fireEvent.change(fileInputs[0] as HTMLInputElement, {
      target: { files: [kartuMahasiswaFile] },
    });
    await fireEvent.change(fileInputs[1] as HTMLInputElement, {
      target: { files: [kartuPelajarFile] },
    });

    const uploadButtons = screen.getAllByRole("button", { name: "Unggah" });
    await fireEvent.click(uploadButtons[0] as HTMLElement);
    await new Promise((r) => setTimeout(r, 0));
    await fireEvent.click(uploadButtons[1] as HTMLElement);
    await new Promise((r) => setTimeout(r, 0));

    expect(uploadedBodies.kartu_mahasiswa).toBe(kartuMahasiswaFile);
    expect(uploadedBodies.kartu_pelajar).toBe(kartuPelajarFile);
    fetchSpy.mockRestore();
  });
});
