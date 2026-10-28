// Run with: npm test   (node --test, TypeScript stripped natively by Node)
import { test } from "node:test";
import assert from "node:assert/strict";
import { CALLER_OUTCOMES, CALLER_STAGES, callerMove, columnFor, sortLeadsForBoard, timeAgo } from "./callerBoard.ts";

test("ordinary moves are allowed, in any direction short of won", () => {
  assert.deepEqual(callerMove("new", "called"), { kind: "ok" });
  assert.deepEqual(callerMove("demo_done", "follow_up"), { kind: "ok" });
  assert.deepEqual(callerMove("lost", "called"), { kind: "ok" }); // reopening
});

test("dropping on the same column is a no-op", () => {
  assert.deepEqual(callerMove("called", "called"), { kind: "same" });
});

test("a caller can never move a lead to won, or out of it", () => {
  for (const from of ["new", "called", "demo_done", "lost"] as const) {
    assert.equal(callerMove(from, "won").kind, "blocked");
  }
  for (const to of ["new", "demo_done", "lost"] as const) {
    assert.equal(callerMove("won", to).kind, "blocked");
  }
});

test("losing a lead asks for a reason", () => {
  assert.deepEqual(callerMove("called", "lost"), { kind: "needs-reason" });
});

test("board order is newest activity first", () => {
  const t = (ms: number) => ({ toMillis: () => ms });
  const sorted = sortLeadsForBoard([
    { id: "a", updatedAt: t(1) }, { id: "b", updatedAt: t(3) }, { id: "c", createdAt: t(2) },
  ]);
  assert.deepEqual(sorted.map((l) => l.id), ["b", "c", "a"]);
});

test("callers have no Video & details column or outcome, and nothing is orphaned by that", () => {
  assert.ok(!CALLER_STAGES.some((s) => s.key === "details_sent"));
  assert.ok(!CALLER_OUTCOMES.some((o) => o.key === "details_sent"));
  assert.equal(CALLER_STAGES.length, 8);
  assert.equal(columnFor("details_sent"), "follow_up");
  assert.equal(columnFor("called"), "called");
  // Every stage a lead can be in lands in a visible column.
  const visible = new Set(CALLER_STAGES.map((s) => s.key));
  for (const stage of ["new", "called", "no_answer", "follow_up", "details_sent", "demo_booked", "demo_done", "won", "lost"] as const) {
    assert.ok(visible.has(columnFor(stage)), stage);
  }
});

test("moving a lead out of the hidden stage is an ordinary move", () => {
  assert.deepEqual(callerMove("details_sent", "follow_up"), { kind: "ok" });
});

test("timeAgo reads naturally at each scale", () => {
  const now = 1_000_000_000_000;
  assert.equal(timeAgo(now - 20_000, now), "just now");
  assert.equal(timeAgo(now - 5 * 60_000, now), "5m ago");
  assert.equal(timeAgo(now - 3 * 3_600_000, now), "3h ago");
  assert.equal(timeAgo(now - 2 * 86_400_000, now), "2d ago");
  assert.equal(timeAgo(now - 21 * 86_400_000, now), "3w ago");
  assert.equal(timeAgo(now + 5000, now), "just now");
});
