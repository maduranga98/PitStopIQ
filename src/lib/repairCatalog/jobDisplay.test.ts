import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groupInvoiceLines, jobWorkNames, repairNameForPart, repairSourceKey } from "./jobDisplay.ts";
import type { InvoiceLineItem } from "../../types/auth";

const line = (description: string, type?: InvoiceLineItem["type"]): InvoiceLineItem =>
  ({ description, qty: 1, unitPrice: 100, lineTotal: 100, ...(type ? { type } : {}) });
const names = (e: { item: InvoiceLineItem }[]) => e.map((x) => x.item.description);

test("all services (typed or untyped): one group, original order and indexes", () => {
  const g = groupInvoiceLines([line("a"), line("b", "service")]);
  assert.deepEqual(names(g.services), ["a", "b"]);
  assert.deepEqual(g.services.map((e) => e.idx), [0, 1]);
  assert.equal(g.repairs.length + g.parts.length, 0);
});

test("services + repairs + parts keep their original indexes", () => {
  const g = groupInvoiceLines([line("p", "part"), line("s", "service"), line("r", "repair"), line("s2")]);
  assert.deepEqual(names(g.services), ["s", "s2"]);
  assert.deepEqual(names(g.repairs), ["r"]);
  assert.deepEqual(names(g.parts), ["p"]);
  assert.deepEqual([g.services[0].idx, g.repairs[0].idx, g.parts[0].idx, g.services[1].idx], [1, 2, 0, 3]);
});

test("repairs only", () => {
  const g = groupInvoiceLines([line("r1", "repair"), line("r2", "repair")]);
  assert.deepEqual([g.services.length, g.repairs.length, g.parts.length], [0, 2, 0]);
});

test("parts only", () => {
  const g = groupInvoiceLines([line("p", "part")]);
  assert.deepEqual([g.services.length, g.repairs.length, g.parts.length], [0, 0, 1]);
});

test("no repairs: identical to the old services-vs-parts split", () => {
  const lines = [line("s"), line("p", "part"), line("s2", "service"), line("p2", "part")];
  const old = {
    services: lines.map((item, idx) => ({ item, idx })).filter(({ item }) => item.type !== "part"),
    parts: lines.map((item, idx) => ({ item, idx })).filter(({ item }) => item.type === "part"),
  };
  const g = groupInvoiceLines(lines);
  assert.deepEqual(g.services, old.services);
  assert.deepEqual(g.parts, old.parts);
  assert.deepEqual(g.repairs, []);
});

test("jobWorkNames: no repairs is exactly services + custom; repairs append; repairs-only is not empty", () => {
  assert.deepEqual(jobWorkNames({ services: ["Wash"], customServices: ["Polish"] }), ["Wash", "Polish"]);
  assert.deepEqual(jobWorkNames({ services: ["Wash"], customServices: [], repairsPerformed: [] }), ["Wash"]);
  assert.deepEqual(jobWorkNames({ services: ["Wash"], customServices: [], repairsPerformed: [{ name: "Brake job" }] }), ["Wash", "Brake job"]);
  assert.deepEqual(jobWorkNames({ services: [], customServices: [], repairsPerformed: [{ name: "Brake job" }] }), ["Brake job"]);
  assert.deepEqual(jobWorkNames({}), []);
});

test("repairSourceKey and repairNameForPart work from the snapshot alone", () => {
  assert.equal(repairSourceKey({ custom: true, resolvedFrom: "default" }), "custom");
  assert.equal(repairSourceKey({ custom: false, resolvedFrom: "group" }), "group");
  assert.equal(repairSourceKey({ custom: false, resolvedFrom: "default" }), "default");
  assert.equal(repairNameForPart([{ name: "Brake job", partItemIds: ["p1"] }], "p1"), "Brake job");
  assert.equal(repairNameForPart([{ name: "Brake job", partItemIds: ["p1"] }], "p2"), undefined);
  assert.equal(repairNameForPart(undefined, "p1"), undefined);
});

// ── Tripwires: the screens cannot render repair markup without repair data ──
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const invoice = src("../../pages/invoices/InvoiceDetailPage.tsx");
const detail = src("../../pages/services/ServiceDetailPage.tsx");
const picker = src("../../components/repairCatalog/RepairPicker.tsx");

test("tripwire: the invoice 'Repairs' heading is only rendered inside a repairLineEntries.length > 0 guard (screen and print)", () => {
  const heads = invoice.split('t("jobRepairs.heading")').length - 1;
  assert.equal(heads, 2);
  assert.equal((invoice.match(/\{repairLineEntries\.length > 0 && \(\s*(<div|<tr)[^]*?t\("jobRepairs\.heading"\)/g) ?? []).length, 2);
});

test("tripwire: JobRepairsList and the job print section render nothing without repairs", () => {
  assert.match(picker, /if \(repairs\.length === 0\) return null;/);
  assert.match(detail, /\{\(job\.repairsPerformed\?\.length \?\? 0\) > 0 && \(\s*<div className="mb-4">/);
});

test("repairs already on a job show regardless of the module flag", () => {
  assert.match(detail, /\{!\(repairCatalogEnabled && canEditServices && canViewRepairs && currentUser\?\.role !== "Cashier"\) && \(\s*<JobRepairsList/);
  assert.doesNotMatch(detail, /repairCatalogEnabled && !\(canEditServices/);
});

test("display code never reads the catalog", () => {
  const display = src("./jobDisplay.ts");
  assert.doesNotMatch(display, /firebase|firestore|useRepairCatalog|getDocs|onSnapshot/);
  const list = picker.slice(picker.indexOf("export function JobRepairsList"));
  assert.doesNotMatch(list, /useRepairCatalog|useModelsAndGroups|useInventoryForParts/);
});
