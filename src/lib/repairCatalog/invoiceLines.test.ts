import { test, before } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { repairLineItems } from "./invoiceLines.ts";
import { invoiceTotals } from "../invoiceTotals.ts";
import type { InvoiceLineItem, ServiceJob } from "../../types/auth.ts";
import type { RepairPerformed } from "../../types/repairCatalog.ts";

// workingHours.ts imports "./jobTechnicians" without an extension, which the
// app's bundler resolves but plain node does not. Resolve it for this file only.
let carryHourlyLine: typeof import("../workingHours.ts").carryHourlyLine;
before(async () => {
  register("data:text/javascript," + encodeURIComponent(`
    export async function resolve(spec, ctx, next) {
      try { return await next(spec, ctx); }
      catch (e) { if (spec.startsWith(".") && !/\\.\\w+$/.test(spec)) return next(spec + ".ts", ctx); throw e; }
    }`));
  ({ carryHourlyLine } = await import("../workingHours.ts"));
});

// ── Fixture: the lines the two bill-building code paths make TODAY ───────────
// (createServiceJob's first draft, and createDraftInvoice's rebuild at Mark
// Done), written out by hand from their current code. A job without
// repairsPerformed must keep producing exactly this.
const svc = (description: string, unitPrice: number, extra: Partial<InvoiceLineItem> = {}): InvoiceLineItem =>
  ({ description, qty: 1, unitPrice, lineTotal: unitPrice, type: "service", ...extra });
const part = (description: string, qty: number, unitPrice: number): InvoiceLineItem =>
  ({ description, qty, unitPrice, lineTotal: qty * unitPrice, type: "part", partNumber: "OF-1", brand: "Sakura" });

const todayServices = [svc("Oil change", 2500), svc("Wash", 0), svc("Alignment", 4000, { discount: 400 })];
const todayParts = [part("Oil filter", 1, 800), part("Engine oil", 4, 1200)];
const TODAY_LINES: InvoiceLineItem[] = [...todayServices, ...todayParts];
const TODAY_SNAPSHOT = { subtotal: 12100, grandTotal: 11700 }; // 12,100 less the 400 line discount

const noRepairsJob = { repairsPerformed: undefined } as Pick<ServiceJob, "repairsPerformed">;

test("regression: a job with no repairsPerformed builds exactly today's lines and totals, on both paths", () => {
  for (const job of [noRepairsJob, { repairsPerformed: [] } as Pick<ServiceJob, "repairsPerformed">, {} as Pick<ServiceJob, "repairsPerformed">]) {
    assert.deepEqual(repairLineItems(job), []);
    // createServiceJob: services, custom services, <repairs>, parts
    const firstDraft = [...todayServices, ...repairLineItems(job), ...todayParts];
    // createDraftInvoice: services, <repairs>, parts
    const rebuild = [...todayServices, ...repairLineItems(job), ...todayParts];
    assert.deepEqual(firstDraft, TODAY_LINES);
    assert.deepEqual(rebuild, TODAY_LINES);
    assert.equal(JSON.stringify(rebuild), JSON.stringify(TODAY_LINES));
    const t = invoiceTotals(rebuild, 0, "amount", 0);
    assert.deepEqual([t.subtotal, t.grandTotal], [TODAY_SNAPSHOT.subtotal, TODAY_SNAPSHOT.grandTotal]);
  }
  // The "Labour" placeholder rule keys off the same emptiness, so it is unchanged too.
  assert.equal(repairLineItems(noRepairsJob).length === 0, true);
});

const repairs: RepairPerformed[] = [
  { repairItemId: "r1", name: "Brake job", price: 3500, custom: false, resolvedFrom: "model" },
  { repairItemId: "custom-x", name: "Weld exhaust", price: 2500, custom: true, resolvedFrom: "default" },
];
const withRepairs = { repairsPerformed: repairs } as Pick<ServiceJob, "repairsPerformed">;

