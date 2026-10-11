import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITS, WINDOW_MS, currentWindow, reserve, recordMiss } from "./portalThrottle.mjs";

const T0 = 10 * WINDOW_MS + 5;

test("limits are not the checkLoginAccount 20/hour model", () => {
  assert.ok(LIMITS.ipTotal >= 200, "shared mobile NAT addresses must not be locked out");
  assert.ok(LIMITS.ipMisses < LIMITS.ipTotal);
  assert.ok(LIMITS.customerTotal < LIMITS.ipTotal);
});

test("total cap: allows up to the cap, then refuses without counting the refusal", () => {
  let s = null;
  for (let i = 0; i < 3; i++) { const r = reserve(s, T0, { maxTotal: 3 }); assert.equal(r.allowed, true); s = r.state; }
  assert.equal(s.total, 3);
  const r = reserve(s, T0, { maxTotal: 3 });
  assert.equal(r.allowed, false);
  assert.equal(r.state.total, 3);
});

test("misses are what trips the tight cap; successes alone never do", () => {
  let s = null;
  for (let i = 0; i < 100; i++) s = reserve(s, T0, { maxTotal: 300, maxMisses: 30 }).state;
  assert.equal(reserve(s, T0, { maxTotal: 300, maxMisses: 30 }).allowed, true, "100 hits, 0 misses: fine");
  for (let i = 0; i < 30; i++) s = recordMiss(s, T0);
  assert.equal(reserve(s, T0, { maxTotal: 300, maxMisses: 30 }).allowed, false, "30 misses: refused");
});

test("a miss-only attacker is stopped at the miss cap long before the total cap", () => {
  let s = null; let calls = 0;
  for (;;) {
    const r = reserve(s, T0, { maxTotal: LIMITS.ipTotal, maxMisses: LIMITS.ipMisses });
    if (!r.allowed) break;
    s = recordMiss(r.state, T0); calls++;
  }
  assert.equal(calls, LIMITS.ipMisses);
});

test("the window rolls over after an hour", () => {
  let s = null;
  for (let i = 0; i < 3; i++) s = reserve(s, T0, { maxTotal: 3 }).state;
  assert.equal(reserve(s, T0, { maxTotal: 3 }).allowed, false);
  const later = reserve(s, T0 + WINDOW_MS, { maxTotal: 3 });
  assert.equal(later.allowed, true);
  assert.equal(later.state.total, 1);
  assert.equal(later.state.misses, 0);
});

test("a missing or foreign-window state reads as empty", () => {
  assert.deepEqual(currentWindow(null, T0), { windowStart: 10 * WINDOW_MS, total: 0, misses: 0 });
  assert.equal(currentWindow({ windowStart: 1, total: 99, misses: 99 }, T0).total, 0);
});
