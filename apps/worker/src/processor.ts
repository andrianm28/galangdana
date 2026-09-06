import { campaigns, db, donations, notificationsOutbox } from "@fundforindonesia/db";
import { formatMoney, moneyFromJSON } from "@fundforindonesia/money";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { renderDonationReceipt } from "./templates";

export interface Transports {
  sendEmail(to: string, subject: string, html: string, text: string): Promise<void>;
  sendWhatsapp(to: string, facts: WhatsappFacts): Promise<void>;
}

export interface WhatsappFacts {
  amount: string;
  campaignTitle: string;
  kuitansiUrl: string;
}

export interface ProcessorConfig {
  maxAttempts: number;
  webOrigin?: string;
}

export interface ProcessSummary {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  deferred: number;
}

// Thrown by a transport when its vendor is not configured at all (missing
// API key, not a failed send). The processor defers the row instead of
// counting an attempt: retrying a certain failure would burn the attempt
// budget and lose receipts that are perfectly sendable once configured.
export class TransportNotConfiguredError extends Error {}

// How long a not-configured row waits before the worker looks at it again.
// Long enough to stay out of the way, short enough to pick up promptly
// once the config lands (no restart needed).
const DEFER_WITHOUT_CONFIG_MS = 30 * 60 * 1000;

// 1m, 2m, 4m, ... capped at 1h. A failed receipt is retried, not dropped,
// until attempts runs out -- a lost kuitansi is a trust failure, not a log line.
function backoffDelayMs(attempts: number): number {
  return Math.min(60_000 * 2 ** (attempts - 1), 3_600_000);
}

export async function processDueRows(
  transports: Transports,
  config: ProcessorConfig,
  now: Date = new Date(),
): Promise<ProcessSummary> {
  const webOrigin = config.webOrigin ?? process.env.PUBLIC_WEB_URL ?? "http://localhost:5173";
  const summary: ProcessSummary = { processed: 0, sent: 0, failed: 0, skipped: 0, deferred: 0 };

  const due = await db
    .select()
    .from(notificationsOutbox)
    .where(
      and(
        eq(notificationsOutbox.status, "pending"),
        or(isNull(notificationsOutbox.nextAttemptAt), lte(notificationsOutbox.nextAttemptAt, now)),
      ),
    )
    .orderBy(notificationsOutbox.createdAt)
    .limit(50);

  for (const row of due) {
    summary.processed++;
    // Claim the row so two workers can never send it twice. The guarded
    // UPDATE is the claim -- zero rows back means someone else took it.
    const [claimed] = await db
      .update(notificationsOutbox)
      .set({ status: "sending" })
      .where(and(eq(notificationsOutbox.id, row.id), eq(notificationsOutbox.status, "pending")))
      .returning();
    if (!claimed) continue;

    const fail = async (reason: string) => {
      const attempts = (claimed.attempts ?? 0) + 1;
      if (attempts >= config.maxAttempts) {
        await db
          .update(notificationsOutbox)
          .set({ status: "failed", attempts, lastError: reason })
          .where(eq(notificationsOutbox.id, row.id));
        summary.failed++;
      } else {
        await db
          .update(notificationsOutbox)
          .set({
            status: "pending",
            attempts,
            lastError: reason,
            nextAttemptAt: new Date(now.getTime() + backoffDelayMs(attempts)),
          })
          .where(eq(notificationsOutbox.id, row.id));
      }
    };

    try {
      const payload = row.payload as { donationId?: unknown; contactValue?: unknown };
      const donationId = typeof payload.donationId === "string" ? payload.donationId : null;
      const [found] = donationId
        ? await db
            .select({ donation: donations, campaignTitle: campaigns.title })
            .from(donations)
            .innerJoin(campaigns, eq(campaigns.id, donations.campaignId))
            .where(eq(donations.id, donationId))
        : [];
      if (!found) {
        await db
          .update(notificationsOutbox)
          .set({ status: "skipped", lastError: "donation not found" })
          .where(eq(notificationsOutbox.id, row.id));
        summary.skipped++;
        continue;
      }
      const dest =
        typeof payload.contactValue === "string" && payload.contactValue
          ? payload.contactValue
          : found.donation.contactValue;
      if (!dest) {
        await fail("no destination contact");
        continue;
      }
      const figures = formatMoney(
        moneyFromJSON({
          amount: found.donation.amount.toString(),
          currency: found.donation.currency,
        }),
      );
      const rendered = renderDonationReceipt({
        donationId: found.donation.id,
        amount: { amount: found.donation.amount.toString(), currency: found.donation.currency },
        campaignTitle: found.campaignTitle,
        displayName: found.donation.displayName,
        paidAt: (found.donation.paidAt ?? found.donation.createdAt).toISOString(),
        kuitansiUrl: `${webOrigin}/donation/${found.donation.id}/kuitansi`,
      });
      if (row.channel === "email") {
        await transports.sendEmail(dest, rendered.subject, rendered.html, rendered.text);
      } else if (row.channel === "whatsapp") {
        await transports.sendWhatsapp(dest, {
          amount: figures,
          campaignTitle: found.campaignTitle,
          kuitansiUrl: `${webOrigin}/donation/${found.donation.id}/kuitansi`,
        });
      } else {
        await fail(`unknown channel: ${row.channel}`);
        continue;
      }
      await db
        .update(notificationsOutbox)
        .set({ status: "sent", sentAt: now })
        .where(eq(notificationsOutbox.id, row.id));
      summary.sent++;
    } catch (err) {
      if (err instanceof TransportNotConfiguredError) {
        await db
          .update(notificationsOutbox)
          .set({
            status: "pending",
            lastError: err.message,
            nextAttemptAt: new Date(now.getTime() + DEFER_WITHOUT_CONFIG_MS),
          })
          .where(eq(notificationsOutbox.id, row.id));
        summary.deferred++;
        continue;
      }
      await fail(err instanceof Error ? err.message : String(err));
    }
  }

  return summary;
}
