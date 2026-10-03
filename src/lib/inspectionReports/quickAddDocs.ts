// ── Quick-add: the documents and validation (pure) ───────────────────────────
//
// An inspection can be started for a customer who isn't registered yet. The
// quick-add flow then creates a REAL customer and vehicle in the normal
// collections — indistinguishable from ones made on the Add Customer / Add
// Vehicle pages (no flag, no special handling), so they show up in the normal
// lists and use the customer portal like anyone else.
//
// This file DUPLICATES the field shapes and validation of those two pages on
// purpose (AddCustomerPage.doCreate, AddVehiclePage.doSave — the existing pages
// are not edited by this feature). quickAddDocs.test.ts reads both page sources
// and fails if their field sets drift from the ones here.
//
// One deliberate difference: nextServiceMileageKm is written as null. Add
// Vehicle defaults it to mileage + 5000 when a mileage is typed; a quick-added
// vehicle gets no reminder data, and this feature never writes mileage back to
// a vehicle afterwards.
import { normaliseLocalPhone } from "../../../functions/shared/phone.mjs";

/** "+94771234567", or null when the input isn't a Sri Lankan number. Same
 *  normaliser as login/SMS, rendered in the form customers are stored in. */
export function toStoredCustomerPhone(raw: string): string | null {
  const local = normaliseLocalPhone(raw);
  // The login normaliser also accepts any bare 9 digits; a national number never
  // starts with 0 (that's the trunk prefix), so "077123456" is a typo, not a number.
  return local && /^[1-9]\d{8}$/.test(local) ? `+94${local}` : null;
}

/** True when a search box entry should be treated as a phone number. */
export function looksLikePhone(raw: string): boolean {
  return /^[\d\s+\-().]{7,}$/.test(raw.trim()) && toStoredCustomerPhone(raw) !== null;
}

/** Upper-cased, trimmed — how a plate is stored. */
export const storedPlate = (raw: string) => raw.trim().toUpperCase();

// ── Customer ─────────────────────────────────────────────────────────────────

export interface QuickCustomerInput { name: string; phone: string }

export function validateQuickCustomer(i: QuickCustomerInput): Record<string, string> {
  const errs: Record<string, string> = {};
  const name = i.name.trim();
  if (!name) errs.name = "Name is required";
  else if (name.length < 2 || name.length > 80) errs.name = "Name must be 2–80 characters";
  if (!i.phone.trim()) errs.phone = "Phone number is required";
  else if (!toStoredCustomerPhone(i.phone)) errs.phone = "Enter a valid Sri Lanka number (07X XXX XXXX or +94XXXXXXXXX)";
  return errs;
}

export function buildCustomerDoc<T>(centerId: string, i: QuickCustomerInput, now: T) {
  return {
    name: i.name.trim(),
    phone: toStoredCustomerPhone(i.phone)!,
    smsLanguage: "english" as const,
    notes: null,
    isDeleted: false,
    vehicleCount: 0,
    lastServiceDate: null,
    createdAt: now,
    centerId,
  };
}

// ── Vehicle ──────────────────────────────────────────────────────────────────

export interface QuickVehicleInput {
  plate: string;
  make: string;
  model: string;
  vehicleType: string;
  /** Raw text from the field; blank = not recorded. */
  mileage: string;
}

export function validateQuickVehicle(i: QuickVehicleInput): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!i.plate.trim()) errs.plate = "Plate number is required";
  if (!i.vehicleType.trim()) errs.vehicleType = "Vehicle type is required";
  if (i.mileage.trim() !== "") {
    const km = parseInt(i.mileage, 10);
    if (isNaN(km) || km < 0) errs.mileage = "Mileage must be 0 or greater";
  }
  return errs;
}

export function buildVehicleDoc<T>(
  centerId: string, customer: { id: string; name: string }, i: QuickVehicleInput, now: T,
) {
  const km = i.mileage.trim() === "" ? null : parseInt(i.mileage, 10);
  return {
    plateNumber: storedPlate(i.plate),
    make: i.make.trim() || null,
    model: i.model.trim() || null,
    vehicleType: i.vehicleType.trim(),
    colour: null,
    customerId: customer.id,
    customerName: customer.name,
    currentMileageKm: km,
    // Deliberately null — see the file header.
    nextServiceMileageKm: null,
    oilBrand: null,
    oilGrade: null,
    oilViscosityNotes: null,
    centerId,
    isDeleted: false,
    updatedAt: now,
    photoUrls: [] as string[],
    createdAt: now,
  };
}
