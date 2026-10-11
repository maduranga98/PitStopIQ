// ── Public portal projections ──────────────────────────────────────────────────
//
// The customer portal (/c/:centerId/:customerId, its invoice page, the booking
// slot lookup) is served by callables running as the Admin SDK, which bypasses
// firestore.rules entirely. That makes these functions the ONLY thing standing
// between a job/invoice document and an anonymous caller, so the rule they all
// follow is simple and strict:
//
//   WHITELIST. Every projector builds its result from named fields. Nothing is
//   ever spread, copied wholesale or "minus a few keys" — a field added to a
//   document next year is private until someone deliberately adds it here.
//
// What is deliberately never copied, anywhere in this file: costPrice,
// unitCost, purchasePrice, laborCost, commissionTotal, commissionSnapshot,
// commissionRunHash, internalNotes, serviceLines, technician names/ids,
// recordedBy*/clearedBy*/returnedBy*, payment notes, numberConflict*, pdfUrl,
// SMS flags, the author of a shared note. portalProjections.test.mjs feeds a
// document stuffed with all of them through every projector and fails if any
// survives.
//
// Timestamps leave as epoch milliseconds (`...Millis`): a Firestore Timestamp
// does not survive a callable's JSON as a Timestamp, and millis is the shape
// the other public callables (getPublicReport, getPortalInspectionReports)
// already use.

/** Epoch millis of a Firestore Timestamp (or Date / number), else null. */
export function millis(ts) {
  if (ts == null) return null;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  return typeof ts === "number" && Number.isFinite(ts) ? ts : null;
}

const str = (v) => (typeof v === "string" ? v : null);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const num0 = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

// ── Center ────────────────────────────────────────────────────────────────────

/** The center fields the customer portal shows or schedules bookings from. */
export function projectPortalCenter(c = {}) {
  return {
    name: str(c.name) ?? "Service Center",
    phone: str(c.phone),
    logoUrl: str(c.logoUrl),
    weeklyHours: c.weeklyHours && typeof c.weeklyHours === "object" ? c.weeklyHours : null,
    slotDurationMinutes: num(c.slotDurationMinutes),
    calendarOverrides: c.calendarOverrides && typeof c.calendarOverrides === "object" ? c.calendarOverrides : null,
    diagnosticReportsEnabled: c.diagnosticReportsEnabled === true,
    standaloneInspectionEnabled: c.standaloneInspectionEnabled === true,
  };
}

/** The letterhead and print settings of a shared invoice. */
export function projectInvoiceCenter(c = {}) {
  const p = c.invoicePaper && typeof c.invoicePaper === "object" ? c.invoicePaper : null;
  return {
    name: str(c.name) ?? "Service Center",
    address: str(c.address),
    phone: str(c.phone),
    phone2: str(c.phone2),
    email: str(c.email),
    logoUrl: str(c.logoUrl),
    invoicePaper: p
      ? { size: str(p.size), widthMm: num(p.widthMm), heightMm: num(p.heightMm), marginMm: num(p.marginMm) }
      : null,
  };
}

// ── Customer / vehicle / job ──────────────────────────────────────────────────

export function projectPortalCustomer(id, c = {}) {
  return {
    id,
    name: str(c.name) ?? "",
    phone: str(c.phone) ?? "",
    createdAtMillis: millis(c.createdAt),
  };
}

export function projectPortalVehicle(id, v = {}) {
  return {
    id,
    plateNumber: str(v.plateNumber) ?? "",
    make: str(v.make),
    model: str(v.model),
    vehicleType: str(v.vehicleType),
    currentMileageKm: num(v.currentMileageKm),
    nextServiceMileageKm: num(v.nextServiceMileageKm),
    oilBrand: str(v.oilBrand),
    oilGrade: str(v.oilGrade),
  };
}

/** A service-history row: what was done, to which vehicle, when. No money, no staff. */
export function projectPortalJob(id, j = {}) {
  return {
    id,
    plateNumber: str(j.plateNumber) ?? "",
    createdAtMillis: millis(j.createdAt),
    services: strList(j.services),
    customServices: strList(j.customServices),
    mileageOut: num(j.mileageOut),
  };
}

/** A workshop note the staff chose to share. The author is never included. */
export function projectSharedNote(id, e = {}, plateNumber = "") {
  return {
    id,
    message: str(e.message) ?? "",
    needsFollowUp: e.needsFollowUp === true,
    createdAtMillis: millis(e.createdAt),
    plateNumber,
  };
}

