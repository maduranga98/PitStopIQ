// Run with: npm test   (node --test, TypeScript stripped natively by Node)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_CLASH_MINUTES, DEMO_DURATION_MINUTES, demoWindowLabel, formatDemoSlot,
  matchesRating, profileProgress, ratingOf, blankServiceProfile,
} from "../types/leads.ts";

test("ratingOf only trusts whole numbers 1–5", () => {
  assert.equal(ratingOf({ rating: 4 }), 4);
  assert.equal(ratingOf({ rating: null }), 0);
  assert.equal(ratingOf({}), 0);
  assert.equal(ratingOf({ rating: 7 }), 0);
  assert.equal(ratingOf({ rating: 2.5 }), 0);
});

test("rating filters: n+ is a floor, unrated is its own bucket", () => {
  const r = (rating?: number) => ({ rating });
  assert.equal(matchesRating(r(5), "all"), true);
  assert.equal(matchesRating(r(), "all"), true);
  assert.equal(matchesRating(r(4), "4+"), true);
  assert.equal(matchesRating(r(3), "4+"), false);
  assert.equal(matchesRating(r(5), "5+"), true);
  assert.equal(matchesRating(r(4), "5+"), false);
  assert.equal(matchesRating(r(), "1+"), false);
  assert.equal(matchesRating(r(), "unrated"), true);
  assert.equal(matchesRating(r(1), "unrated"), false);
});

test("a demo is 45 minutes, and starts closer than that plus the gap clash", () => {
  assert.equal(DEMO_DURATION_MINUTES, 45);
  assert.equal(DEMO_CLASH_MINUTES, 60);
  assert.match(demoWindowLabel("10:00"), /10:00.*10:45/);
  assert.match(demoWindowLabel("19:30"), /7:30.*8:15/);
  assert.match(formatDemoSlot("2026-09-21", "14:30"), /2:30.*3:15/);
  assert.equal(demoWindowLabel(""), "");
});

test("profile progress counts answered questions", () => {
  assert.deepEqual(profileProgress(null), { done: 0, total: 10 });
  assert.deepEqual(profileProgress(blankServiceProfile()), { done: 0, total: 10 });
  const p = { ...blankServiceProfile(), centerType: "repair" as const, staff: { total: 4 }, painTags: ["REM" as const] };
  assert.equal(profileProgress(p).done, 3);
});
