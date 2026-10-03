// Run with: npm test   (node --test, TypeScript stripped natively by Node)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fitWithin, rotatedSize, validateAttachment, validatePhoto, extensionForMime, newMediaId,
} from "./mediaRules.ts";

test("fitWithin shrinks the longest side to the cap and keeps the aspect ratio", () => {
  assert.deepEqual(fitWithin(4000, 3000, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(3000, 4000, 1600), { width: 1200, height: 1600 });
  assert.deepEqual(fitWithin(1600, 1600, 1600), { width: 1600, height: 1600 });
});

test("fitWithin never scales up and never returns a zero side", () => {
  assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(100000, 10, 1600), { width: 1600, height: 1 });
});

test("rotatedSize swaps the sides on odd quarter turns", () => {
  assert.deepEqual(rotatedSize(1600, 1200, 1), { width: 1200, height: 1600 });
  assert.deepEqual(rotatedSize(1600, 1200, 2), { width: 1600, height: 1200 });
  assert.deepEqual(rotatedSize(1600, 1200, -1), { width: 1200, height: 1600 });
  assert.deepEqual(rotatedSize(1600, 1200, 3), { width: 1200, height: 1600 });
});

test("attachments: PDF/JPG/PNG, <= 10 MB, at most 10", () => {
  const ok = { type: "application/pdf", size: 1024 };
  assert.deepEqual(validateAttachment(ok, 0), { ok: true });
  assert.deepEqual(validateAttachment({ type: "image/png", size: 10 * 1024 * 1024 }, 9), { ok: true });
  assert.equal(validateAttachment(ok, 10).ok, false);
  assert.equal(validateAttachment({ type: "image/gif", size: 10 }, 0).ok, false);
  assert.equal(validateAttachment({ type: "application/pdf", size: 10 * 1024 * 1024 + 1 }, 0).ok, false);
});

test("photos: images only, with a sanity cap on the original", () => {
  assert.equal(validatePhoto({ type: "image/heic", size: 5_000_000 }).ok, true);
  assert.equal(validatePhoto({ type: "application/pdf", size: 10 }).ok, false);
  assert.equal(validatePhoto({ type: "image/jpeg", size: 60 * 1024 * 1024 }).ok, false);
});

test("extension and ids", () => {
  assert.equal(extensionForMime("application/pdf"), "pdf");
  assert.equal(extensionForMime("image/png"), "png");
  assert.equal(extensionForMime("image/jpeg"), "jpg");
  const a = newMediaId();
  assert.match(a, /^m_[0-9a-f]{16}$/);
  assert.notEqual(a, newMediaId());
});
