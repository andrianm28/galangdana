import { workerConfigFromEnv } from "./config";
import { TransportNotConfiguredError, type Transports, processDueRows } from "./processor";
import { sendMailSmtp, sendWhatsappKirimDev } from "./transports";

const config = workerConfigFromEnv(process.env as Record<string, string | undefined>);

const transports: Transports = {
  sendEmail: (to, subject, html, text) => sendMailSmtp(config.smtp, { to, subject, html, text }),
  sendWhatsapp: (to, facts) => {
    if (!config.kirimdev) {
      throw new TransportNotConfiguredError("KIRIMDEV_API_KEY is not configured");
    }
    return sendWhatsappKirimDev(config.kirimdev, { to, ...facts });
  },
};

async function tick(): Promise<void> {
  const summary = await processDueRows(transports, {
    maxAttempts: config.maxAttempts,
    webOrigin: config.webOrigin,
  });
  if (summary.processed > 0) console.log(`[worker] ${JSON.stringify(summary)}`);
}

if (process.argv.includes("--once")) {
  await tick();
  process.exit(0);
} else {
  console.log(`[worker] polling every ${config.pollIntervalMs}ms (Ctrl-C to stop)`);
  setInterval(() => {
    tick().catch((err) => console.error("[worker] tick failed:", err));
  }, config.pollIntervalMs);
}
