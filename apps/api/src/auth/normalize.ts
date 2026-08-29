const INDONESIAN_MOBILE_RE = /^8\d{7,12}$/;

/**
 * Normalizes an Indonesian phone number to a single canonical E.164 form
 * (+62...), accepting the common respellings users actually type: leading
 * 0, leading 62, leading +62, and stray spaces/dashes. Returns null for
 * anything that doesn't reduce to a plausible Indonesian mobile number
 * (starts with 8, 8-13 digits total) -- callers reject rather than
 * silently accept an unnormalizable input.
 *
 * Centralizing this in one place (called from requestOtp AND verifyOtp,
 * before any rate-limit check or DB access) is the fix for a real bug the
 * final whole-branch review found: "+6281100777001", "081100777001",
 * "6281100777001", and "+62 81100777001" were four independent rate-limit
 * keys and would have become four independent `users` rows, all for one
 * real handset.
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim().replace(/[\s-]/g, "");
  let digits: string;
  if (trimmed.startsWith("+62")) {
    digits = trimmed.slice(3);
  } else if (trimmed.startsWith("62")) {
    digits = trimmed.slice(2);
  } else if (trimmed.startsWith("0")) {
    digits = trimmed.slice(1);
  } else {
    digits = trimmed;
  }
  if (!INDONESIAN_MOBILE_RE.test(digits)) return null;
  return `+62${digits}`;
}

/**
 * Email identity is case-insensitive everywhere in this module: register,
 * login, and Google-linking all normalize before touching the DB, so
 * "Case.Probe@example.test" and "case.probe@example.test" are the same
 * account rather than two (the final whole-branch review proved both
 * register as separate accounts today, and that a mixed-case local
 * account then fails to link with Google's lowercased assertion).
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
