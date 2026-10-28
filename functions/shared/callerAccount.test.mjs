import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { generateTempPassword, validateCallerInput, PASSWORD_ALPHABET, PASSWORD_LENGTH } =
  require("./callerAccount.js");

test("temp password: 12 chars, allowed alphabet only, mixed case with a digit", () => {
  for (let i = 0; i < 500; i++) {
    const pw = generateTempPassword();
    assert.equal(pw.length, PASSWORD_LENGTH);
    assert.ok([...pw].every((c) => PASSWORD_ALPHABET.includes(c)), pw);
    assert.match(pw, /[A-Z]/);
    assert.match(pw, /[a-z]/);
    assert.match(pw, /[2-9]/);
  }
});

test("temp password: never repeats and never contains look-alike characters", () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(generateTempPassword());
  assert.equal(seen.size, 1000);
  for (const pw of seen) assert.doesNotMatch(pw, /[0O1lI]/);
});

test("validate: normalises a good payload", () => {
  const r = validateCallerInput({ name: "  Kasun  ", email: " Kasun@Example.COM ", phone: " 077 123 4567 " }, "pitstopiq.app");
  assert.deepEqual(r, { ok: true, value: { name: "Kasun", email: "kasun@example.com", phone: "077 123 4567" } });
});

test("validate: rejects blanks, bad emails, bad phones and the reserved login domain", () => {
  const good = { name: "K", email: "k@example.com", phone: "0771234567" };
  for (const bad of [
    {}, null, { ...good, name: "  " }, { ...good, email: "" }, { ...good, phone: "" },
    { ...good, email: "not-an-email" }, { ...good, email: "a b@example.com" },
    { ...good, phone: "12345" }, { ...good, phone: "1".repeat(16) },
    { ...good, email: "0771234567@pitstopiq.app" }, { ...good, email: "x@PitStopIQ.app" },
    { ...good, name: 5 },
  ]) {
    assert.equal(validateCallerInput(bad, "pitstopiq.app").ok, false, JSON.stringify(bad));
  }
});
