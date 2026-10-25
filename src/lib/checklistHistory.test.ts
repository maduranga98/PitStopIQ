import { test } from "node:test";
import assert from "node:assert/strict";
import { checklistState, filterChecklists, stateCounts, urgentCount } from "./checklistHistory.ts";
import type { StandalonePostServiceChecklist } from "../types/auth";

const item = (status: "ok" | "attention" | "immediate" | null) => ({ id: "i", label: "L", order: 0, type: "status" as const, status, value: null, technicianName: null });
const rec = (over: Partial<StandalonePostServiceChecklist>): StandalonePostServiceChecklist => ({
  id: "r", templateId: "t", templateName: "Post-Service Checklist", allowedRoles: [], assignedTo: null,
  sections: [{ id: "s", title: "S", order: 0, hasTechnician: false, items: [item("ok")] }], remarks: null,
  customerId: null, customerNameManual: null, vehicleId: null, plateNumberManual: null, mileage: null,
  date: {} as never, completedBy: null, completedAt: null, createdBy: "u", createdAt: {} as never, ...over,
});
const signed = {} as never;
const none = { query: "", state: "all", urgentOnly: false } as const;

test("a record is a draft, signed off, or sent — sent wins", () => {
  assert.equal(checklistState(rec({})), "draft");
  assert.equal(checklistState(rec({ completedAt: signed })), "signed");
  assert.equal(checklistState(rec({ completedAt: signed, sentToCustomer: true })), "sent");
});

test("status filter and counts", () => {
  const all = [rec({ id: "1" }), rec({ id: "2", completedAt: signed }), rec({ id: "3", completedAt: signed, sentToCustomer: true })];
  assert.deepEqual(stateCounts(all), { all: 3, draft: 1, signed: 1, sent: 1 });
  assert.deepEqual(filterChecklists(all, { ...none, state: "signed" }).map((r) => r.id), ["2"]);
  assert.equal(filterChecklists(all, none).length, 3);
});

test("only urgent: records with a line rated immediate", () => {
  const urgent = rec({ id: "u", sections: [{ id: "s", title: "S", order: 0, hasTechnician: false, items: [item("ok"), item("immediate")] }] });
  assert.equal(urgentCount(urgent.sections), 1);
  assert.equal(urgentCount(undefined), 0);
  assert.deepEqual(filterChecklists([rec({ id: "n" }), urgent], { ...none, urgentOnly: true }).map((r) => r.id), ["u"]);
});

test("search matches typed or on-file plates (with or without spaces), customer names and phone digits", () => {
  const lookup = { plateById: new Map([["v1", "CAI 5598"]]), nameById: new Map([["c1", "Kamal Perera"]]), phoneById: new Map([["c1", "077 123 4567"]]) };
  const filed = rec({ id: "filed", vehicleId: "v1", customerId: "c1" });
  const typed = rec({ id: "typed", plateNumberManual: "WP KA 1", customerNameManual: "Walk-in Sam" });
  const all = [filed, typed];
  const ids = (query: string) => filterChecklists(all, { ...none, query }, lookup).map((r) => r.id);
  assert.deepEqual(ids("cai5598"), ["filed"]);
  assert.deepEqual(ids("CAI 5598"), ["filed"]);
  assert.deepEqual(ids("kamal"), ["filed"]);
  assert.deepEqual(ids("sam"), ["typed"]);
  assert.deepEqual(ids("wpka1"), ["typed"]);
  assert.deepEqual(ids("0771234567"), ["filed"]);
  assert.deepEqual(ids("post-service"), ["filed", "typed"]);
  assert.deepEqual(ids("nothing"), []);
  assert.deepEqual(ids("  "), ["filed", "typed"]);
});
