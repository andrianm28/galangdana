import nodemailer from "nodemailer";

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// One transporter per send: this worker's volume is a trickle (one poll per
// 15s, small batches), and a fresh transporter keeps the function pure and
// the tests honest -- no shared connection state to reset between runs.
export async function sendMailSmtp(config: SmtpConfig, message: MailMessage): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // Port 465 means implicit TLS (Sumopod, Gmail); anything else (587
    // STARTTLS, 1025 Mailpit plaintext) negotiates or skips accordingly.
    secure: config.port === 465,
    ...(config.user ? { auth: { user: config.user, pass: config.pass ?? "" } } : {}),
  });
  await transporter.sendMail({
    from: config.from,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });
}

export interface KirimDevConfig {
  apiKey: string;
  senderId: string;
  baseUrl?: string;
  template?: string;
  language?: string;
  fetchImpl?: typeof fetch;
}

export interface WhatsappReceipt {
  to: string;
  amount: string;
  campaignTitle: string;
  kuitansiUrl: string;
}

// Receipts are business-initiated messages, often outside WhatsApp's 24h
// customer-service window -- plain text would be rejected there. Templates
// are the only reliably deliverable shape, so this sends a template with
// the receipt facts as body parameters. The template itself (name +
// language below) must exist and be Meta-approved in the kirim.dev
// dashboard before the first real send -- see .env.example.
export async function sendWhatsappKirimDev(
  config: KirimDevConfig,
  receipt: WhatsappReceipt,
): Promise<void> {
  const baseUrl = config.baseUrl ?? "https://api.kirim.dev";
  const res = await (config.fetchImpl ?? fetch)(`${baseUrl}/v23.0/${config.senderId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: receipt.to.replace(/^\+/, ""),
      type: "template",
      template: {
        name: config.template ?? "donation_receipt",
        language: { code: config.language ?? "id" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: receipt.amount },
              { type: "text", text: receipt.campaignTitle },
              { type: "text", text: receipt.kuitansiUrl },
            ],
          },
        ],
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`kirim.dev send failed: ${res.status} ${await res.text()}`);
  }
}
