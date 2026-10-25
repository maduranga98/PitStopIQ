import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allRated, buildFilledSections, cleanFilled, filledSectionsOf, markRemainingOk, parseReading,
  patchFilledItem, ratedProgress, resultCounts,
} from "./checklistFill.ts";
import { defaultChecklistSections } from "./checklistSections.ts";

const fresh = () => buildFilledSections(defaultChecklistSections());

test("a new snapshot is fully unrated", () => {
  const s = fresh();
  const { done, total } = ratedProgress(s);
  assert.equal(done, 0);
  assert.ok(total > 40);
  assert.equal(allRated(s), false);
  assert.ok(s.flatMap((x) => x.items).every((i) => i.status === null && i.value === null && i.technicianName === null));
});

test("marking the rest OK finishes the form but never overwrites an exception", () => {
  let s = patchFilledItem(fresh(), "under_hood", "under_hood_2", { status: "immediate" });
  s = markRemainingOk(s);
  assert.equal(allRated(s), true);
  assert.equal(s[1].items[2].status, "immediate");
  assert.deepEqual(resultCounts(s), { ok: ratedProgress(s).total - 1, attention: 0, immediate: 1 });
});

test("marking a single section only touches that section", () => {
  const s = markRemainingOk(fresh(), "battery_12v");
  assert.ok(s[2].items.every((i) => i.status === "ok"));
  assert.ok(s[0].items.every((i) => i.status === null));
});

test("patching changes one line and nothing else", () => {
  const s = patchFilledItem(fresh(), "battery_12v", "battery_12v_0", { status: "ok", value: 13.5 });
  assert.equal(s[2].items[0].value, 13.5);
  assert.equal(s[2].items[1].value, null);
  assert.equal(s[0].items[0].status, null);
});

test("readings parse strictly", () => {
  assert.equal(parseReading("13.5"), 13.5);
  assert.equal(parseReading(" 12 "), 12);
  assert.equal(parseReading("-0.5"), -0.5);
  assert.equal(parseReading("13."), 13);
  assert.equal(parseReading(""), null);
  assert.equal(parseReading("abc"), undefined);
  assert.equal(parseReading("1e3"), undefined);
  assert.equal(parseReading("1.2.3"), undefined);
});

test("cleanFilled keeps a reading only on numeric lines and a name only where the section asks", () => {
  let s = fresh();
  s = patchFilledItem(s, "battery_12v", "battery_12v_0", { value: 13.5 });          // numeric
  s = patchFilledItem(s, "battery_12v", "battery_12v_2", { value: 99 });            // status-only: dropped
  s = patchFilledItem(s, "battery_12v", "battery_12v_0", { technicianName: "Ishan" }); // section has no technician: dropped
  s = patchFilledItem(s, "brake_service", "brake_service_0", { technicianName: "  Kalana  " });
  s = patchFilledItem(s, "brake_service", "brake_service_1", { technicianName: "x".repeat(200) });
  const c = cleanFilled(s);
  assert.equal(c[2].items[0].value, 13.5);
  assert.equal(c[2].items[2].value, null);
  assert.equal(c[2].items[0].technicianName, null);
  assert.equal(c[3].items[0].technicianName, "Kalana");
  assert.equal(c[3].items[1].technicianName?.length, 60);
  assert.equal(c[3].items[2].technicianName, null);
});

test("an old flat-ticks checklist still reads: ticked = ok, unticked = unrated", () => {
  const s = filledSectionsOf({ items: [{ id: "a", label: "A", checked: true }, { id: "b", label: "B", checked: false }] });
  assert.equal(s.length, 1);
  assert.deepEqual(s[0].items.map((i) => i.status), ["ok", null]);
  assert.deepEqual(filledSectionsOf({}), []);
  const own = fresh();
  assert.equal(filledSectionsOf({ sections: own, items: [{ id: "a", label: "A", checked: true }] }), own);
});

import { headerError, normalizeHeader } from "./checklistFill.ts";

const blank = { customerId: null, customerNameManual: "", vehicleId: null, plateNumberManual: "", mileage: "" };

test("a header needs a vehicle — on file or by plate — and a sane mileage", () => {
  assert.match(headerError(blank) ?? "", /vehicle/);
  assert.equal(headerError({ ...blank, plateNumberManual: "CAI 5598" }), null);
  assert.equal(headerError({ ...blank, vehicleId: "v1" }), null);
  assert.match(headerError({ ...blank, vehicleId: "v1", mileage: "12.5" }) ?? "", /whole number/);
  assert.match(headerError({ ...blank, vehicleId: "v1", mileage: "abc" }) ?? "", /whole number/);
  assert.equal(headerError({ ...blank, vehicleId: "v1", mileage: "120000" }), null);
});

test("on-file customer / vehicle win over typed text; blanks become null", () => {
  assert.deepEqual(
    normalizeHeader({ customerId: "c1", customerNameManual: "Typed", vehicleId: "v1", plateNumberManual: "x", mileage: " 42000 " }),
    { customerId: "c1", customerNameManual: null, vehicleId: "v1", plateNumberManual: null, mileage: 42000 },
  );
  assert.deepEqual(
    normalizeHeader({ ...blank, customerNameManual: "  Walk-in Sam ", plateNumberManual: " cai 5598 " }),
    { customerId: null, customerNameManual: "Walk-in Sam", vehicleId: null, plateNumberManual: "CAI 5598", mileage: null },
  );
});
