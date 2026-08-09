// Sri Lankan phone helpers shared by the login form and anything else that has
// to turn a typed phone number into the internal login email.
//
// These rules must stay identical to `normalisePhone` in functions/index.js:
// the Cloud Function derives the owner's login email at registration time, and
// the login form has to derive the exact same string from whatever the owner
// types, or their credentials can never match the account that was created for
// them.

export const LOGIN_EMAIL_DOMAIN = "pitstopiq.app";

/**
 * Reduce a Sri Lankan number to its canonical 9-digit local form
 * (0771234567 / +94771234567 / 94771234567 / 771234567 → "771234567").
 * Returns null when the input isn't a local number at all — an email address,
 * for instance, which the login form must pass through untouched.
 *
 * Separators people (and phone autofill) add — spaces, dashes, dots, brackets,
 * a leading "+" — are stripped first so formatting alone can never make a
 * valid number fail to match.
 */
export function normaliseLocalPhone(raw: string): string | null {
  const s = String(raw ?? "").trim().replace(/[\s\-().]/g, "").replace(/^\+/, "");
  if (/^94\d{9}$/.test(s)) return s.slice(2);
  if (/^0\d{9}$/.test(s)) return s.slice(1);
  if (/^\d{9}$/.test(s)) return s;
  return null;
}

/** True for a mobile number — the only kind that can receive the credentials SMS. */
export function isMobileLocalPhone(local: string): boolean {
  return /^7\d{8}$/.test(local);
}

/**
 * The internal login email for a phone-based account, or null if the input
 * isn't a phone number. Note this deliberately accepts non-mobile numbers:
 * registrations made before mobile numbers were enforced produced accounts
 * keyed on landline numbers, and those owners still have to be able to sign in.
 */
export function phoneToLoginEmail(raw: string): string | null {
  const local = normaliseLocalPhone(raw);
  return local ? `${local}@${LOGIN_EMAIL_DOMAIN}` : null;
}

/**
 * True for the synthetic emails minted from a phone number — i.e. accounts
 * provisioned by the super admin or by an owner adding staff, as opposed to a
 * self-service sign-up with a real email address. Such a user can never
 * complete registration themselves (their number is already taken), so a
 * missing profile is a support issue for them, not a "finish onboarding" nudge.
 */
export function isProvisionedLoginEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.toLowerCase().endsWith(`@${LOGIN_EMAIL_DOMAIN}`);
}
