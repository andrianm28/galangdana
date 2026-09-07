// "Sisa hari N" on a campaign card is a stated fact derived from expiresAt at
// render time, not a live countdown -- callers re-render per request, they
// don't tick a timer against this. A program-model campaign has no deadline
// (expiresAt: null), so callers must be able to tell "no deadline" (null)
// apart from "the deadline is today" (0).
export function daysRemaining(expiresAt: string | null): number | null {
  if (expiresAt === null) return null;
  const msRemaining = new Date(expiresAt).getTime() - Date.now();
  const days = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
  // Never negative: a campaign whose deadline has passed reads as "0 hari
  // tersisa", not "-3".
  return Math.max(0, days);
}
