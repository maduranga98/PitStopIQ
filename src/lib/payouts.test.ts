// Run with: npm test   (node --test, TypeScript stripped natively by Node)
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupPayouts, payoutCsvRows, payoutTotals, pendingWeeks } from "./payouts.ts";
import type { Lead } from "../types/leads.ts";

const lead = (over: Partial<Lead>): Lead => ({
  id: Math.random().toString(36).slice(2), businessName: "G", stage: "won", packageId: "basic",
  commissionAmount: 1000, paymentConfirmed: true, payoutStatus: "pending", payoutWeek: "2026-W44",
  assignedTo: "c1", assignedToName: "Kasun", ...over,
} as Lead);

test("groups by caller with subtotals, and a grand total across callers", () => {
  const groups = groupPayouts([
    lead({}), lead({ packageId: "pro", commissionAmount: 1600 }),
    lead({ assignedTo: "c2", assignedToName: "Amal" }),
  ]);
  assert.equal(groups.length, 2);
  const kasun = groups.find((g) => g.callerId === "c1")!;
  assert.equal(kasun.total, 2600);
  assert.equal(kasun.pendingTotal, 2600);
  assert.equal(kasun.leads.length, 2);
  const totals = payoutTotals(groups);
  assert.deepEqual(totals, { total: 3600, pendingTotal: 3600, sentTotal: 0 });
});

test("sent leads stay visible and are counted as sent, not pending", () => {
  const [g] = groupPayouts([lead({}), lead({ payoutStatus: "paid_to_caller", commissionAmount: 1600 })]);
  assert.equal(g.leads.length, 2);
  assert.equal(g.pending.length, 1);
  assert.equal(g.pendingTotal, 1000);
  assert.equal(g.sentTotal, 1600);
  assert.equal(g.allSent, false);
});

test("a fully sent group is marked allSent and sorts after groups still owed", () => {
  const groups = groupPayouts([
    lead({ assignedTo: "a", assignedToName: "Aaa", payoutStatus: "paid_to_caller" }),
    lead({ assignedTo: "z", assignedToName: "Zzz" }),
  ]);
  assert.deepEqual(groups.map((g) => [g.callerName, g.allSent]), [["Zzz", false], ["Aaa", true]]);
});

test("unconfirmed, status-less and unassigned leads are never payable", () => {
  assert.equal(groupPayouts([
    lead({ paymentConfirmed: false }), lead({ payoutStatus: null }), lead({ assignedTo: null }),
  ]).length, 0);
});

test("pendingWeeks lists weeks still owing, oldest first, ignoring sent leads", () => {
  assert.deepEqual(pendingWeeks([
    lead({ payoutWeek: "2026-W44" }), lead({ payoutWeek: "2026-W42" }), lead({ payoutWeek: "2026-W42" }),
    lead({ payoutWeek: "2026-W40", payoutStatus: "paid_to_caller" }),
  ]), [{ week: "2026-W42", count: 2 }, { week: "2026-W44", count: 1 }]);
});

test("CSV has one row per lead", () => {
  const rows = payoutCsvRows("2026-W44", groupPayouts([lead({}), lead({ payoutStatus: "paid_to_caller" })]));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].slice(0, 5), ["2026-W44", "Kasun", "G", "basic", "1000"]);
  assert.ok(rows.some((r) => r[6] === "Sent") && rows.some((r) => r[6] === "Pending"));
});
