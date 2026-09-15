// Run with:  node --test shared/     (from functions/)
//
// No test framework: node:test ships with the runtime, and this module has no
// dependencies, so the suite runs anywhere Node does — including in a checkout
// with nothing installed.
import test from "node:test";
import assert from "node:assert/strict";
import {
  LOGIN_EMAIL_DOMAIN,
  normaliseLocalPhone,
  isMobileLocalPhone,
  phoneToLoginEmail,
  isProvisionedLoginEmail,
  toDisplayPhone,
  loginPhoneVariants,
} from "./phone.mjs";

const CANONICAL = "771234567";

test("the four formats the login form and the provisioner must agree on", () => {
  for (const input of ["0771234567", "771234567", "94771234567", "+94771234567"]) {
    assert.equal(normaliseLocalPhone(input), CANONICAL, `${input} should normalise to ${CANONICAL}`);
  }
});

test("the 0094 international form, which neither old implementation accepted", () => {
  assert.equal(normaliseLocalPhone("0094771234567"), CANONICAL);
  assert.equal(normaliseLocalPhone("00 94 77 123 4567"), CANONICAL);
});

test("separators never change the answer", () => {
  const spellings = [
    "077 123 4567",
    "077-123-4567",
    "077.123.4567",
    "(077) 123 4567",
    "+94 77 123 4567",
    "+94-77-123-4567",
    "  0771234567  ",
    "94 (77) 123-4567",
    "077 123 4567",   // non-breaking spaces, as pasted from a web page
    "077–123–4567",   // en dashes, as produced by an autocorrecting editor
  ];
  for (const s of spellings) {
    assert.equal(normaliseLocalPhone(s), CANONICAL, `${JSON.stringify(s)} should normalise to ${CANONICAL}`);
  }
});

test("invalid input returns null rather than a guess", () => {
  const invalid = [
    "",
    "   ",
    null,
    undefined,
    "07712345678",      // one too many
    "12345",            // far too short
    "9412345678901",    // far too long
    "owner@example.com",// a real email address, which login passes through
    "abcdefghi",
    "077-123-456a",     // a typo'd letter
    "+1 555 123 4567",  // not a Sri Lankan number
    "0000",
  ];
  for (const s of invalid) {
    assert.equal(normaliseLocalPhone(s), null, `${JSON.stringify(s)} should be rejected`);
  }
});

test("a bare 9-digit string is taken at face value, as it always was", () => {
  // "077123456" is exactly nine digits, so both old implementations treated it
  // as an already-local number and returned it unchanged rather than reading the
  // leading 0 as a trunk prefix. It is preserved deliberately: changing it would
  // move the login email of any centre registered with such a number. It fails
  // the mobile test below, so registration still rejects it — which is the right
  // outcome by a different route.
  assert.equal(normaliseLocalPhone("077123456"), "077123456");
  assert.equal(isMobileLocalPhone("077123456"), false);
});

test("landlines normalise but are not mobiles", () => {
  // Registration rejects these; existing accounts keyed on one must still resolve.
  assert.equal(normaliseLocalPhone("0112345678"), "112345678");
  assert.equal(isMobileLocalPhone("112345678"), false);
  assert.equal(isMobileLocalPhone(CANONICAL), true);
  assert.equal(isMobileLocalPhone(""), false);
  assert.equal(isMobileLocalPhone(null), false);
});

test("every accepted spelling produces the same login email", () => {
  const expected = `${CANONICAL}@${LOGIN_EMAIL_DOMAIN}`;
  for (const input of [
    "0771234567", "771234567", "94771234567", "+94771234567",
    "0094771234567", "077 123 4567", "077.123.4567", "(077)-123-4567",
  ]) {
    assert.equal(phoneToLoginEmail(input), expected);
  }
  assert.equal(phoneToLoginEmail("not a number"), null);
});

test("provisioned emails are told apart from real ones", () => {
  assert.equal(isProvisionedLoginEmail(`${CANONICAL}@${LOGIN_EMAIL_DOMAIN}`), true);
  assert.equal(isProvisionedLoginEmail(`${CANONICAL}@PitStopIQ.app`), true);
  assert.equal(isProvisionedLoginEmail("owner@example.com"), false);
  assert.equal(isProvisionedLoginEmail(null), false);
  assert.equal(isProvisionedLoginEmail(undefined), false);
});

test("display form is what the owner is told to type", () => {
  assert.equal(toDisplayPhone("+94771234567"), "0771234567");
  assert.equal(toDisplayPhone("771234567"), "0771234567");
  assert.equal(toDisplayPhone("nonsense"), null);
});

test("duplicate-check variants cover the stored spellings", () => {
  const variants = loginPhoneVariants("+94771234567");
  for (const expected of ["771234567", "0771234567", "94771234567", "+94771234567"]) {
    assert.ok(variants.includes(expected), `variants should include ${expected}`);
  }
  // Firestore's `in` operator caps at 30 values.
  assert.ok(variants.length <= 30);
  // No duplicates, so the cap is never wasted.
  assert.equal(variants.length, new Set(variants).size);
  // An unparseable input still matches itself rather than returning nothing.
  assert.deepEqual(loginPhoneVariants("owner@example.com"), ["owner@example.com"]);
});

test("REGRESSION: consolidation changed no previously-valid answer", () => {
  // The two implementations this file replaces, verbatim. Any input either one
  // accepted must still normalise to exactly what it produced then, or a live
  // centre's login email would move underneath them.
  const oldClient = (raw) => {
    const s = String(raw ?? "").trim().replace(/[\s\-().]/g, "").replace(/^\+/, "");
    if (/^94\d{9}$/.test(s)) return s.slice(2);
    if (/^0\d{9}$/.test(s)) return s.slice(1);
    if (/^\d{9}$/.test(s)) return s;
    return null;
  };
  const oldServer = (raw) => {
    const s = String(raw || "").replace(/[\s\-()+]/g, "");
    if (/^94\d{9}$/.test(s)) return s.slice(2);
    if (/^0\d{9}$/.test(s)) return s.slice(1);
    if (/^\d{9}$/.test(s)) return s;
    return null;
  };

  const corpus = [];
  for (const body of ["771234567", "701112223", "112345678", "812345678"]) {
    corpus.push(body, `0${body}`, `94${body}`, `+94${body}`, `0094${body}`);
    corpus.push(`0${body.slice(0, 2)} ${body.slice(2, 5)} ${body.slice(5)}`);
    corpus.push(`0${body.slice(0, 2)}-${body.slice(2, 5)}-${body.slice(5)}`);
    corpus.push(`0${body.slice(0, 2)}.${body.slice(2, 5)}.${body.slice(5)}`);
    corpus.push(`(0${body.slice(0, 2)}) ${body.slice(2)}`);
  }
  corpus.push("", "   ", "owner@example.com", "07712345", "077123456789");

  for (const input of corpus) {
    for (const old of [oldClient, oldServer]) {
      const before = old(input);
      if (before === null) continue; // a newly accepted input is the point of the change
      assert.equal(
        normaliseLocalPhone(input), before,
        `${JSON.stringify(input)} used to normalise to ${before}`,
      );
    }
  }
});
