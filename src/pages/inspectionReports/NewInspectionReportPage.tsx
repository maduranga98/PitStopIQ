import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Car, Loader2, Search, UserPlus } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { useCachedRefList } from "../../hooks/useCachedRefList";
import { boundedGetDoc } from "../../lib/firestoreRead";
import { doc } from "firebase/firestore";
import { db } from "../../config/firebase";
import { fetchTechnicians, invalidateRefData } from "../../lib/refData";
import { staffDisplayName } from "../../lib/jobTechnicians";
import { searchVehiclesByPlate } from "../../lib/search";
import { DEFAULT_VEHICLE_TYPES } from "../../lib/vehicleOptions";
import { ensureTemplate } from "../../lib/inspectionReports/templates";
import { createDraftReport } from "../../lib/inspectionReports/reports";
import {
  createQuickCustomer, createQuickVehicle, findCustomerByPhone, findVehicleByPlate,
  findVehiclesForCustomer, loadVehicleAndCustomer,
} from "../../lib/inspectionReports/quickAdd";
import {
  looksLikePhone, validateQuickCustomer, validateQuickVehicle,
} from "../../lib/inspectionReports/quickAddDocs";
import type { InspectionReportType } from "../../types/inspectionReports";
import type { Customer, Vehicle } from "../../types/auth";

const field = "w-full bg-[#0B1120] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#F97316]/60";
const label = "block text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-1.5";

interface Picked { vehicle: Vehicle; customer: Customer }
type Resolution =
  | { kind: "vehicle"; vehicle: Vehicle; customer: Customer }
  | { kind: "customer"; customer: Customer };