test("repairLineItems: frozen price, qty 1, type repair, no technician or commission fields", () => {
  const lines = repairLineItems(withRepairs);
  assert.deepEqual(lines, [
    { description: "Brake job", qty: 1, unitPrice: 3500, lineTotal: 3500, type: "repair", repairItemId: "r1" },
    { description: "Weld exhaust", qty: 1, unitPrice: 2500, lineTotal: 2500, type: "repair" }, // custom: no repairItemId
  ]);
  for (const l of lines) {
    for (const k of ["technicianId", "technicianName", "commission", "commissionAmount", "serviceLineId"]) assert.ok(!(k in l), k);
  }
  // A bad stored price bills as 0, never NaN.
  const bad = repairLineItems({ repairsPerformed: [{ ...repairs[0], price: Number.NaN }] });
  assert.equal(bad[0].lineTotal, 0);
});

test("repair lines are in the totals, and the bill and line discounts still apply", () => {
  const lines = [...todayServices, ...repairLineItems(withRepairs), ...todayParts];
  const plain = invoiceTotals(lines, 0, "amount", 0);
  assert.equal(plain.subtotal, TODAY_SNAPSHOT.subtotal + 6000);
  assert.equal(plain.grandTotal, TODAY_SNAPSHOT.grandTotal + 6000);
  // Whole-bill percent discount comes off the subtotal that now includes repairs.
  const pct = invoiceTotals(lines, 10, "percent", 0);
  assert.equal(pct.billDiscount, 1810); // 10% of 18,100
  assert.equal(pct.grandTotal, 18100 - 400 - 1810);
  // A discount on a repair line (set at the counter) is honoured like any line's.
  const counter = lines.map((l) => (l.type === "repair" && l.description === "Brake job" ? { ...l, discount: 500 } : l));
  assert.equal(invoiceTotals(counter, 0, "amount", 0).grandTotal, plain.grandTotal - 500);
  // Flat amount + tax.
  assert.equal(invoiceTotals(lines, 1000, "amount", 200).grandTotal, 18100 - 400 - 1000 + 200);
});

test("repair lines survive the Mark Done rebuild, with the hourly line carried over untouched", () => {
  const job = { ...withRepairs, workingHoursEnabled: true, totalWorkingMinutes: 90, hourlyRate: 1500 } as Pick<
    ServiceJob, "repairsPerformed" | "workingHoursEnabled" | "totalWorkingMinutes" | "hourlyRate">;
  // The bill as opened: an hourly Wash line that the counter set up earlier.
  const previous: InvoiceLineItem[] = [
    { ...svc("Wash", 0), billingType: "hourly", hourlyRate: 1500, workingHours: 0.5, lineTotal: 750, unitPrice: 750 },
    svc("Oil change", 2500),
  ];
  const rebuilt = [...todayServices, ...repairLineItems(job), ...todayParts];
  const synced = carryHourlyLine(rebuilt, previous, job);
  // Repairs are still on the bill after the rebuild.
  assert.deepEqual(synced.filter((l) => l.type === "repair").map((l) => l.description), ["Brake job", "Weld exhaust"]);
  // The hourly carryover is exactly what it was without repairs.
  const without = carryHourlyLine([...todayServices, ...todayParts], previous, job);
  const wash = (ls: InvoiceLineItem[]) => ls.find((l) => l.description === "Wash")!;
  assert.deepEqual(wash(synced), wash(without));
  assert.equal(wash(synced).billingType, "hourly");
  assert.equal(wash(synced).workingHours, 1.5);
  assert.deepEqual(synced.filter((l) => l.type !== "repair"), without);
  // Totals after the rebuild include the repairs.
  assert.equal(invoiceTotals(synced, 0, "amount", 0).subtotal, invoiceTotals(without, 0, "amount", 0).subtotal + 6000);
});

test("removing a repair from the job drops its line at the next rebuild; parts are unaffected", () => {
  const afterRemoval = { repairsPerformed: repairs.filter((r) => r.repairItemId !== "r1") } as Pick<ServiceJob, "repairsPerformed">;
  const rebuilt = [...todayServices, ...repairLineItems(afterRemoval), ...todayParts];
  assert.deepEqual(rebuilt.filter((l) => l.type === "repair").map((l) => l.description), ["Weld exhaust"]);
  assert.deepEqual(rebuilt.filter((l) => l.type === "part"), todayParts);
});
