// Run with: npm test   (node --test, TypeScript stripped natively by Node)
import { test } from "node:test";
import assert from "node:assert/strict";
import { isIsoWeekKey, isoWeekKey, isoWeekLabel, shiftIsoWeek } from "./isoWeek.ts";

const at = (iso: string) => new Date(iso);

test("known ISO weeks, including year boundaries", () => {
  assert.equal(isoWeekKey(at("2026-10-28T06:00:00Z")), "2026-W44");
  assert.equal(isoWeekKey(at("2026-10-26T06:00:00Z")), "2026-W44"); // Monday
  assert.equal(isoWeekKey(at("2026-11-01T06:00:00Z")), "2026-W44"); // Sunday
  assert.equal(isoWeekKey(at("2026-11-02T06:00:00Z")), "2026-W45");
  assert.equal(isoWeekKey(at("2026-01-01T06:00:00Z")), "2026-W01");
  assert.equal(isoWeekKey(at("2025-12-29T06:00:00Z")), "2026-W01"); // Dec date, next ISO year
  assert.equal(isoWeekKey(at("2024-12-30T06:00:00Z")), "2025-W01");
  assert.equal(isoWeekKey(at("2021-01-03T06:00:00Z")), "2020-W53"); // Jan date, 53-week year
  assert.equal(isoWeekKey(at("2020-12-31T06:00:00Z")), "2020-W53");
});

test("the week follows Sri Lanka time, not UTC", () => {
  // Sunday 23:30 UTC is already Monday 05:00 in Colombo: the next week.
  assert.equal(isoWeekKey(at("2026-11-01T23:30:00Z")), "2026-W45");
  // Monday 00:30 UTC is Monday 06:00 in Colombo — same week either way.
  assert.equal(isoWeekKey(at("2026-11-02T00:30:00Z")), "2026-W45");
  // Sunday 19:00 UTC is Monday 00:30 in Colombo.
  assert.equal(isoWeekKey(at("2026-11-01T19:00:00Z")), "2026-W45");
  assert.equal(isoWeekKey(at("2026-11-01T17:00:00Z")), "2026-W44");
});

test("shiftIsoWeek crosses year boundaries both ways", () => {
  assert.equal(shiftIsoWeek("2026-W44", 1), "2026-W45");
  assert.equal(shiftIsoWeek("2026-W01", -1), "2025-W52");
  assert.equal(shiftIsoWeek("2020-W53", 1), "2021-W01");
  assert.equal(shiftIsoWeek("2026-W44", 0), "2026-W44");
  assert.equal(shiftIsoWeek("2026-W44", -52), "2025-W44");
});

test("isIsoWeekKey accepts real weeks and rejects the rest", () => {
  for (const ok of ["2026-W44", "2020-W53", "2026-W53", "2026-W01"]) assert.ok(isIsoWeekKey(ok), ok);
  for (const bad of ["2026-W00", "2026-W54", "2025-W53", "2026-44", "week 44", "", "2026-W4"]) {
    assert.ok(!isIsoWeekKey(bad), bad);
  }
});

test("week label spans Monday to Sunday", () => {
  assert.equal(isoWeekLabel("2026-W44"), "26 Oct – 1 Nov 2026");
  assert.equal(isoWeekLabel("2026-W01"), "29 Dec – 4 Jan 2026");
});
