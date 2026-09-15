// ── Sri Lankan phone numbers: the single source of truth ───────────────────────
//
// An owner's login email is derived from their phone number. The Cloud Function
// derives it when the account is provisioned; the login form derives it again
// from whatever the owner types months later. If those two derivations ever
// disagree by a single character, the owner authenticates against an email that
// does not exist and gets "no account for this number" for a number that is
// unmistakably theirs.
//
// This file used to be two files — `normaliseLocalPhone` in src/lib/phone.ts and
// `normalisePhone` in functions/index.js — and they had already drifted three
// ways: the client stripped "." and the server did not, the server stripped a
// "+" anywhere and the client only a leading one, and neither accepted the
// "0094…" form at all. None of those gaps bit the four common formats, but the
// arrangement guaranteed a fourth divergence eventually.
//
// So: one implementation, imported by the app, by index.js and by every script.
//
// It lives under functions/ because firebase.json deploys `functions` as its own
// package — a file above that directory is simply not uploaded. It is .mjs so
// that index.js (CommonJS) can require() it directly: Node has supported
// require() of an ES module since 22.12, and the functions runtime is Node 24.
// The app imports it as an ordinary ES module; functions/shared/phone.d.mts
// carries the types.
//
// ── Compatibility ──────────────────────────────────────────────────────────────
// Every input that was valid under EITHER old implementation still normalises to
// exactly the same string. The rules below are a strict superset, so no existing
// centre's login email can change as a result of this consolidation. That
// property is what makes this safe to ship to ten live centres, and
// phone.test.mjs locks it in.

/** The domain half of the synthetic emails minted from a phone number. */
export const LOGIN_EMAIL_DOMAIN = "pitstopiq.app";

/**
 * Characters people, printers and phone autofill put inside a number, none of
 * which carry meaning: spaces (including non-breaking), the various dashes,
 * dots, brackets and a plus.
 */
const SEPARATORS = /[\s ‐-―\-().+]/g;

/**
 * Reduce a Sri Lankan number to its canonical 9-digit local form.
 *
 *   0771234567      → "771234567"
 *   771234567       → "771234567"
 *   94771234567     → "771234567"
 *   +94771234567    → "771234567"
 *   0094771234567   → "771234567"
 *   077-123 4567    → "771234567"
 *
 * Returns null when the input is not a local number at all — an email address,
 * for instance, which the login form must pass through untouched, or a string
 * of the wrong length, which is a typo worth reporting rather than guessing at.
 *
 * Order matters below: the 0094 and 94 forms are tested before the single
 * leading zero, so a 13- or 11-digit international number is never mistaken for
 * a 10-digit local one. The lengths are mutually exclusive, so this is belt and
 * braces rather than a live hazard.
 */
export function normaliseLocalPhone(raw) {
  const s = String(raw ?? "").trim().replace(SEPARATORS, "");
  // Anything that still isn't all digits is not a phone number — an email
  // address, a name, a pasted URL. Bail before the length tests so those can
  // stay simple.
  if (!/^\d+$/.test(s)) return null;
  if (/^0094\d{9}$/.test(s)) return s.slice(4);
  if (/^94\d{9}$/.test(s)) return s.slice(2);
  if (/^0\d{9}$/.test(s)) return s.slice(1);
  if (/^\d{9}$/.test(s)) return s;
  return null;
}

/**
 * True for a mobile number — the only kind that can receive the credentials SMS,
 * and so the only kind a new registration is allowed to use.
 */
export function isMobileLocalPhone(local) {
  return /^7\d{8}$/.test(String(local ?? ""));
}

/**
 * The internal login email for a phone-based account, or null if the input is
 * not a phone number.
 *
 * Deliberately accepts non-mobile numbers: registrations made before mobile
 * numbers were enforced produced accounts keyed on landline numbers, and those
 * owners still have to be able to sign in.
 */
export function phoneToLoginEmail(raw) {
  const local = normaliseLocalPhone(raw);
  return local ? `${local}@${LOGIN_EMAIL_DOMAIN}` : null;
}

/**
 * True for the synthetic emails minted from a phone number — i.e. accounts
 * provisioned by the super admin or by an owner adding staff, as opposed to a
 * self-service sign-up with a real email address. Such a user can never complete
 * registration themselves (their number is already taken), so a missing profile
 * is a support issue for them, not a "finish onboarding" nudge.
 */
export function isProvisionedLoginEmail(email) {
  return typeof email === "string" && email.toLowerCase().endsWith(`@${LOGIN_EMAIL_DOMAIN}`);
}

/**
 * The number as the owner should be told to type it, and as it is written on
 * the SMS and the WhatsApp handover message: the familiar local 0-prefixed form.
 */
export function toDisplayPhone(raw) {
  const local = normaliseLocalPhone(raw);
  return local ? `0${local}` : null;
}

/**
 * Every spelling of a number that might already be stored on a `servicecenters`
 * document, for the duplicate checks in registerServiceCenter and the audit
 * script.
 *
 * Historic documents hold whatever the super admin typed at the time, so an
 * equality search has to cover the variants rather than assume normalisation.
 * `raw` is included first so a format not generated here (a spaced or dotted
 * one) still matches itself. Firestore's `in` operator takes at most 30 values;
 * this returns at most 5.
 */
export function loginPhoneVariants(raw) {
  const local = normaliseLocalPhone(raw);
  if (!local) return [String(raw ?? "")];
  const variants = [String(raw ?? ""), local, `0${local}`, `94${local}`, `+94${local}`];
  return [...new Set(variants)];
}
