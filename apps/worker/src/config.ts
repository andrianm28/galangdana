import type { KirimDevConfig, SmtpConfig } from "./transports";

export interface WorkerConfig {
  smtp: SmtpConfig;
  // Null when KIRIMDEV_API_KEY is unset: whatsapp rows stay pending with a
  // config-missing error instead of failing silently or, worse, being
  // marked sent without sending. Same fail-closed posture as the API's
  // payment providers.
  kirimdev: KirimDevConfig | null;
  pollIntervalMs: number;
  maxAttempts: number;
  webOrigin: string;
}

export function workerConfigFromEnv(env: Record<string, string | undefined>): WorkerConfig {
  const smtp: SmtpConfig = {
    host: env.SMTP_HOST ?? "localhost",
    port: Number(env.SMTP_PORT ?? 1025),
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM ?? "donasi@fundforindonesia.org",
  };
  const kirimdev = env.KIRIMDEV_API_KEY
    ? {
        apiKey: env.KIRIMDEV_API_KEY,
        senderId: env.KIRIMDEV_SENDER_ID ?? "",
        baseUrl: env.KIRIMDEV_BASE_URL,
        template: env.KIRIMDEV_TEMPLATE,
        language: env.KIRIMDEV_LANGUAGE,
      }
    : null;
  return {
    smtp,
    kirimdev,
    pollIntervalMs: Number(env.WORKER_POLL_INTERVAL_MS ?? 15000),
    maxAttempts: Number(env.WORKER_MAX_ATTEMPTS ?? 5),
    webOrigin: env.PUBLIC_WEB_URL ?? "http://localhost:5173",
  };
}
