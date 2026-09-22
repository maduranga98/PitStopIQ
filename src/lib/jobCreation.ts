// Shared ServiceJob creation logic. Both a staff-created job
// (src/pages/services/NewServicePage.tsx) and a booking converted at
// check-in (src/pages/bookings/BookingsPage.tsx) go through here, so a job
// is only ever assembled in one place.
import {
  collection, doc, query, where, orderBy, limit, Timestamp,
  type DocumentReference, type WriteBatch,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { safeAddDoc, safeWriteBatch } from "./firestoreWrite";
import { boundedGetDocs } from "./firestoreRead";
import { catalogPrice, resolveServiceItem } from "./servicePricing";
import { technicianFields, type JobTechnician } from "./jobTechnicians";
import { syncServiceLines } from "./serviceLines";
import type { JobServiceLine, PartUsed, ServicePriceItem, Vehicle, VehicleType } from "../types/auth";

/** Next sequential job number for the current month, e.g. "2607-0004". */
export async function generateJobNumber(centerId: string): Promise<string> {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `${yyyy}-${mm}-`;

  // Order by jobNumber (a plain string set immediately) rather than
  // createdAt (a serverTimestamp) — see NewServicePage for why.
  //
  // Bounded (lib/firestoreRead.ts): this used to be a bare getDocs, with no
  // timeout of its own — on a connection that stalls mid-read the promise
  // never settles, and since this runs INSIDE handleSubmit before the job
  // document is even written, that's the Create button stuck on "Creating…"
  // forever with no error, which is exactly what it looked like on a tablet
  // with a flaky connection. Bounded falls back to the offline cache after
  // its budget, and failing that raises a real, catchable error instead.
  const snap = await boundedGetDocs(
    query(
      collection(db, "servicecenters", centerId, "jobs"),
      where("jobNumber", ">=", prefix),
      where("jobNumber", "<=", prefix + "￿"),
      orderBy("jobNumber", "desc"),
      limit(1),
    ),
  );

  let nextNum = 1;
  if (!snap.empty) {
    const last = snap.docs[0].data().jobNumber as string | undefined;
    if (last && last.startsWith(prefix)) {
      const n = parseInt(last.slice(prefix.length), 10);
      if (!isNaN(n)) nextNum = n + 1;
    }
  }

  return prefix + String(nextNum).padStart(4, "0");
}

export interface CreateServiceJobParams {
  centerId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  vehicle: Vehicle;
  mileageIn: number;
  crew: JobTechnician[];
  departmentId?: string | null;
  departmentName?: string | null;
  inspectorId?: string | null;
  inspectorName?: string | null;
  services: string[];
  customServices: string[];
  internalNotes?: string;
  /** Service price catalog, used to price the auto-generated invoice. */
  catalog: ServicePriceItem[];
  /** Parts pulled from inventory at creation time, alongside the crew. */
  partsUsed?: PartUsed[];
  /** Whether this job tracks mileage/next-service. Defaults to true. */
  recordMileage?: boolean;
  /**
   * The reading the next service falls due at, when it was given on the job
   * form. Omitted means "as the vehicle has it" — the vehicle's own
   * next-service reading is snapshotted instead, which is what every caller
   * did before this could be typed at intake.
   */
  nextServiceMileageKm?: number;
  /**
   * Per-service assignment for the optional bay-workflow / commission modules
   * — who performs each service and which bay it goes to. Omitted by every
   * caller at a center running neither, in which case the job is written with
   * no `serviceLines` field at all and is byte-for-byte what it was before
   * these modules existed.
   */
  serviceLines?: JobServiceLine[];
  /** Whether `serviceLines` should carry bay progress. Defaults to false. */
  bayWorkflowEnabled?: boolean;
  /**
   * A job taken in for a vehicle that simply turned up: nothing is
   * registered, so `customerId` and `vehicle.id` are blank and the plate is
   * the whole identity. It is what tells the job card not to offer a
   * customer page or a vehicle history for it, and what marks the job's
   * invoice as a walk-in bill.
   */
  walkIn?: boolean;
  /**
   * Written into the job's CREATE data rather than set afterwards. A waiver
   * captured during creation used to mean a second write to a document that
   * was seconds old; folding the flag into the create data removes that write
   * entirely, and the flag can no longer be left behind if the app is closed
   * between the two.
   */
  signatureCaptured?: boolean;
  /**
   * Extra writes to ride in the job's OWN batch. Only for documents whose
   * security rules match `jobs` create EXACTLY — today that is the waiver
   * under `jobs/{id}/signature`, and nothing else.
   *
   * This matters more than it looks: one denied write cancels a whole
   * Firestore batch. `invoices` (Owner/Manager/Cashier), `vehicles` and
   * `bookings` (Owner/Manager/Receptionist) all allow a different set of
   * roles than `jobs` (Owner/Manager/Receptionist/Technician), so batching
   * any of them with the job would stop Receptionists and Technicians
   * creating jobs at all. Those go through `alongside` instead.
   */
  extraWrites?: (batch: WriteBatch, jobRef: DocumentReference) => void;
  /**
   * Independent writes to START at the same time as the job, but NOT to share
   * its batch — writes whose rules differ from job create (the vehicle's
   * mileage). Each is its own request, so one being denied fails only itself.
   * Return the promises; they are awaited together with the job's.
   */
  alongside?: (jobRef: DocumentReference) => Promise<unknown>[];
}

/**
 * Creates a ServiceJob (status "pending") and its auto-generated invoice from
 * the selected services, exactly as NewServicePage does for a walk-in. Does
 * NOT check for an already-open job on the vehicle, and does not update its
 * mileage itself — the caller that needs that (NewServicePage) passes the
 * write through `alongside` so it goes out WITH the job rather than after it.
 */
export async function createServiceJob(params: CreateServiceJobParams): Promise<string> {
  const {
    centerId, customerId, customerName, customerPhone, vehicle, mileageIn, crew,
    departmentId, departmentName, inspectorId, inspectorName, services, customServices,
    internalNotes, catalog, partsUsed, recordMileage = true, nextServiceMileageKm,
    serviceLines,
    bayWorkflowEnabled = false, walkIn = false, signatureCaptured,
    extraWrites, alongside,
  } = params;

  const jobNumber = await generateJobNumber(centerId);
  const vehicleType: VehicleType | undefined = vehicle.vehicleType;

  const resolveCatalogItem = (name: string) => resolveServiceItem(catalog, name, vehicleType);

  // The id is generated client-side so the invoice (which references it) and
  // the waiver (which hangs off it) can be written WITHOUT first waiting for
  // the job's own write to come back. `doc()` on a collection does no I/O.
  const jobRef = doc(collection(db, "servicecenters", centerId, "jobs"));

  const jobData = {
    jobNumber,
    // Blank for a walk-in — there is no vehicle record behind the plate.
    vehicleId: vehicle.id,
    plateNumber: vehicle.plateNumber,
    ...(walkIn ? { walkIn: true } : {}),
    customerId,
    customerName,
    customerPhone,
    make: vehicle.make ?? "",
    model: vehicle.model ?? "",
    year: vehicle.year ?? null,
    vehicleType: vehicleType ?? "",
    mileageIn,
    recordMileage,
    // A job that isn't tracking mileage has no "next service" to snapshot —
    // leaving the key off is what the completion SMS reads to skip the mileage
    // line and send the thank-you-only template instead. Where it IS tracked, a
    // reading typed at intake wins over the vehicle's own; with neither, the
    // key is still left off, exactly as a job on a vehicle with no next-service
    // reading has always been written.
    ...(recordMileage && (nextServiceMileageKm ?? vehicle.nextServiceMileageKm) != null
      ? { nextServiceMileageKm: nextServiceMileageKm ?? vehicle.nextServiceMileageKm }
      : {}),
    oilBrand: vehicle.oilBrand ?? "",
    oilGrade: vehicle.oilGrade ?? "",
    oilViscosityNotes: vehicle.oilViscosityNotes ?? "",
    ...technicianFields(crew),
    departmentId: departmentId ?? null,
    departmentName: departmentName ?? null,
    inspectorId: inspectorId ?? null,
    inspectorName: inspectorName ?? null,
    services,
    customServices,
    // Reconciled against the service names actually being saved, so a line can
    // never name a service that isn't on the job. Left off entirely when the
    // caller passed none.
    ...(serviceLines
      ? {
          serviceLines: syncServiceLines(
            serviceLines, services, customServices, catalog, vehicleType, bayWorkflowEnabled,
          ),
        }
      : {}),
    internalNotes: (internalNotes ?? "").trim(),
    status: "pending",
    partsUsed: partsUsed ?? [],
    smsSent: false,
    centerId,
    // Set at create time rather than by a follow-up write — see the param.
    ...(signatureCaptured ? { signatureCaptured: true } : {}),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };

  const lineItems = [
    ...services.map((name) => {
      const c = resolveCatalogItem(name);
      const price = c ? catalogPrice(c) : 0;
      return { description: name, qty: 1, unitPrice: price, lineTotal: price, type: "service" as const };
    }),
    ...customServices.map((name) => ({ description: name, qty: 1, unitPrice: 0, lineTotal: 0, type: "service" as const })),
    // Parts picked at creation time show as their own group on the invoice,
    // same as parts added later from the job card (see ServiceDetailPage's
    // createDraftInvoice, which recomputes this line-up on every sync).
    ...(partsUsed ?? []).map((p) => {
      const price = p.unitPrice ?? p.unitCost ?? 0;
      return {
        description: p.itemName,
        qty: p.quantity,
        unitPrice: price,
        lineTotal: price * p.quantity,
        type: "part" as const,
        ...(p.partNumber ? { partNumber: p.partNumber } : {}),
        // Carried through from the job's own snapshot — the bill's Warranty
        // table is printed from these.
        ...(p.brand ? { brand: p.brand } : {}),
        ...(p.warranty ? { warranty: p.warranty } : {}),
      };
    }),
  ];
  // ── Everything is started, then awaited together ────────────────────────────
  // These used to be awaited one after the other — job, then invoice, then
  // (in NewServicePage) the vehicle's mileage and the waiver. The write
  // helpers resolve immediately offline but wait for the SERVER ack when
  // online (see firestoreWrite.ts), so online that was four to six round
  // trips in a row, each one also committed to IndexedDB first. On an older
  // phone that is most of the wait after tapping Create.
  //
  // None of them depends on another's RESULT — only on the job's id, which is
  // already known above — so they are all started here and awaited once. The
  // job and its waiver share a batch; the invoice and the `alongside` writes
  // are separate requests precisely because their rules allow different roles
  // (see `extraWrites`).
  const writes: Promise<unknown>[] = [];

  writes.push(safeWriteBatch(`job ${jobNumber}`, (batch) => {
    batch.set(jobRef, jobData);
    extraWrites?.(batch, jobRef);
  }));

  if (lineItems.length > 0) {
    const subtotal = lineItems.reduce((s, li) => s + li.lineTotal, 0);
    const invoiceNumber = `${jobNumber}-INV`;
    writes.push(safeAddDoc(collection(db, "servicecenters", centerId, "invoices"), {
      invoiceNumber,
      serviceId: jobRef.id,
      // A walk-in job bills as a walk-in: no customer page, no SMS offer.
      ...(walkIn ? { walkIn: true } : {}),
      customerId,
      customerName,
      customerPhone,
      vehicleId: vehicle.id,
      plateNumber: vehicle.plateNumber,
      serviceDate: Timestamp.now(),
      // Odometer, snapshotted from the job the bill belongs to. Re-synced by
      // createDraftInvoice when the job is marked done, so the final bill
      // carries the reading it actually went out on. Whether it PRINTS is the
      // center's `invoiceMileageEnabled` setting.
      ...(recordMileage
        ? {
            mileageIn,
            ...(jobData.nextServiceMileageKm != null
              ? { nextServiceMileageKm: jobData.nextServiceMileageKm }
              : {}),
          }
        : {}),
      lineItems,
      subtotal,
      discount: 0,
      discountType: "amount",
      tax: 0,
      grandTotal: subtotal,
      status: "pending",
      paidAmount: 0,
      balanceDue: subtotal,
      centerId,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }));
  }

  if (alongside) writes.push(...alongside(jobRef));

  // allSettled rather than all: a rejection must not reach the caller while
  // the job's own batch is still in flight. Promise.all would reject the
  // moment the FIRST write failed, so the Create button would come back with
  // an error while the job write was still pending — and a quick second tap
  // would run the open-job check against a job that had not landed yet. This
  // waits for every write either way, then re-throws the first rejection, so
  // a failed write still fails the call exactly as it did before. Success
  // timing is unchanged: the slowest write decides it in both designs.
  const results = await Promise.allSettled(writes);
  const failed = results.find((r) => r.status === "rejected");
  if (failed) throw (failed as PromiseRejectedResult).reason;

  return jobRef.id;
}
