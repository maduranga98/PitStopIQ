// Pure helpers for createCallerAccount, kept apart from index.js so they can be
// unit-tested without the Admin SDK or the emulators.

const crypto = require("crypto");

// No 0/O, 1/l/I: the super admin reads this out or pastes it into a message,
// and a caller typing it from a screenshot should not have to guess.
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const PASSWORD_LENGTH = 12;

/**
 * A random 12-character password with at least one upper-case letter, one
 * lower-case letter and one digit. Uses crypto.randomInt, not Math.random.
 */
function generateTempPassword() {
  for (;;) {
    let pw = "";
    for (let i = 0; i < PASSWORD_LENGTH; i++) {
      pw += PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)];
    }
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[2-9]/.test(pw)) return pw;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate and normalise the createCallerAccount payload.
 *
 * `reservedEmailDomain` is the phone-login domain (shared/phone.mjs): a caller
 * registered at `0771234567@<that domain>` would squat a service-center
 * owner's login, so it is refused.
 *
 * Returns `{ ok: true, value }` or `{ ok: false, error }`.
 */
function validateCallerInput(data, reservedEmailDomain) {
  const name = typeof data?.name === "string" ? data.name.trim() : "";
  const email = typeof data?.email === "string" ? data.email.trim().toLowerCase() : "";
  const phone = typeof data?.phone === "string" ? data.phone.trim() : "";

  if (!name || !email || !phone) {
    return { ok: false, error: "Name, email and phone are required." };
  }
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: `"${email}" is not a valid email address.` };
  }
  if (reservedEmailDomain && email.endsWith(`@${reservedEmailDomain.toLowerCase()}`)) {
    return { ok: false, error: `Use a real email address — @${reservedEmailDomain} is reserved for service-center logins.` };
  }
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15) {
    return { ok: false, error: `Phone "${phone}" is not a valid number.` };
  }
  return { ok: true, value: { name, email, phone } };
}

module.exports = { generateTempPassword, validateCallerInput, PASSWORD_ALPHABET, PASSWORD_LENGTH };
