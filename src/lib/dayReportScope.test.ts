// Run with: npm test   (node --test, TypeScript stripped natively by Node)
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayCallers, scopeDayReport, type DayActivity, type DayReport } from "./dayReportScope.ts";
import type { Lead } from "../types/leads.ts";

const act = (id: string, byUid: string, byName: string, over: Partial<DayActivity> = {}): DayActivity => ({
  id, leadId: `L-${id}`, callNumber: 1, outcome: "connected", tags: [], note: "", at: new Date(),
  byName, byUid, ...over,
});
const lead = (id: string, assignedTo: string, over: Partial<Lead> = {}) =>
  ({ id, assignedTo, businessName: id, ...over }) as Lead;

const base = (): DayReport => ({
  date: "2026-09-21",
  activity: [
    act("1", "u1", "Nimal"),
    act("2", "u1", "Nimal", { outcome: "demo_scheduled" }),
    act("3", "u2", "Kamal", { callNumber: 0, outcome: "note", leadId: "L-9" }),
  ],
  callCount: 2, noteCount: 1, leadsTouched: 3, demosBooked: 1,
  newLeads: [lead("A", "u1"), lead("B", "u2")],
  demosToday: [lead("C", "u2")],
  wonToday: [lead("W1", "u1", { closedAmount: 5000 }), lead("W2", "u2", { closedAmount: 7000 })],
  wonAmount: 12000, byOutcome: [],
});

test("callers present that day are listed, busiest first", () => {
  assert.deepEqual(dayCallers(base()).map((c) => [c.name, c.count]), [["Nimal", 2], ["Kamal", 1]]);
});

test("'all' leaves the report untouched", () => {
  const r = base();
  assert.equal(scopeDayReport(r, "all"), r);
});

test("scoping to one caller recounts every figure from their own entries and leads", () => {
  const s = scopeDayReport(base(), "u1");
  assert.equal(s.activity.length, 2);
  assert.equal(s.callCount, 2);
  assert.equal(s.noteCount, 0);
  assert.equal(s.leadsTouched, 2);
  assert.equal(s.demosBooked, 1);
  assert.deepEqual(s.newLeads.map((l) => l.id), ["A"]);
  assert.equal(s.demosToday.length, 0);
  assert.deepEqual(s.wonToday.map((l) => l.id), ["W1"]);
  assert.equal(s.wonAmount, 5000);

  const k = scopeDayReport(base(), "u2");
  assert.equal(k.callCount, 0);
  assert.equal(k.noteCount, 1);
  assert.equal(k.demosToday.length, 1);
  assert.equal(k.wonAmount, 7000);
});
