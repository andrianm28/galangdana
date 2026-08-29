export type Currency = "IDR" | "USD";

export interface Money {
  readonly amount: bigint;
  readonly currency: Currency;
}

/**
 * Constructs a Money value. IDR is a minor-unitless integer (no cents, as
 * used throughout Kitabisa-style Indonesian donation platforms). USD is
 * stored in integer cents. Callers choose the right unit at the call site;
 * this function does not convert between them.
 */
export function money(amount: bigint | number, currency: Currency): Money {
  const normalized = typeof amount === "bigint" ? amount : BigInt(Math.trunc(amount));
  return { amount: normalized, currency };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`currency mismatch: cannot add ${a.currency} and ${b.currency}`);
  }
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function subtractMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`currency mismatch: cannot subtract ${b.currency} from ${a.currency}`);
  }
  return { amount: a.amount - b.amount, currency: a.currency };
}

const RUPIAH_FORMATTER = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/**
 * Renders a Money value for display. IDR has no minor unit, so the amount
 * is grouped as-is with a "Rp" prefix. USD is stored in cents, so it is
 * divided by 100 before formatting.
 */
export function formatMoney(m: Money): string {
  if (m.currency === "IDR") {
    return `Rp${RUPIAH_FORMATTER.format(m.amount)}`;
  }
  // USD cents -> dollars. Safe to convert to Number here only for display;
  // amounts beyond Number.MAX_SAFE_INTEGER cents (~$92 quadrillion) are not
  // a real-world concern for this platform.
  return USD_FORMATTER.format(Number(m.amount) / 100);
}

export interface MoneyJSON {
  amount: string;
  currency: Currency;
}

export function moneyToJSON(m: Money): MoneyJSON {
  return { amount: m.amount.toString(), currency: m.currency };
}

export function moneyFromJSON(json: MoneyJSON): Money {
  return { amount: BigInt(json.amount), currency: json.currency };
}