// ── Invoices ──────────────────────────────────────────────────────────────────

/**
 * Same test PublicInvoiceView applies today: a draft nobody has finalized or
 * sent is not public. Used for the portal list as well, so a draft's total is
 * not shown on a list whose link would then say "not found".
 */
export function isInvoiceReleased(inv = {}) {
  if (inv.isDeleted === true) return false;
  return !(!inv.finalized && !inv.smsSent && inv.status === "pending");
}

const customerVisibleMethod = (m) => m === "cheque" || m === "credit";

/** Cheque and credit entries only — what SettlementBlock prints. No staff, no notes. */
export function projectPayment(p = {}) {
  return {
    id: str(p.id) ?? "",
    method: str(p.method),
    amount: num0(p.amount),
    dateMillis: millis(p.date),
    chequeNumber: str(p.chequeNumber),
    bank: str(p.bank),
    branch: str(p.branch),
    chequeDateMillis: millis(p.chequeDate),
    clearance: str(p.clearance),
  };
}

export function projectPayments(payments) {
  return (Array.isArray(payments) ? payments : [])
    .filter((p) => p && customerVisibleMethod(p.method))
    .map(projectPayment);
}

/** One bill line. unitCost / costPrice / technician / commission never leave. */
export function projectInvoiceLine(l = {}) {
  const w = l.warranty && typeof l.warranty === "object" ? l.warranty : null;
  return {
    description: str(l.description) ?? "",
    qty: num0(l.qty),
    unitPrice: num0(l.unitPrice),
    lineTotal: num0(l.lineTotal),
    type: str(l.type),
    partNumber: str(l.partNumber),
    brand: str(l.brand),
    warranty: w ? { value: num0(w.value), unit: str(w.unit), notes: str(w.notes) } : null,
    discount: num(l.discount),
    billingType: str(l.billingType),
    hourlyRate: num(l.hourlyRate),
    workingHours: num(l.workingHours),
  };
}

/** A row of the portal's Invoices tab. */
export function projectInvoiceSummary(id, inv = {}) {
  return {
    id,
    invoiceNumber: str(inv.invoiceNumber) ?? "",
    plateNumber: str(inv.plateNumber) ?? "",
    createdAtMillis: millis(inv.createdAt),
    grandTotal: num0(inv.grandTotal),
    status: str(inv.status),
    payments: projectPayments(inv.payments),
  };
}

/** The full shared invoice page. */
export function projectPublicInvoice(id, inv = {}) {
  return {
    id,
    invoiceNumber: str(inv.invoiceNumber) ?? "",
    serviceDateMillis: millis(inv.serviceDate),
    customerName: str(inv.customerName) ?? "",
    customerPhone: str(inv.customerPhone) ?? "",
    plateNumber: str(inv.plateNumber) ?? "",
    mileageIn: num(inv.mileageIn),
    nextServiceMileageKm: num(inv.nextServiceMileageKm),
    lineItems: (Array.isArray(inv.lineItems) ? inv.lineItems : []).map(projectInvoiceLine),
    discount: num0(inv.discount),
    discountType: inv.discountType === "percent" ? "percent" : "amount",
    tax: num0(inv.tax),
    grandTotal: num0(inv.grandTotal),
    status: str(inv.status),
    paidAmount: num0(inv.paidAmount),
    balanceDue: num0(inv.balanceDue),
    payments: projectPayments(inv.payments),
  };
}

// ── Bookings / feedback ───────────────────────────────────────────────────────

export function projectPortalBooking(id, b = {}) {
  return {
    id,
    plateNumber: str(b.plateNumber) ?? "",
    requestedDate: str(b.requestedDate) ?? "",
    requestedSlot: str(b.requestedSlot) ?? "",
    status: str(b.status),
    // Shown only on a rejected booking; anything else stays internal.
    rejectionReason: b.status === "rejected" ? str(b.rejectionReason) : null,
    createdAtMillis: millis(b.createdAt),
  };
}

export function projectPortalFeedback(id, f = {}) {
  return {
    id,
    type: str(f.type),
    message: str(f.message) ?? "",
    status: str(f.status),
    createdAtMillis: millis(f.createdAt),
  };
}
