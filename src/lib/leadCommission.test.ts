// Run with: npm test   (node --test, TypeScript stripped natively by Node)
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcCommission, stageEntry } from "./leadCommission.ts";

test("commission rounds to whole rupees: Basic 1000, Pro 1600", () => {
  assert.equal(calcCommission({ price: 4999, commissionRate: 0.2 }), 1000);
  assert.equal(calcCommission({ price: 7999, commissionRate: 0.2 }), 1600);
});

test("commission follows the package doc, not a hardcoded rate", () => {
  assert.equal(calcCommission({ price: 10000, commissionRate: 0.15 }), 1500);
  assert.equal(calcCommission({ price: 0, commissionRate: 0.2 }), 0);
});

test("stageEntry records who moved the lead, from where and to where", () => {
  const entry = stageEntry("demo_done", "won", { id: "u1", name: "Madu" });
  assert.equal(entry.from, "demo_done");
  assert.equal(entry.to, "won");
  assert.equal(entry.byUid, "u1");
  assert.equal(entry.byName, "Madu");
  assert.ok(entry.at);
});

import { paymentConfirmBlocker } from "./leadCommission.ts";

const ready = { stage: "won", packageId: "basic", assignedTo: "c1", paymentConfirmed: false } as const;

test("payment can be confirmed on a won lead with a package and a caller", () => {
  assert.equal(paymentConfirmBlocker(ready), null);
});

test("each missing piece blocks with its own reason", () => {
  assert.match(paymentConfirmBlocker({ ...ready, stage: "demo_done" }) ?? "", /registered as a customer/);
  assert.match(paymentConfirmBlocker({ ...ready, packageId: null }) ?? "", /package is unknown/);
  assert.match(paymentConfirmBlocker({ ...ready, assignedTo: null }) ?? "", /Assign a caller/);
});

test("an already-confirmed lead is not blocked (the button is hidden instead)", () => {
  assert.equal(paymentConfirmBlocker({ ...ready, paymentConfirmed: true, packageId: null }), null);
});
