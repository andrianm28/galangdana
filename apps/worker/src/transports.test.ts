import { describe, expect, test } from "bun:test";
import { sendMailSmtp, sendWhatsappKirimDev } from "./transports";

describe("sendMailSmtp", () => {
  test("delivers a real message to Mailpit with subject and bodies intact", async () => {
    const to = `worker-${Date.now()}@example.test`;
    await sendMailSmtp(
      { host: "localhost", port: 1025, from: "donasi@fundforindonesia.org" },
      { to, subject: "Kuitansi Test", html: "<b>Rp50.000</b>", text: "Rp50.000" },
    );
    const res = await fetch(`http://localhost:8025/api/v1/search?query=${encodeURIComponent(to)}`);
    const data = (await res.json()) as {
      total: number;
      messages: { ID: string; Subject: string }[];
    };
    expect(data.total).toBeGreaterThan(0);
    const msg = data.messages[0];
    if (!msg) throw new Error("mailpit returned no message");
    expect(msg.Subject).toBe("Kuitansi Test");
    await fetch(`http://localhost:8025/api/v1/message/${msg.ID}`, { method: "DELETE" });
  });
});

describe("sendWhatsappKirimDev", () => {
  test("posts a template message with bearer auth and +62-normalized destination", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    await sendWhatsappKirimDev(
      { apiKey: "test-key", senderId: "sender-1", fetchImpl },
      {
        to: "+62819000099",
        amount: "Rp50.000",
        campaignTitle: "Banjir",
        kuitansiUrl: "https://x.test/k",
      },
    );
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe("https://api.kirim.dev/v23.0/sender-1/messages");
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-key",
    );
    const body = JSON.parse(calls[0]?.init.body as string) as {
      to: string;
      type: string;
      template: { name: string; components: { parameters: { text: string }[] }[] };
    };
    expect(body.to).toBe("62819000099");
    expect(body.type).toBe("template");
    const params = body.template.components[0]?.parameters.map((p) => p.text) ?? [];
    expect(params.join(" ")).toContain("Rp50.000");
  });
  test("throws on a non-ok response", async () => {
    const fetchImpl = (async () =>
      new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;
    await expect(
      sendWhatsappKirimDev(
        { apiKey: "bad", senderId: "s", fetchImpl },
        { to: "6281", amount: "x", campaignTitle: "y", kuitansiUrl: "z" },
      ),
    ).rejects.toThrow();
  });
});
