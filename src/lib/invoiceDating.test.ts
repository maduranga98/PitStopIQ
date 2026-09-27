// Run with: npm test   (node --test, TypeScript stripped natively by Node)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  invoicePrefixFor,
  invoiceNumberYear,
  needsCompletionYearNumber,
  nextInvoiceNumber,
} from "./invoiceDating.ts";

// A job card opened 28 Dec and completed 3 Jan: the bill is the new year's.
const OPENED = new Date(2026, 11, 28, 16, 30);
const COMPLETED = new Date(2027, 0, 3, 10, 15);

test("the sequence prefix comes from the completion moment, not the job's creation", () => {
  assert.equal(invoicePrefixFor(COMPLETED), "INV-2027-01-");
  assert.notEqual(invoicePrefixFor(COMPLETED), invoicePrefixFor(OPENED));
});

test("a new year's sequence starts again at 0001", () => {
  const prefix = invoicePrefixFor(COMPLETED);
  // No bill issued in January yet — December's last number must not carry over.
  assert.equal(nextInvoiceNumber(prefix, null), "INV-2027-01-0001");
  assert.equal(nextInvoiceNumber(prefix, "INV-2026-12-0412"), "INV-2027-01-0001");
});

test("an existing sequence continues from its highest number", () => {
  assert.equal(nextInvoiceNumber("INV-2027-01-", "INV-2027-01-0009"), "INV-2027-01-0010");
  assert.equal(nextInvoiceNumber("INV-2027-01-", "INV-2027-01-garbled"), "INV-2027-01-0001");
});

test("reads the year out of both invoice number shapes", () => {
  assert.equal(invoiceNumberYear("INV-2026-12-0042"), 2026);
  assert.equal(invoiceNumberYear("2026-12-0042-INV"), 2026);
  assert.equal(invoiceNumberYear("WS-2026-12-0042-INV"), 2026);
  assert.equal(invoiceNumberYear("2026-13-0042-INV"), null);
  assert.equal(invoiceNumberYear("MANUAL-7"), null);
  assert.equal(invoiceNumberYear(undefined), null);
});

test("a draft opened last year is renumbered on completion; same-year drafts are not", () => {
  assert.equal(needsCompletionYearNumber("2026-12-0042-INV", COMPLETED), true);
  assert.equal(needsCompletionYearNumber("2027-01-0001-INV", COMPLETED), false);
  // Month boundary within a year keeps its number — only the year is an audit concern.
  assert.equal(needsCompletionYearNumber("2027-01-0001-INV", new Date(2027, 1, 2)), false);
  // Unreadable numbers are never guessed at.
  assert.equal(needsCompletionYearNumber("MANUAL-7", COMPLETED), false);
});
