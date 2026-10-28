// Run with: npm test   (node --test, TypeScript stripped natively by Node)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CallerAuthError, callerLoginErrorMessage, DEACTIVATED_MESSAGE, NOT_A_CALLER_MESSAGE,
} from "./callerAuth.ts";

test("wrong credentials of every flavour read the same", () => {
  for (const code of ["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-email"]) {
    assert.equal(callerLoginErrorMessage({ code }), "Incorrect email or password.");
  }
});

test("throttling, offline and disabled accounts get their own message", () => {
  assert.match(callerLoginErrorMessage({ code: "auth/too-many-requests" }), /Too many attempts/);
  assert.match(callerLoginErrorMessage({ code: "auth/network-request-failed" }), /No connection/);
  assert.equal(callerLoginErrorMessage({ code: "auth/user-disabled" }), DEACTIVATED_MESSAGE);
});

test("deactivated and not-a-caller errors carry their reason through", () => {
  assert.equal(callerLoginErrorMessage(new CallerAuthError("deactivated")), DEACTIVATED_MESSAGE);
  assert.equal(callerLoginErrorMessage(new CallerAuthError("not-a-caller")), NOT_A_CALLER_MESSAGE);
  assert.equal(new CallerAuthError("deactivated").message, DEACTIVATED_MESSAGE);
});

test("anything unrecognised falls back to a generic message", () => {
  assert.equal(callerLoginErrorMessage(new Error("boom")), "Couldn't sign in. Try again.");
  assert.equal(callerLoginErrorMessage(null), "Couldn't sign in. Try again.");
});
