// ── Portal throttle: pure counter logic ────────────────────────────────────────
//
// checkLoginAccount throttles at 20 calls/hour/IP. That is right for a login
// diagnosis and wrong here: Sri Lankan mobile carriers put many customers
// behind one NAT address, and a customer opening their portal is one legitimate
// call. So the portal does NOT cap by raw request count alone. It caps:
//
//   • MISSES per IP    — lookups that found nothing. That is the enumeration
//                        signal (someone walking ids); a real customer with a
//                        working link never produces one. Tight.
//   • TOTAL per IP     — a generous ceiling against a scraper that already
//                        holds valid ids. Loose enough for a shared NAT.
//   • TOTAL per customer — bounds how often one customer's record can be
//                        pulled, whoever is asking.
//
// Counters are fixed one-hour windows (one small doc per bucket, not an array
// of timestamps). The boundary allows up to 2× in a short burst; that is an
// accepted trade for a doc that never grows.

export const WINDOW_MS = 60 * 60 * 1000;

export const LIMITS = Object.freeze({
  ipTotal: 300,
  ipMisses: 30,
  customerTotal: 120,
});

/** A bucket's counters as stored: { windowStart, total, misses }. */
export function currentWindow(state, now) {
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  if (!state || state.windowStart !== windowStart) return { windowStart, total: 0, misses: 0 };
  return { windowStart, total: state.total | 0, misses: state.misses | 0 };
}

/**
 * Reserve one call in a bucket. `allowed` is false when either cap is already
 * reached, in which case `state` is returned unchanged (a refused call does not
 * extend its own lockout).
 */
export function reserve(state, now, { maxTotal = Infinity, maxMisses = Infinity } = {}) {
  const cur = currentWindow(state, now);
  if (cur.total >= maxTotal || cur.misses >= maxMisses) return { allowed: false, state: cur };
  return { allowed: true, state: { ...cur, total: cur.total + 1 } };
}

/** Count a lookup that found nothing. */
export function recordMiss(state, now) {
  const cur = currentWindow(state, now);
  return { ...cur, misses: cur.misses + 1 };
}
