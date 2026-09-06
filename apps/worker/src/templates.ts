import { formatMoney, moneyFromJSON, terbilangRupiah } from "@fundforindonesia/money";

export interface ReceiptData {
  donationId: string;
  amount: { amount: string; currency: "IDR" | "USD" };
  campaignTitle: string;
  displayName: string | null;
  paidAt: string;
  kuitansiUrl: string;
}

export interface RenderedReceipt {
  subject: string;
  html: string;
  text: string;
  whatsapp: string;
}

export function renderDonationReceipt(data: ReceiptData): RenderedReceipt {
  const money = moneyFromJSON(data.amount);
  const figures = formatMoney(money);
  const words = money.currency === "IDR" ? terbilangRupiah(BigInt(data.amount.amount)) : "";
  const donor = data.displayName ?? "Sesama";
  const date = new Date(data.paidAt).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const subject = `Kuitansi Donasi — ${data.campaignTitle}`;

  const html = [
    `<p>Halo ${donor},</p>`,
    `<p>Terima kasih atas donasi sebesar <strong>${figures}</strong> (${words}) untuk <strong>${data.campaignTitle}</strong> pada ${date}.</p>`,
    `<p>Kuitansi resmi Anda: <a href="${data.kuitansiUrl}">${data.kuitansiUrl}</a></p>`,
    "<p>fundforindonesia.org — diselenggarakan di bawah naungan Yayasan Indonesia Emas</p>",
  ].join("\n");

  const text = [
    `Halo ${donor},`,
    "",
    `Terima kasih atas donasi sebesar ${figures} (${words}) untuk ${data.campaignTitle} pada ${date}.`,
    "",
    `Kuitansi resmi Anda: ${data.kuitansiUrl}`,
    "",
    "fundforindonesia.org — Yayasan Indonesia Emas",
  ].join("\n");

  const whatsapp = [
    `Kuitansi donasi ${figures} untuk ${data.campaignTitle} telah terbit.`,
    `Lihat: ${data.kuitansiUrl}`,
  ].join("\n");

  return { subject, html, text, whatsapp };
}
