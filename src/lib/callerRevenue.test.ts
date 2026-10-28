// Run with: npm test   (node --test, TypeScript stripped natively by Node)
import { test } from "node:test";
import assert from "node:assert/strict";
import { recentWeeks, saleStatus, salesList, summarizeRevenue, weeklyEarnings } from "./callerRevenue.ts";
import type { Lead } from "../types/leads.ts";

const t = (ms: number) => ({ toMillis: () => ms });
const sale = (over: Partial<Lead>): Lead => ({
  id: Math.random().toString(36).slice(2), businessName: "G", stage: "won", packageId: "basic",
  commissionAmount: 1000, paymentConfirmed: false, payoutStatus: null, payoutWeek: null, ...over,
} as Lead);
const confirmed = (over: Partial<Lead> = {}) =>
  sale({ paymentConfirmed: true, payoutStatus: "pending", payoutWeek: "2026-W44", ...over });
const paid = (over: Partial<Lead> = {}) => confirmed({ payoutStatus: "paid_to_caller", ...over });

test("a sale is awaiting, payable or paid", () => {
  assert.equal(saleStatus(sale({})), "awaiting");
  assert.equal(saleStatus(confirmed()), "payable");
  assert.equal(saleStatus(paid()), "paid");
});

test("summary splits earned into paid and payable, and keeps unconfirmed apart", () => {
  const s = summarizeRevenue([
    sale({ commissionAmount: 1600 }), confirmed(), paid({ commissionAmount: 1600 }),
  ]);
  assert.deepEqual(s, { earned: 2600, paidOut: 1600, payable: 1000, awaiting: 1600, sales: 3 });
});

test("only won, non-archived leads count", () => {
  const s = summarizeRevenue([
    confirmed({ stage: "demo_done" }), confirmed({ isDeleted: true }), confirmed(),
  ]);
  assert.equal(s.sales, 1);
  assert.equal(s.earned, 1000);
});

test("a sale whose commission isn't set yet counts as a sale worth zero", () => {
  const s = summarizeRevenue([sale({ commissionAmount: null })]);
  assert.deepEqual(s, { earned: 0, paidOut: 0, payable: 0, awaiting: 0, sales: 1 });
});

test("weekly earnings group confirmed commission by payout week, newest first", () => {
  const rows = weeklyEarnings([
    confirmed(), paid({ commissionAmount: 1600 }), confirmed({ payoutWeek: "2026-W42" }), sale({}),
  ]);
  assert.deepEqual(rows.map((r) => r.week), ["2026-W44", "2026-W42"]);
  assert.deepEqual(rows[0], { week: "2026-W44", total: 2600, paid: 1600, payable: 1000, count: 2 });
});

test("recentWeeks fills gaps with zeros and ends on the current week", () => {
  const rows = recentWeeks(weeklyEarnings([confirmed({ payoutWeek: "2026-W42" })]), 4, "2026-W44");
  assert.deepEqual(rows.map((r) => r.week), ["2026-W41", "2026-W42", "2026-W43", "2026-W44"]);
  assert.deepEqual(rows.map((r) => r.total), [0, 1000, 0, 0]);
  assert.equal(recentWeeks([], 8, "2026-W02")[0].week, "2025-W47");
});

test("sales list is newest registration first", () => {
  const list = salesList([
    sale({ id: "a", convertedAt: t(1) as never }), sale({ id: "b", convertedAt: t(3) as never }),
    sale({ id: "c", convertedAt: t(2) as never }), confirmed({ id: "d", stage: "lost", convertedAt: t(9) as never }),
  ]);
  assert.deepEqual(list.map((l) => l.id), ["b", "c", "a"]);
});
