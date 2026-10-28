// Run with: npm test   (node --test, TypeScript stripped natively by Node)
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCallerHandoverMessage } from "./callerHandover.ts";

const args = { name: "Kasun Perera", email: "kasun@example.com", tempPassword: "Ab3dEf7hJk9m", loginUrl: "https://x.test/caller/login" };

test("handover message greets by first name and carries the login details", () => {
  const msg = buildCallerHandoverMessage(args);
  assert.ok(msg.startsWith("Hello Kasun,"));
  for (const part of [args.email, args.tempPassword, args.loginUrl]) assert.ok(msg.includes(part), part);
});

test("handover message is plain text — no markup around the password", () => {
  const msg = buildCallerHandoverMessage(args);
  assert.ok(!/[*_`]/.test(msg.replace(args.tempPassword, "")));
});

test("a blank name still reads sensibly", () => {
  assert.ok(buildCallerHandoverMessage({ ...args, name: "  " }).startsWith("Hello there,"));
});