export default function NewInspectionReportPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const centerId = currentUser?.centerId;
  const role = currentUser?.role;
  const mayCreate = usePermission("inspectionReports.create");
  const canCreate = (role === "Owner" || role === "Manager") && mayCreate;

  const [type, setType] = useState<InspectionReportType>("checklist");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [term, setTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [vehicleHits, setVehicleHits] = useState<Vehicle[]>([]);
  const [customerHit, setCustomerHit] = useState<Customer | null>(null);
  const [searched, setSearched] = useState(false);

  const [quick, setQuick] = useState(false);
  const [q, setQ] = useState({ name: "", phone: "", plate: "", make: "", model: "", vehicleType: DEFAULT_VEHICLE_TYPES[0] ?? "", mileage: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [resolution, setResolution] = useState<Resolution | null>(null);

  const [mileage, setMileage] = useState("");
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const searchSeq = useRef(0);

  const { data: technicians } = useCachedRefList(canCreate ? centerId : undefined, fetchTechnicians, (id) => invalidateRefData(id, "staff"));

  const pick = (p: Picked) => {
    setPicked(p);
    setMileage(p.vehicle.currentMileageKm != null ? String(p.vehicle.currentMileageKm) : "");
    setQuick(false); setResolution(null); setVehicleHits([]); setCustomerHit(null);
  };

  // Opened from a vehicle page.
  const presetId = params.get("vehicleId");
  useEffect(() => {
    if (!centerId || !presetId) return;
    let active = true;
    loadVehicleAndCustomer(centerId, presetId).then((p) => { if (active && p) pick(p); }).catch(() => {});
    return () => { active = false; };
  }, [centerId, presetId]);

  // Debounced lookup: a phone number finds the customer and their vehicles, anything else is a plate prefix.
  useEffect(() => {
    const text = term.trim();
    if (!centerId || picked || text.length < 2) return;
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        if (looksLikePhone(text)) {
          const c = await findCustomerByPhone(centerId, text);
          const vs = c ? await findVehiclesForCustomer(centerId, c.id) : [];
          if (seq === searchSeq.current) { setCustomerHit(c); setVehicleHits(vs); }
        } else {
          const vs = await searchVehiclesByPlate(centerId, text, 8);
          if (seq === searchSeq.current) { setCustomerHit(null); setVehicleHits(vs); }
        }
      } catch {
        if (seq === searchSeq.current) { setCustomerHit(null); setVehicleHits([]); }
      } finally {
        if (seq === searchSeq.current) { setSearching(false); setSearched(true); }
      }
    }, 350);
    return () => clearTimeout(t);
  }, [term, centerId, picked]);

  async function chooseVehicle(v: Vehicle) {
    if (!centerId) return;
    setError("");
    try {
      const cSnap = await boundedGetDoc(doc(db, "servicecenters", centerId, "customers", v.customerId));
      if (!cSnap.exists()) throw new Error("customer missing");
      pick({ vehicle: v, customer: { id: cSnap.id, ...cSnap.data() } as Customer });
    } catch { setError("Couldn't load that vehicle's customer. Try again."); }
  }

  function startQuickAdd() {
    const text = term.trim();
    setQ((s) => ({ ...s, phone: looksLikePhone(text) ? text : s.phone, plate: !looksLikePhone(text) && text ? text.toUpperCase() : s.plate }));
    setQuick(true); setResolution(null); setErrors({});
  }

  /** Match first (plate, then phone); only when neither exists are real records created. */
  async function submitQuick() {
    if (!centerId || !currentUser || busy) return;
    const errs = { ...validateQuickCustomer(q), ...validateQuickVehicle(q) };
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError("");
    try {
      const existingVehicle = await findVehicleByPlate(centerId, q.plate);
      if (existingVehicle) {
        const cSnap = await boundedGetDoc(doc(db, "servicecenters", centerId, "customers", existingVehicle.customerId));
        if (cSnap.exists()) { setResolution({ kind: "vehicle", vehicle: existingVehicle, customer: { id: cSnap.id, ...cSnap.data() } as Customer }); return; }
      }
      const existingCustomer = await findCustomerByPhone(centerId, q.phone);
      if (existingCustomer) { setResolution({ kind: "customer", customer: existingCustomer }); return; }
      await createRecords(null);
    } catch { setError("Couldn't check for existing records. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  async function createRecords(customer: Customer | null) {
    if (!centerId || !currentUser) return;
    setBusy(true); setError("");
    try {
      const c = customer ?? await createQuickCustomer(centerId, { name: q.name, phone: q.phone });
      const v = await createQuickVehicle(centerId, currentUser, c, q);
      pick({ vehicle: v, customer: c });
    } catch { setError("Couldn't save the customer and vehicle. Please try again."); }
    finally { setBusy(false); }
  }

  async function start() {
    if (!picked || !centerId || !currentUser || busy) return;
    setBusy(true); setError("");
    try {
      const template = await ensureTemplate(centerId);
      const km = mileage.trim() === "" ? null : parseInt(mileage, 10);
      const tech = technicians.find((t) => t.id === assignee);
      const id = await createDraftReport({
        centerId, type, template,
        vehicleId: picked.vehicle.id, customerId: picked.customer.id,
        header: {
          customerName: picked.customer.name, customerPhone: picked.customer.phone,
          plateNumber: picked.vehicle.plateNumber, make: picked.vehicle.make ?? "",
          model: picked.vehicle.model ?? "", vehicleType: picked.vehicle.vehicleType ?? "",
        },
        mileage: km != null && !isNaN(km) && km >= 0 ? km : null,
        createdBy: currentUser.uid,
        inspectorUid: currentUser.uid,
        inspectorName: currentUser.displayName || "",
        assignedToUid: tech?.id ?? null,
        assignedToName: tech ? staffDisplayName(tech) : "",
      });
      navigate(`/inspection-reports/${id}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the report. Try again.");
      setBusy(false);
    }
  }

  if (!canCreate) return <Navigate to="/inspection-reports" replace />;

  return (
    <div className="min-h-screen bg-[#0B1120] text-white pb-16">
      <div className="border-b border-white/10 bg-[#0B1120]/90 backdrop-blur sticky top-0 z-20">
        <div className="max-w-xl mx-auto px-4 py-3 flex items-center gap-2">
          <button onClick={() => navigate("/inspection-reports")} aria-label="Back" className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-base font-bold">New inspection report</h1>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 pt-5 space-y-5">
        <div>
          <label className={label}>Report type</label>
          <div className="grid grid-cols-2 gap-2">
            {([["checklist", "Checklist", "Full inspection"], ["diagnostic", "Diagnostic", "Scan findings + files"]] as const).map(([v, t, d]) => (
              <button key={v} type="button" onClick={() => setType(v)} aria-pressed={type === v}
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${type === v ? "border-[#F97316]/60 bg-[#F97316]/10" : "border-white/10 hover:border-white/25"}`}>
                <p className="text-sm font-semibold">{t}</p><p className="text-[11px] text-gray-500">{d}</p>
              </button>
            ))}
          </div>
        </div>

        {picked ? (
          <div className="bg-[#162032] border border-white/10 rounded-xl p-4 flex items-start gap-3">
            <Car className="w-5 h-5 text-[#F97316] mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{picked.vehicle.plateNumber}</p>
              <p className="text-xs text-gray-400">{[picked.vehicle.make, picked.vehicle.model].filter(Boolean).join(" ") || picked.vehicle.vehicleType}</p>
              <p className="text-xs text-gray-500">{picked.customer.name} · {picked.customer.phone}</p>
            </div>
            {!presetId && <button onClick={() => { setPicked(null); setTerm(""); setSearched(false); }} className="text-xs text-gray-400 hover:text-white">Change</button>}
          </div>
        ) : !quick ? (
          <div className="space-y-3">
            <div>
              <label className={label}>Vehicle or customer</label>
              <div className="relative">
                <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input className={`${field} pl-9`} value={term} onChange={(e) => { setTerm(e.target.value); setSearched(false); }} placeholder="Plate number or customer phone" autoFocus />
                {searching && <Loader2 className="w-4 h-4 text-gray-500 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />}
              </div>
            </div>
            {customerHit && <p className="text-xs text-gray-400">{customerHit.name} · {customerHit.phone}{vehicleHits.length === 0 && " — no vehicles registered"}</p>}
            <div className="space-y-2">
              {vehicleHits.map((v) => (
                <button key={v.id} type="button" onClick={() => chooseVehicle(v)}
                  className="w-full text-left bg-[#162032] border border-white/10 hover:border-[#F97316]/40 rounded-xl px-4 py-3">
                  <p className="text-sm font-semibold">{v.plateNumber}</p>
                  <p className="text-xs text-gray-500">{[v.make, v.model].filter(Boolean).join(" ") || v.vehicleType} · {v.customerName}</p>
                </button>
              ))}
            </div>
            {searched && !searching && vehicleHits.length === 0 && !customerHit && <p className="text-xs text-gray-500">No match for “{term.trim()}”.</p>}
            <button type="button" onClick={startQuickAdd} className="flex items-center gap-1.5 text-sm text-[#F97316] hover:text-orange-300">
              <UserPlus className="w-4 h-4" /> Customer not registered? Add customer &amp; vehicle
            </button>
          </div>
        ) : (
          <div className="bg-[#162032] border border-white/10 rounded-xl p-4 space-y-3">
            <h2 className="text-sm font-semibold">Add customer &amp; vehicle</h2>
            <p className="text-[11px] text-gray-500">Saved as a normal customer and vehicle. We check for existing ones first.</p>
            {([["name", "Customer name", "Kamal Perera"], ["phone", "Phone", "077 123 4567"], ["plate", "Plate number", "CAB-1234"], ["make", "Make", "Toyota"], ["model", "Model", "Aqua"], ["mileage", "Mileage (km)", "Optional"]] as const).map(([k, l, ph]) => (
              <div key={k}>
                <label className={label}>{l}</label>
                <input className={`${field} ${errors[k] ? "border-red-500" : ""}`} value={q[k]} placeholder={ph} inputMode={k === "mileage" ? "numeric" : undefined}
                  onChange={(e) => setQ((s) => ({ ...s, [k]: e.target.value }))} />
                {errors[k] && <p className="text-xs text-red-400 mt-1">{errors[k]}</p>}
              </div>
            ))}
            <div>
              <label className={label}>Vehicle type</label>
              <input className={`${field} ${errors.vehicleType ? "border-red-500" : ""}`} list="ir-vehicle-types" value={q.vehicleType} onChange={(e) => setQ((s) => ({ ...s, vehicleType: e.target.value }))} />
              <datalist id="ir-vehicle-types">{DEFAULT_VEHICLE_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
              {errors.vehicleType && <p className="text-xs text-red-400 mt-1">{errors.vehicleType}</p>}
            </div>

            {resolution ? (
              <div className="rounded-lg border border-[#F97316]/30 bg-[#F97316]/5 p-3 space-y-2">
                {resolution.kind === "vehicle" ? (<>
                  <p className="text-sm">{resolution.vehicle.plateNumber} is already registered to <b>{resolution.customer.name}</b> ({resolution.customer.phone}).</p>
                  <button type="button" onClick={() => pick({ vehicle: resolution.vehicle, customer: resolution.customer })} className="rounded-lg bg-[#F97316] px-3 py-2 text-xs font-semibold text-white">Use this vehicle</button>
                </>) : (<>
                  <p className="text-sm">A customer with this phone already exists: <b>{resolution.customer.name}</b> ({resolution.customer.phone}).</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={busy} onClick={() => createRecords(resolution.customer)} className="rounded-lg bg-[#F97316] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Use {resolution.customer.name} and add the vehicle</button>
                    <button type="button" disabled={busy} onClick={() => createRecords(null)} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-gray-300 disabled:opacity-50">Different person — add new customer</button>
                  </div>
                </>)}
              </div>
            ) : (
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={submitQuick} disabled={busy} className="rounded-lg bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white">
                  {busy ? "Checking…" : "Continue"}
                </button>
                <button type="button" onClick={() => setQuick(false)} className="px-3 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
              </div>
            )}
          </div>
        )}

        {picked && (
          <div className="space-y-3">
            <div>
              <label className={label}>Mileage (km)</label>
              <input className={field} inputMode="numeric" value={mileage} placeholder="Optional" onChange={(e) => setMileage(e.target.value.replace(/\D/g, "").slice(0, 7))} />
              <p className="text-[11px] text-gray-600 mt-1">Recorded on this report only — the vehicle's own mileage isn't changed.</p>
            </div>
            <div>
              <label className={label}>Assign to technician</label>
              <select className={field} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Don't assign</option>
                {technicians.map((t) => <option key={t.id} value={t.id}>{staffDisplayName(t)}</option>)}
              </select>
            </div>
            <button type="button" onClick={start} disabled={busy}
              className="w-full rounded-xl bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-50 py-3 text-sm font-semibold text-white">
              {busy ? "Starting…" : "Start report"}
            </button>
          </div>
        )}

        {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
      </div>
    </div>
  );
}
