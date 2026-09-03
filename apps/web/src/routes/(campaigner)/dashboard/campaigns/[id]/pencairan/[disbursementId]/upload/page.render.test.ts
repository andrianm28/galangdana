// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

const goto = vi.fn();
vi.mock("$app/navigation", () => ({ goto: (...args: unknown[]) => goto(...args) }));

beforeEach(() => {
  goto.mockClear();
});

const PARAMS = { id: "c1", disbursementId: "d1" };

function renderPage() {
  return render(Page, {
    props: {
      data: {},
      params: PARAMS,
      form: null,
    },
  });
}

describe("pencairan/upload page", () => {
  test("uploading a file hits presign, then PUT, then confirm, in order and with the right bodies", async () => {
    const calls: string[] = [];
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);

      if (url.includes("/disbursements/d1/proof/presign") && method === "POST") {
        const body = JSON.parse(init?.body as string) as { fileName: string };
        expect(body).toEqual({ fileName: "bukti.pdf" });
        return new Response(
          JSON.stringify({
            uploadUrl: "http://upload.test/proof",
            objectKey: "disbursements/d1/proof/abc.pdf",
            expiresInSeconds: 300,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "http://upload.test/proof" && method === "PUT") {
        expect(init?.body).toBeInstanceOf(File);
        return new Response(null, { status: 200 });
      }
      if (url.includes("/disbursements/d1/proof/confirm") && method === "POST") {
        const body = JSON.parse(init?.body as string) as { objectKey: string };
        expect(body).toEqual({ objectKey: "disbursements/d1/proof/abc.pdf" });
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch call: ${method} ${url}`);
    });

    const { container } = renderPage();

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["proof content"], "bukti.pdf", { type: "application/pdf" });
    await fireEvent.change(fileInput, { target: { files: [file] } });

    await fireEvent.click(screen.getByRole("button", { name: "Unggah" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(calls[0]).toMatch(/^POST .*\/disbursements\/d1\/proof\/presign$/);
    expect(calls[1]).toBe("PUT http://upload.test/proof");
    expect(calls[2]).toMatch(/^POST .*\/disbursements\/d1\/proof\/confirm$/);
    expect(screen.getByText("Berkas berhasil diunggah.")).not.toBeNull();
    fetchSpy.mockRestore();
  });

  test("Lanjutkan is disabled before a successful upload, blocking navigation", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");

    renderPage();

    const proceedButton = screen.getByRole("button", { name: "Lanjutkan" });
    expect(proceedButton).toHaveProperty("disabled", true);

    await fireEvent.click(proceedButton);
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(goto).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test("uploading captures the selected file before the presign await, so reselecting a different file mid-flight doesn't cross-contaminate the PUT", async () => {
    const originalFile = new File(["original content"], "original.pdf", {
      type: "application/pdf",
    });
    const reselectedFile = new File(["reselected content"], "reselected.pdf", {
      type: "application/pdf",
    });

    let resolvePresign!: (value: Response) => void;
    const presignPromise = new Promise<Response>((resolve) => {
      resolvePresign = resolve;
    });

    let putBody: unknown;
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.includes("/disbursements/d1/proof/presign") && method === "POST") {
        return presignPromise;
      }
      if (url === "http://upload.test/proof" && method === "PUT") {
        putBody = init?.body;
        return new Response(null, { status: 200 });
      }
      if (url.includes("/disbursements/d1/proof/confirm") && method === "POST") {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch call: ${method} ${url}`);
    });

    const { container } = renderPage();

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(fileInput, { target: { files: [originalFile] } });
    await fireEvent.click(screen.getByRole("button", { name: "Unggah" }));
    // Let the presign call actually reach the mocked fetch (it stays pending
    // on presignPromise until we resolve it below).
    await new Promise((r) => setTimeout(r, 0));

    // Simulate the user reselecting a different file while presign is in flight.
    await fireEvent.change(fileInput, { target: { files: [reselectedFile] } });

    resolvePresign(
      new Response(
        JSON.stringify({
          uploadUrl: "http://upload.test/proof",
          objectKey: "disbursements/d1/proof/abc.pdf",
          expiresInSeconds: 300,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(putBody).toBe(originalFile);
    expect(putBody).not.toBe(reselectedFile);
    fetchSpy.mockRestore();
  });

  test("navigates to the detail step after a successful upload and clicking Lanjutkan", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.includes("/disbursements/d1/proof/presign") && method === "POST") {
        return new Response(
          JSON.stringify({
            uploadUrl: "http://upload.test/proof",
            objectKey: "disbursements/d1/proof/abc.pdf",
            expiresInSeconds: 300,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "http://upload.test/proof" && method === "PUT") {
        return new Response(null, { status: 200 });
      }
      if (url.includes("/disbursements/d1/proof/confirm") && method === "POST") {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch call: ${method} ${url}`);
    });

    const { container } = renderPage();

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["proof content"], "bukti.pdf", { type: "application/pdf" });
    await fireEvent.change(fileInput, { target: { files: [file] } });
    await fireEvent.click(screen.getByRole("button", { name: "Unggah" }));
    await new Promise((r) => setTimeout(r, 0));

    const proceedButton = screen.getByRole("button", { name: "Lanjutkan" });
    expect(proceedButton).toHaveProperty("disabled", false);
    await fireEvent.click(proceedButton);
    await new Promise((r) => setTimeout(r, 0));

    expect(goto).toHaveBeenCalledWith("/dashboard/campaigns/c1/pencairan/d1/detail");
    fetchSpy.mockRestore();
  });
});
