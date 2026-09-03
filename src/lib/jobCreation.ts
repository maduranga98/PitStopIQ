// Shared ServiceJob creation logic. Both a staff-created job
// (src/pages/services/NewServicePage.tsx) and a booking converted at
// check-in (src/pages/bookings/BookingsPage.tsx) go through here, so a job
// is only ever assembled in one place.
import {
  collection, query, where, getDocs, orderBy, limit, Timestamp,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { safeAddDoc } from "./firestoreWrite";
import { catalogPrice, resolveServiceItem } from "./servicePricing";
import { technicianFields, type JobTechnician } from "./jobTechnicians";
import type { PartUsed, ServicePriceItem, Vehicle, VehicleType } from "../types/auth";

/** Next sequential job number for the current month, e.g. "2607-0004". */
export async function generateJobNumber(centerId: string): Promise<string> {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `${yyyy}-${mm}-`;

  // Order by jobNumber (a plain string set immediately) rather than
  // createdAt (a serverTimestamp) — see NewServicePage for why.
  const snap = await getDocs(
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
}

/**
 * Creates a ServiceJob (status "pending") and its auto-generated invoice from
 * the selected services, exactly as NewServicePage does for a walk-in. Does
 * NOT check for an already-open job on the vehicle or update its mileage —
 * callers that need that (NewServicePage) do it themselves around this call.
 */
export async function createServiceJob(params: CreateServiceJobParams): Promise<string> {
  const {
    centerId, customerId, customerName, customerPhone, vehicle, mileageIn, crew,
    departmentId, departmentName, inspectorId, inspectorName, services, customServices,
    internalNotes, catalog, partsUsed, recordMileage = true,
  } = params;

  const jobNumber = await generateJobNumber(centerId);
  const vehicleType: VehicleType | undefined = vehicle.vehicleType;

  const resolveCatalogItem = (name: string) => resolveServiceItem(catalog, name, vehicleType);

  const ref = await safeAddDoc(collection(db, "servicecenters", centerId, "jobs"), {
    jobNumber,
    vehicleId: vehicle.id,
    plateNumber: vehicle.plateNumber,
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
    // leaving it undefined is what the completion SMS reads to skip the
    // mileage line and send the thank-you-only template instead.
    ...(recordMileage ? { nextServiceMileageKm: vehicle.nextServiceMileageKm } : {}),
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
    internalNotes: (internalNotes ?? "").trim(),
    status: "pending",
    partsUsed: partsUsed ?? [],
    smsSent: false,
    centerId,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });

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
      };
    }),
  ];
  if (lineItems.length > 0) {
    const subtotal = lineItems.reduce((s, li) => s + li.lineTotal, 0);
    const invoiceNumber = `${jobNumber}-INV`;
    await safeAddDoc(collection(db, "servicecenters", centerId, "invoices"), {
      invoiceNumber,
      serviceId: ref.id,
      customerId,
      customerName,
      customerPhone,
      vehicleId: vehicle.id,
      plateNumber: vehicle.plateNumber,
      serviceDate: Timestamp.now(),
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
    });
  }

  return ref.id;
}
