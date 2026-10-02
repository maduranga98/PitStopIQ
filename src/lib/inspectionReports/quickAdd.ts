// ── Quick-add (IO) ───────────────────────────────────────────────────────────
// Finds an existing customer / vehicle first (by phone and by plate, using the
// same normalisation as login/SMS and the plate search mirror), and only
// creates real records when nothing matches. Documents come from
// quickAddDocs.ts. Owner/Manager only in practice: they are the only roles that
// create reports, and the existing rules let Owner/Manager/Receptionist write
// customers and vehicles.
import {
  Timestamp, arrayUnion, collection, doc, limit, query, where,
} from "firebase/firestore";
import { ref as storageRef, uploadString, getDownloadURL } from "firebase/storage";
import QRCode from "qrcode";
import { db, storage } from "../../config/firebase";
import { boundedGetDoc, boundedGetDocs } from "../firestoreRead";
import { safeAddDoc, safeSetDoc, safeUpdateDoc } from "../firestoreWrite";
import { getOrCreateShortLink, fullShortLink } from "../shortLinks";
import { buildViewLink } from "../smsTemplates";
import { logVehicleEvent } from "../vehicleLogs";
import { searchVehiclesByPlate, toSearchPlate } from "../search";
import { DEFAULT_VEHICLE_TYPES } from "../vehicleOptions";
import { invalidateRefData } from "../refData";
import type { AuthUser, Customer, Vehicle } from "../../types/auth";
import {
  buildCustomerDoc, buildVehicleDoc, storedPlate, toStoredCustomerPhone,
  type QuickCustomerInput, type QuickVehicleInput,
} from "./quickAddDocs";

const customersCol = (centerId: string) => collection(db, "servicecenters", centerId, "customers");
const vehiclesCol = (centerId: string) => collection(db, "servicecenters", centerId, "vehicles");

// ── Lookups ──────────────────────────────────────────────────────────────────

/** Same query Add Customer uses for its duplicate check. */
export async function findCustomerByPhone(centerId: string, rawPhone: string): Promise<Customer | null> {
  const phone = toStoredCustomerPhone(rawPhone);
  if (!phone) return null;
  const snap = await boundedGetDocs(
    query(customersCol(centerId), where("phone", "==", phone), where("isDeleted", "==", false), limit(1)),
  );
  return snap.empty ? null : ({ id: snap.docs[0].id, ...snap.docs[0].data() } as Customer);
}

export async function findVehiclesForCustomer(centerId: string, customerId: string): Promise<Vehicle[]> {
  const snap = await boundedGetDocs(
    query(vehiclesCol(centerId), where("customerId", "==", customerId), where("isDeleted", "==", false), limit(20)),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Vehicle));
}

/** The registered vehicle with exactly this plate (ignoring case, spaces and
 *  dashes), or null. Exact match as Add Vehicle does, then the separator-
 *  insensitive search mirror so "CAB 1234" finds "CAB-1234". */
export async function findVehicleByPlate(centerId: string, rawPlate: string): Promise<Vehicle | null> {
  const plate = storedPlate(rawPlate);
  if (!plate) return null;
  const exact = await boundedGetDocs(
    query(vehiclesCol(centerId), where("plateNumber", "==", plate), where("isDeleted", "==", false), limit(1)),
  );
  if (!exact.empty) return { id: exact.docs[0].id, ...exact.docs[0].data() } as Vehicle;
  const key = toSearchPlate(plate);
  const near = await searchVehiclesByPlate(centerId, plate, 5);
  return near.find((v) => toSearchPlate(v.plateNumber) === key) ?? null;
}

export async function loadVehicleAndCustomer(
  centerId: string, vehicleId: string,
): Promise<{ vehicle: Vehicle; customer: Customer } | null> {
  const vSnap = await boundedGetDoc(doc(vehiclesCol(centerId), vehicleId));
  if (!vSnap.exists()) return null;
  const vehicle = { id: vSnap.id, ...vSnap.data() } as Vehicle;
  const cSnap = await boundedGetDoc(doc(customersCol(centerId), vehicle.customerId));
  if (!cSnap.exists()) return null;
  return { vehicle, customer: { id: cSnap.id, ...cSnap.data() } as Customer };
}

// ── Creates (same writes as the Add Customer / Add Vehicle pages) ────────────

export async function createQuickCustomer(centerId: string, input: QuickCustomerInput): Promise<Customer> {
  const data = buildCustomerDoc(centerId, input, Timestamp.now());
  const ref = await safeAddDoc(customersCol(centerId), data);
  invalidateRefData(centerId, "customers");
  return { id: ref.id, ...data } as unknown as Customer;
}

export async function createQuickVehicle(
  centerId: string, actor: AuthUser, customer: Customer, input: QuickVehicleInput,
): Promise<Vehicle> {
  const data = buildVehicleDoc(centerId, { id: customer.id, name: customer.name }, input, Timestamp.now());

  // Newly typed make / model / type become reusable options, as on Add Vehicle.
  const optionUpdate: Record<string, unknown> = {};
  if (data.make) optionUpdate.customVehicleMakes = arrayUnion(data.make);
  if (data.model) optionUpdate.customVehicleModels = arrayUnion(data.model);
  if (!DEFAULT_VEHICLE_TYPES.includes(data.vehicleType)) optionUpdate.customVehicleTypes = arrayUnion(data.vehicleType);
  if (Object.keys(optionUpdate).length) {
    // Non-fatal, like on Add Vehicle: saving the vehicle is what matters.
    safeSetDoc(doc(db, "servicecenters", centerId), optionUpdate, { merge: true }).catch(() => {});
  }

  const ref = await safeAddDoc(vehiclesCol(centerId), data);
  invalidateRefData(centerId, "vehicles");
  void logVehicleEvent(centerId, ref.id, {
    type: "system",
    message: `Vehicle added — ${data.plateNumber}` +
      (data.currentMileageKm === null ? "" : `, ${data.currentMileageKm.toLocaleString()} km`),
    actor,
  });

  // The vehicle's QR (encodes the customer's short link). Best effort: it needs
  // a connection, and a vehicle without one is still a complete vehicle.
  void (async () => {
    try {
      const code = await getOrCreateShortLink(centerId, customer.id).catch(() => null);
      const target = code ? fullShortLink(code) : buildViewLink(centerId, customer.id);
      const dataUrl = await QRCode.toDataURL(target, { width: 300, margin: 2 });
      const qrRef = storageRef(storage, `servicecenters/${centerId}/vehicles/${ref.id}/qr.png`);
      await uploadString(qrRef, dataUrl, "data_url");
      await safeUpdateDoc(ref, { qrCodeUrl: await getDownloadURL(qrRef), qrEncodesShortLink: true });
    } catch { /* non-fatal */ }
  })();

  return { id: ref.id, ...data } as unknown as Vehicle;
}
