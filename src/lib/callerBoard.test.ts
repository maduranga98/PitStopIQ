// Run with: npm test   (node --test, TypeScript stripped natively by Node)
import { test } from "node:test";
import assert from "node:assert/strict";
import { callerMove, sortLeadsForBoard } from "./callerBoard.ts";

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
