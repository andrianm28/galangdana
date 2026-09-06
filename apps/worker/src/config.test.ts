import { describe, expect, test } from "bun:test";
import { workerConfigFromEnv } from "./config";

describe("workerConfigFromEnv", () => {
  test("reads smtp, kirim.dev, and loop settings with sane dev defaults", () => {
    const config = workerConfigFromEnv({
      SMTP_HOST: "mail.example.test",
      SMTP_PORT: "465",
      SMTP_USER: "u",
      SMTP_PASS: "p",
      SMTP_FROM: "donasi@example.test",
      KIRIMDEV_API_KEY: "k",
      KIRIMDEV_SENDER_ID: "s",
      PUBLIC_WEB_URL: "https://example.test",
      WORKER_POLL_INTERVAL_MS: "5000",
      WORKER_MAX_ATTEMPTS: "3",
    });
    expect(config.smtp).toEqual({
      host: "mail.example.test",
      port: 465,
      user: "u",
      pass: "p",
      from: "donasi@example.test",
    });
    expect(config.kirimdev).toEqual({
      apiKey: "k",
      senderId: "s",
      baseUrl: undefined,
      template: undefined,
      language: undefined,
    });
    expect(config.pollIntervalMs).toBe(5000);
    expect(config.maxAttempts).toBe(3);
    expect(config.webOrigin).toBe("https://example.test");
  });

  test("dev defaults point at Mailpit with no auth", () => {
    const config = workerConfigFromEnv({});
    expect(config.smtp).toEqual({
      host: "localhost",
      port: 1025,
      user: undefined,
      pass: undefined,
      from: "donasi@fundforindonesia.org",
    });
    expect(config.kirimdev).toBeNull();
    expect(config.pollIntervalMs).toBe(15000);
    expect(config.maxAttempts).toBe(5);
  });
});
