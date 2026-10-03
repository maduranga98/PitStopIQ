import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMonths, yearInZone, formatReportNumber, unansweredItemCount, pendingMediaCount, finalizeBlockers,
  mediaDeleteAt, pdfSafe, checklistItemIds,
} from "./inspectionHelpers.mjs";

const d = (s) => new Date(s);

test("addMonths: +12 keeps the date, clamps month ends, handles leap days", () => {
  assert.equal(addMonths(d("2026-03-15T10:00:00Z"), 12).toISOString(), "2027-03-15T10:00:00.000Z");
  assert.equal(addMonths(d("2025-01-31T00:00:00Z"), 1).toISOString(), "2025-02-28T00:00:00.000Z");
  assert.equal(addMonths(d("2024-02-29T00:00:00Z"), 12).toISOString(), "2025-02-28T00:00:00.000Z");
  assert.equal(addMonths(d("2026-11-30T00:00:00Z"), 3).toISOString(), "2027-02-28T00:00:00.000Z");
  assert.equal(addMonths(d("2026-12-31T23:00:00Z"), 12).toISOString(), "2027-12-31T23:00:00.000Z");
});

test("report year is the workshop's (Colombo), not UTC's", () => {
  // 2026-12-31 20:00 UTC is already 1 Jan 2027 in Sri Lanka (UTC+5:30).
  assert.equal(yearInZone(d("2026-12-31T20:00:00Z")), 2027);
  assert.equal(yearInZone(d("2026-12-31T18:00:00Z")), 2026);
});

test("report number format", () => {
  assert.equal(formatReportNumber(2026, 1), "INS-2026-0001");
  assert.equal(formatReportNumber(2026, 123), "INS-2026-0123");
  assert.equal(formatReportNumber(2027, 10000), "INS-2027-10000");
});

const base = () => ({
  type: "checklist",
  templateSnapshot: [{ items: [{ id: "a__x" }, { id: "a__y" }] }, { items: [{ id: "b__z" }] }],
  reportOnlyItems: [{ id: "r_1" }],
  results: {},
  media: {},
});

test("unanswered count covers snapshot items and report-only items", () => {
  const r = base();
  assert.deepEqual(checklistItemIds(r), ["a__x", "a__y", "b__z", "r_1"]);
  assert.equal(unansweredItemCount(r), 4);
  r.results = { a__x: { status: "meets" }, a__y: { status: "na" }, b__z: { status: null }, r_1: { remark: "only a remark" } };
  assert.equal(unansweredItemCount(r), 2);
  r.results.b__z = { status: "needs_repair" }; r.results.r_1 = { status: "meets" };
  assert.equal(unansweredItemCount(r), 0);
});

test("pending media = queued with no url and not expired", () => {
  const r = base();
  r.media = { a: { pending: true, url: null }, b: { pending: false, url: "u" }, c: { pending: true, url: "u" }, e: { pending: true, url: null, mediaDeleted: true } };
  assert.equal(pendingMediaCount(r), 1);
});

test("finalizeBlockers lists every reason, empty when ready", () => {
  const r = base();
  r.media = { a: { pending: true, url: null } };
  assert.equal(finalizeBlockers(r).length, 2);
  assert.match(finalizeBlockers(r)[0], /4 checklist items are not answered/);
  r.results = { a__x: { status: "meets" }, a__y: { status: "meets" }, b__z: { status: "meets" }, r_1: { status: "na" } };
  r.media = {};
  assert.deepEqual(finalizeBlockers(r), []);
  const diag = { ...base(), type: "diagnostic", title: "  ", results: r.results };
  assert.match(finalizeBlockers(diag)[0], /short title/);
  assert.deepEqual(finalizeBlockers({ ...diag, title: "P0300 misfire" }), []);
  assert.match(finalizeBlockers({ ...base(), results: { a__x: { status: "meets" } } })[0], /3 checklist items are not answered/);
  assert.match(finalizeBlockers({ ...base(), results: { a__x: { status: "meets" }, a__y: { status: "meets" }, b__z: { status: "meets" } } })[0], /1 checklist item is not answered/);
});

test("only images get a retention date", () => {
  const at = d("2026-10-03T00:00:00Z");
  assert.equal(mediaDeleteAt({ mimeType: "image/jpeg" }, at).toISOString(), "2027-10-03T00:00:00.000Z");
  assert.equal(mediaDeleteAt({ mimeType: "application/pdf" }, at), null);
  assert.equal(mediaDeleteAt(undefined, at), null);
});

test("pdfSafe: typography to ASCII, unsupported scripts to ?, Latin-1 kept", () => {
  assert.equal(pdfSafe("It’s “fine” – ok…"), "It's \"fine\" - ok...");
  assert.equal(pdfSafe("Café ñ"), "Café ñ");
  assert.equal(pdfSafe("ශ්‍රී"), "?????");
  assert.equal(pdfSafe("a\u0000b\nc"), "ab\nc");
  assert.equal(pdfSafe(null), "");
});
