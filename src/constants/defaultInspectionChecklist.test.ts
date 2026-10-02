// Run with: npm test   (node --test, TypeScript stripped natively by Node)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CHECKLIST, DEFAULTS_VERSION, DIAGNOSTIC_QUICK_CHECK_SECTION_ID, defaultItemId,
} from "./defaultInspectionChecklist.ts";

test("the shipped default has the seven sections in the agreed order", () => {
  assert.deepEqual(
    DEFAULT_CHECKLIST.map((s) => s.id),
    ["operational", "underbody", "underhood", "body", "functional", "scan", "hybrid"],
  );
  assert.deepEqual(DEFAULT_CHECKLIST.map((s) => s.items.length), [12, 12, 7, 8, 8, 10, 5]);
});

test("section and item ids are unique and stable-shaped", () => {
  const sectionIds = DEFAULT_CHECKLIST.map((s) => s.id);
  assert.equal(new Set(sectionIds).size, sectionIds.length);
  const itemIds = DEFAULT_CHECKLIST.flatMap((s) => s.items.map(([slug]) => defaultItemId(s.id, slug)));
  assert.equal(new Set(itemIds).size, itemIds.length);
  for (const id of itemIds) assert.match(id, /^[a-z]+\.[a-z0-9_]+$/);
});

test("labels are non-empty and unique within a section", () => {
  for (const s of DEFAULT_CHECKLIST) {
    const labels = s.items.map(([, label]) => label);
    assert.ok(labels.every((l) => l.trim().length > 0));
    assert.equal(new Set(labels).size, labels.length, s.id);
  }
});

test("only Hybrid Components is hidden by default", () => {
  assert.deepEqual(DEFAULT_CHECKLIST.filter((s) => s.hiddenByDefault).map((s) => s.id), ["hybrid"]);
});

test("the diagnostic quick-check list is the Electronic Scan section", () => {
  const s = DEFAULT_CHECKLIST.find((x) => x.id === DIAGNOSTIC_QUICK_CHECK_SECTION_ID);
  assert.equal(s?.title, "Electronic Scan / Diagnosis");
});

test("defaults version starts at 1", () => {
  assert.equal(DEFAULTS_VERSION, 1);
});
