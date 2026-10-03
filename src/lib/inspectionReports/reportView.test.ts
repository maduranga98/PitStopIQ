// Run with: npm test   (node --test, TypeScript stripped natively by Node)
import { test } from "node:test";
import assert from "node:assert/strict";
import { displayItems, resultCounts } from "./reportView.ts";

const section = { id: "s", items: [
  { id: "a", label: "A", hidden: false, order: 0, isDefault: true, defaultKey: "a" },
  { id: "b", label: "B", hidden: false, order: 1, isDefault: true, defaultKey: "b" },
  { id: "c", label: "C", hidden: false, order: 2, isDefault: true, defaultKey: "c" },
  { id: "d", label: "D", hidden: false, order: 3, isDefault: true, defaultKey: "d" },
] };
const only = [{ id: "r_1", sectionId: "s", label: "Extra", order: 1 }, { id: "r_2", sectionId: "other", label: "Elsewhere", order: 1 }];
const results = {
  a: { status: "meets" as const, remark: "", photoIds: [] },
  b: { status: "na" as const, remark: "n", photoIds: ["m1"] },
  c: { status: "needs_repair" as const, remark: "worn", photoIds: [] },
  r_1: { status: "needs_repair" as const, remark: "", photoIds: [] },
};

test("needs repair first, then meets, then N/A, then unanswered; ties keep template order", () => {
  assert.deepEqual(displayItems(section, only, results).map((i) => i.id), ["c", "r_1", "a", "b", "d"]);
});

test("report-only items appear only in their own section, and carry remark + photos", () => {
  const items = displayItems(section, only, results);
  assert.ok(!items.some((i) => i.id === "r_2"));
  assert.equal(items.find((i) => i.id === "r_1")?.reportOnly, true);
  assert.deepEqual(items.find((i) => i.id === "b")?.photoIds, ["m1"]);
  assert.equal(items.find((i) => i.id === "c")?.remark, "worn");
});

test("counts across sections", () => {
  assert.deepEqual(resultCounts([section], only, results), { meets: 1, needs_repair: 2, na: 1 });
});
