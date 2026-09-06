/**
 * Spells a rupiah amount out in Indonesian words -- "terbilang".
 *
 * Indonesian receipts and kuitansi print the amount twice: once in figures
 * and once in words. The words are not decoration; they are the anti-tampering
 * device. A digit can be altered with a pen stroke, a sentence cannot.
 *
 * IDR only. USD is stored in cents (see `money.ts`), and a cents-aware
 * spelling is a different function with a different grammar -- not something
 * to bolt on with a flag.
 */

const UNITS = [
  "",
  "satu",
  "dua",
  "tiga",
  "empat",
  "lima",
  "enam",
  "tujuh",
  "delapan",
  "sembilan",
  "sepuluh",
  "sebelas",
] as const;

// Indonesian names each thousands group. Beyond a quadrillion the language
// keeps going, but a donation that large is a data-entry error, not a gift --
// so the caller gets a thrown error instead of a silently wrong receipt.
const SCALES = ["", "ribu", "juta", "miliar", "triliun"] as const;
const MAX_SUPPORTED = 1_000_000_000_000_000n; // 1 kuadriliun

/** Spells 0..999. Returns "" for 0 so groups of zero can be dropped upstream. */
function spellGroup(n: number): string {
  if (n === 0) return "";
  if (n < 12) return UNITS[n] as string;
  if (n < 20) return `${UNITS[n - 10]} belas`;
  if (n < 100) {
    const tens = `${UNITS[Math.floor(n / 10)]} puluh`;
    const rest = n % 10;
    return rest === 0 ? tens : `${tens} ${UNITS[rest]}`;
  }
  // "seratus", not "satu ratus" -- the same contraction as "sebelas" and
  // "sepuluh". Indonesian uses it for a leading one at every scale.
  const hundreds = n < 200 ? "seratus" : `${UNITS[Math.floor(n / 100)]} ratus`;
  const rest = n % 100;
  return rest === 0 ? hundreds : `${hundreds} ${spellGroup(rest)}`;
}

/**
 * @param amount rupiah, minor-unitless (see `money.ts`). Must be >= 0.
 * @returns the amount in lowercase Indonesian words, without "rupiah".
 * @throws if negative, or at or beyond one kuadriliun.
 */
export function terbilang(amount: bigint): string {
  if (amount < 0n) {
    throw new Error("terbilang: negative amounts have no receipt meaning");
  }
  if (amount >= MAX_SUPPORTED) {
    throw new Error(`terbilang: amount beyond supported range (max ${MAX_SUPPORTED - 1n})`);
  }
  if (amount === 0n) return "nol";

  // Split into thousands groups, least significant first.
  const groups: number[] = [];
  let rest = amount;
  while (rest > 0n) {
    groups.push(Number(rest % 1000n));
    rest /= 1000n;
  }

  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i] as number;
    if (group === 0) continue;
    // "seribu", never "satu ribu". The contraction applies only to the
    // thousands scale -- "satu juta" and "satu miliar" stay uncontracted.
    const words = group === 1 && i === 1 ? "seribu" : `${spellGroup(group)} ${SCALES[i]}`;
    parts.push(words.trim());
  }
  return parts.join(" ");
}

/** `terbilang` with the currency word and the conventional closing. */
export function terbilangRupiah(amount: bigint): string {
  return `${terbilang(amount)} rupiah`;
}
