import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, query, where, getDocs, doc, getDoc,
  orderBy, serverTimestamp, onSnapshot,
} from "firebase/firestore";
import { safeUpdateDoc } from "../../lib/firestoreWrite";
import {
  catalogPrice, resolveServiceItem, vehicleTypeLabel, serviceNamesForVehicleType,
} from "../../lib/servicePricing";
import { createServiceJob } from "../../lib/jobCreation";
import { ArrowLeft, X, Car, AlertTriangle, ChevronRight, Settings as SettingsIcon, Tag, Check, Users, Package } from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import type { Customer, Vehicle, StaffMember, ServicePriceItem, InventoryItem, PartUsed } from "../../types/auth";
import { phoneMatches } from "../../lib/utils";
import { staffDisplayName } from "../../lib/jobTechnicians";
import { serviceCenterPriceOf, purchasePriceOf } from "../../lib/inventoryPricing";
import { searchInventoryItems } from "../../lib/inventorySearch";
import { formatKm } from "../../lib/vehicleMileage";
import { useTranslation } from "react-i18next";


export default function NewServicePage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
  }, [currentUser, navigate]);

  const [step, setStep] = useState(1);

  // Step 1: Customer (existing only)
  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
  const [allVehicles, setAllVehicles] = useState<{ customerId: string; plateNumber: string }[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");

  // Step 2: Vehicle (customer's only)
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);

  // Service catalog (priced)
  const [catalog, setCatalog] = useState<ServicePriceItem[]>([]);

  // Step 3: Job Details
  const [technicians, setTechnicians] = useState<StaffMember[]>([]);
  // A job can be shared by a crew — the mechanic, whoever washes it, whoever
  // does the AC. The first one picked is the lead.
  const [technicianIds, setTechnicianIds] = useState<string[]>([]);
  // Who should conduct the vehicle inspection — optional, and separate from
  // the crew working the job. Inspection itself now happens after the job is
  // started, from the job card, not at creation time.
  const [inspectorId, setInspectorId] = useState<string>("");
  const [mileageIn, setMileageIn] = useState("");
  // Whether to track mileage/next-service for this job at all. Off for a
  // quick job (a wash, a one-off oil top-up) that has no "next service" to
  // speak of — skips the mileage-in requirement here, the mileage-out prompt
  // at completion, and the mileage line in the completion SMS (thank-you only).
  const [recordMileage, setRecordMileage] = useState(true);
  // Parts taken from inventory, picked up front alongside the crew — same
  // stock deduction/billing path as adding them later from the job card, just
  // saved onto the job at creation instead of after.
  const [partsUsed, setPartsUsed] = useState<PartUsed[]>([]);
  const [partSearch, setPartSearch] = useState("");
  const [partResults, setPartResults] = useState<InventoryItem[]>([]);
  const [selectedPart, setSelectedPart] = useState<InventoryItem | null>(null);
  const [partQty, setPartQty] = useState("1");
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [customServiceInput, setCustomServiceInput] = useState("");
  const [customServices, setCustomServices] = useState<string[]>([]);
  const [internalNotes, setInternalNotes] = useState("");
  const [jobError, setJobError] = useState("");
  const [saving, setSaving] = useState(false);

  // Open job warning
  const [openJobWarning, setOpenJobWarning] = useState<{ jobId: string } | null>(null);

  const [centerPlan, setCenterPlan] = useState<"basic" | "pro">("basic");
  // Whether this center runs vehicle inspections at all — if so, Step 3 offers
  // to name an inspector; the inspection itself happens later, after the job
  // starts (see ServiceDetailPage).
  const [inspectionEnabled, setInspectionEnabled] = useState(false);

  // Load center inspection settings
  useEffect(() => {
    if (!currentUser?.centerId) return;
    getDoc(doc(db, "servicecenters", currentUser.centerId)).then((snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setCenterPlan(d.plan ?? "basic");
        setInspectionEnabled(d.inspectionEnabled === true);
      }
    });
  }, [currentUser?.centerId]);

  // Load all customers and vehicles for dropdown search
  useEffect(() => {
    if (!currentUser?.centerId) return;
    getDocs(
      query(
        collection(db, "servicecenters", currentUser.centerId, "customers"),
        where("isDeleted", "==", false),
        orderBy("name"),
      ),
    ).then((snap) => {
      setAllCustomers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
    });
    getDocs(
      query(
        collection(db, "servicecenters", currentUser.centerId, "vehicles"),
        where("isDeleted", "==", false),
      ),
    ).then((snap) => {
      setAllVehicles(snap.docs.map((d) => ({ customerId: d.data().customerId, plateNumber: d.data().plateNumber })));
    });
  }, [currentUser?.centerId]);

  // Load service catalog (live)
  useEffect(() => {
    if (!currentUser?.centerId) return;
    return onSnapshot(
      query(collection(db, "servicecenters", currentUser.centerId, "servicePrices"), orderBy("name")),
      (snap) => {
        setCatalog(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ServicePriceItem)));
      },
    );
  }, [currentUser?.centerId]);

  // Resolve the catalog entry that applies to a service for the selected
  // vehicle. Prices can be set per vehicle type, so this prefers an exact
  // vehicle-type match, then falls back to a general (no vehicleType) entry.
  const resolveCatalogItem = useCallback(
    (name: string): ServicePriceItem | undefined =>
      resolveServiceItem(catalog, name, selectedVehicle?.vehicleType),
    [catalog, selectedVehicle],
  );

  // The services on offer for THIS vehicle: those priced for its type, plus
  // the general (all-types) ones. A bike shouldn't be offered a wheel
  // alignment the workshop only prices for cars. With no vehicle picked yet —
  // or one with no type recorded — there is nothing to narrow by, so the whole
  // catalog shows.
  const catalogNames = serviceNamesForVehicleType(catalog, selectedVehicle?.vehicleType);

  // Load vehicles for selected customer
  useEffect(() => {
    if (!selectedCustomer || !currentUser?.centerId) return;
    getDocs(
      query(
        collection(db, "servicecenters", currentUser.centerId, "vehicles"),
        where("customerId", "==", selectedCustomer.id),
        where("isDeleted", "==", false),
      ),
    ).then((snap) => {
      setVehicles(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Vehicle)));
    });
  }, [selectedCustomer, currentUser?.centerId]);

  // Load technicians
  useEffect(() => {
    if (!currentUser?.centerId) return;
    getDocs(
      query(
        collection(db, "servicecenters", currentUser.centerId, "staff"),
        where("role", "==", "Technician"),
        where("active", "==", true),
      ),
    ).then((snap) => {
      setTechnicians(snap.docs.map((d) => ({ id: d.id, ...d.data() } as StaffMember)));
    });
  }, [currentUser?.centerId]);

  const handleSelectCustomer = useCallback((c: Customer) => {
    setSelectedCustomer(c);
    setCustomerDropdownOpen(false);
    setCustomerSearch("");
  }, []);

  const canAddParts = usePermission("jobs.addParts");

  // Part search (inventory) — matches by name or by item code.
  useEffect(() => {
    if (!partSearch.trim() || !currentUser?.centerId) { setPartResults([]); return; }
    const timer = setTimeout(async () => {
      const results = await searchInventoryItems(currentUser.centerId!, partSearch);
      setPartResults(results);
    }, 300);
    return () => clearTimeout(timer);
  }, [partSearch, currentUser?.centerId]);

  const addPart = () => {
    if (!selectedPart) return;
    const qty = parseInt(partQty, 10);
    if (isNaN(qty) || qty <= 0) return;
    setPartsUsed((prev) => {
      const existing = prev.find((p) => p.itemId === selectedPart.id);
      if (existing) {
        return prev.map((p) => p.itemId === selectedPart.id ? { ...p, quantity: p.quantity + qty } : p);
      }
      return [...prev, {
        itemId: selectedPart.id,
        itemName: selectedPart.name,
        ...(selectedPart.partNumber ? { partNumber: selectedPart.partNumber } : {}),
        quantity: qty,
        unitPrice: serviceCenterPriceOf(selectedPart),
        unitCost: serviceCenterPriceOf(selectedPart),
        costPrice: purchasePriceOf(selectedPart),
      }];
    });
    setSelectedPart(null);
    setPartSearch("");
    setPartQty("1");
    setPartResults([]);
  };

  const removePart = (itemId: string) => {
    setPartsUsed((prev) => prev.filter((p) => p.itemId !== itemId));
  };

  const toggleTechnician = (id: string) => {
    setTechnicianIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
    setJobError("");
  };

  const toggleService = (s: string) => {
    setSelectedServices((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  };

  const addCustomService = () => {
    const v = customServiceInput.trim();
    if (v && !customServices.includes(v)) {
      setCustomServices((prev) => [...prev, v]);
    }
    setCustomServiceInput("");
  };

  const handleSubmit = async () => {
    if (!currentUser?.centerId || !selectedCustomer || !selectedVehicle) return;
    // Assigning at least one technician is mandatory on Pro (role-based logins
    // let each technician be held accountable for their jobs) but optional on
    // Basic, where a service can be started without one.
    if (centerPlan === "pro" && technicianIds.length === 0) {
      setJobError("Select at least one technician");
      return;
    }
    const mi = parseInt(mileageIn, 10);
    if (recordMileage && (!mileageIn || isNaN(mi))) { setJobError("Enter mileage in"); return; }
    if (selectedServices.length === 0 && customServices.length === 0) {
      setJobError("Select at least one service");
      return;
    }
    setJobError("");
    setSaving(true);

    try {
      // Check for open jobs on this vehicle
      const openSnap = await getDocs(
        query(
          collection(db, "servicecenters", currentUser.centerId, "jobs"),
          where("vehicleId", "==", selectedVehicle.id),
          where("status", "in", ["pending", "in_progress"]),
        ),
      );
      // A deleted job can still carry an open status — it's hidden, not
      // resolved, so it shouldn't block (or be offered as) the open job here.
      const openJob = openSnap.docs.find((d) => !d.data().isDeleted);
      if (openJob) {
        setOpenJobWarning({ jobId: openJob.id });
        setSaving(false);
        return;
      }

      const jobId = await createJob();
      if (!jobId) return;
      setSaving(false);
      // Inspection (if this center runs them) happens after the job is
      // started, from the job card — not here at creation.
      navigate(`/services/${jobId}`);
    } catch {
      setJobError("Failed to create job. Please try again.");
      setSaving(false);
    }
  };

  const createJob = async (): Promise<string | undefined> => {
    if (!currentUser?.centerId || !selectedCustomer || !selectedVehicle) return;
    const parsedMi = parseInt(mileageIn, 10);
    // A quick job that isn't tracking mileage may leave the field blank —
    // fall back to the vehicle's last known reading rather than writing 0.
    // A vehicle registered without an odometer reading has nothing to fall
    // back to, so the job records zero until one is taken.
    const mi = !isNaN(parsedMi) ? parsedMi : (selectedVehicle.currentMileageKm ?? 0);
    // Keep the crew in the order it was picked — the first is the lead, which
    // is what technicianId/technicianName end up holding.
    const crew = technicianIds.flatMap((id) => {
      const staff = technicians.find((t) => t.id === id);
      return staff ? [{ id, name: staffDisplayName(staff) }] : [];
    });
    // Pro requires a technician; on Basic the job can be created unassigned.
    if (centerPlan === "pro" && crew.length === 0) return;

    const inspector = technicians.find((t) => t.id === inspectorId);

    // The job routes to whichever department the lead technician belongs to,
    // snapshotted at creation so the job keeps its department even if that
    // technician later moves teams.
    const leadTech = technicians.find((t) => t.id === crew[0]?.id);

    const jobId = await createServiceJob({
      centerId: currentUser.centerId,
      customerId: selectedCustomer.id,
      customerName: selectedCustomer.name,
      customerPhone: selectedCustomer.phone,
      vehicle: selectedVehicle,
      mileageIn: mi,
      crew,
      departmentId: leadTech?.departmentId ?? null,
      departmentName: leadTech?.departmentName ?? null,
      inspectorId: inspector?.id ?? null,
      inspectorName: inspector ? staffDisplayName(inspector) : null,
      services: selectedServices,
      customServices,
      internalNotes,
      catalog,
      partsUsed,
      recordMileage,
    });

    // Update vehicle mileage — skipped for a job that isn't tracking it, so a
    // quick wash/top-up doesn't overwrite the vehicle's real odometer reading
    // with the fallback value used above.
    if (recordMileage) {
      await safeUpdateDoc(doc(db, "servicecenters", currentUser.centerId, "vehicles", selectedVehicle.id), {
        currentMileageKm: mi,
        updatedAt: serverTimestamp(),
      });
    }

    return jobId;
  };

  const StepCircle = ({ n, label }: { n: number; label: string }) => {
    const active = step === n;
    const done = step > n;
    return (
      <div className="flex flex-col items-center gap-1">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 ${
            done ? "bg-green-500 border-green-500 text-white" :
            active ? "bg-orange-500 border-orange-500 text-white" :
            "bg-transparent border-white/20 text-gray-500"
          }`}
        >
          {done ? "✓" : n}
        </div>
        <span className={`text-xs ${active ? "text-white" : "text-gray-500"}`}>{label}</span>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-[#162032]">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => navigate("/services")} className="text-gray-400 hover:text-white">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-semibold">{t("services.newService")}</h1>
        </div>

        {/* Step indicator */}
        <div className="max-w-2xl mx-auto px-4 pb-4">
          <div className="flex items-center gap-0">
            <StepCircle n={1} label="Customer" />
            <div className={`flex-1 h-0.5 mx-2 ${step > 1 ? "bg-green-500" : "bg-white/10"}`} />
            <StepCircle n={2} label="Vehicle" />
            <div className={`flex-1 h-0.5 mx-2 ${step > 2 ? "bg-green-500" : "bg-white/10"}`} />
            <StepCircle n={3} label="Job Details" />
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">

        {/* Step 1: Customer */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold">Select Customer</h2>

            <div className="relative">
              <button
                onClick={() => setCustomerDropdownOpen((o) => !o)}
                className="w-full text-left bg-white/5 border border-white/10 text-white rounded-lg px-4 py-2.5 flex items-center justify-between focus:outline-none focus:border-orange-500"
              >
                <span className={selectedCustomer ? "text-white" : "text-gray-500"}>
                  {selectedCustomer
                    ? `${selectedCustomer.name} · ${selectedCustomer.phone}`
                    : "Select customer…"}
                </span>
                <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${customerDropdownOpen ? "rotate-90" : ""}`} />
              </button>
              {customerDropdownOpen && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-[#1e2d42] border border-white/10 rounded-lg shadow-xl overflow-hidden">
                  <div className="p-2 border-b border-white/10">
                    <input
                      type="text"
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      placeholder="Type to search…"
                      className="w-full bg-[#0B1120] border border-white/10 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
                      autoFocus
                    />
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {allCustomers
                      .filter((c) => {
                        if (!customerSearch) return true;
                        const q = customerSearch.toLowerCase();
                        if (c.name.toLowerCase().includes(q)) return true;
                        if (phoneMatches(c.phone, customerSearch)) return true;
                        // Match by vehicle plate number
                        return allVehicles.some(
                          (v) => v.customerId === c.id && v.plateNumber.toLowerCase().includes(q),
                        );
                      })
                      .map((c) => {
                        const matchedPlate = customerSearch
                          ? allVehicles.find(
                              (v) => v.customerId === c.id &&
                                v.plateNumber.toLowerCase().includes(customerSearch.toLowerCase()),
                            )?.plateNumber
                          : undefined;
                        return (
                        <button
                          key={c.id}
                          onClick={() => handleSelectCustomer(c)}
                          className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-white/10 hover:text-white transition-colors"
                        >
                          <div className="text-white">{c.name}</div>
                          <div className="text-xs text-gray-400">{c.phone}</div>
                          {matchedPlate && (
                            <div className="text-xs text-orange-400 font-mono mt-0.5">{matchedPlate}</div>
                          )}
                        </button>
                        );
                      })}
                    {allCustomers.length === 0 && (
                      <div className="px-3 py-2 text-sm text-gray-500">No customers yet</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => setStep(2)}
              disabled={!selectedCustomer}
              className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Step 2: Vehicle */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold">Select Vehicle</h2>
            <p className="text-sm text-gray-400">Customer: <span className="text-white">{selectedCustomer?.name}</span></p>

            <div className="grid grid-cols-2 gap-3">
              {vehicles.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedVehicle(v)}
                  className={`text-left bg-[#162032] border rounded-lg p-3 transition-colors ${
                    selectedVehicle?.id === v.id
                      ? "border-orange-500 bg-orange-500/10"
                      : "border-white/10 hover:border-white/30"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Car className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="font-bold text-white text-sm">{v.plateNumber}</span>
                  </div>
                  <div className="text-xs text-gray-400">
                    {[v.make, v.model].filter(Boolean).join(" ")}
                  </div>
                </button>
              ))}
            </div>

            {vehicles.length === 0 && (
              <p className="text-sm text-gray-500">
                This customer has no vehicles registered yet. Add a vehicle from the Vehicles page first.
              </p>
            )}

            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="flex-1 bg-white/10 hover:bg-white/20 text-white py-2.5 rounded-lg font-medium">
                Back
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={!selectedVehicle}
                className="flex-1 flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Job Details */}
        {step === 3 && (
          <div className="space-y-6">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold">Job Details</h2>
            <p className="text-sm text-gray-400">
              Vehicle: <span className="text-white font-medium">{selectedVehicle?.plateNumber}</span> &nbsp;·&nbsp;
              {selectedVehicle?.make} {selectedVehicle?.model}
            </p>

            {/* Technicians — Pro only. On Basic there are no per-technician
                logins, so the picker is hidden and jobs stay unassigned.
                More than one can work the same car, so this is a multi-select:
                every technician picked gets the job in their own list. */}
            {centerPlan === "pro" && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                    Technicians
                  </label>
                  <span className="text-xs text-gray-500">
                    {technicianIds.length === 0
                      ? "Pick one or more"
                      : technicianIds.length === 1 ? "1 assigned" : `${technicianIds.length} assigned`}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {technicians.map((t) => {
                    const on = technicianIds.includes(t.id);
                    const order = technicianIds.indexOf(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => toggleTechnician(t.id)}
                        className={`flex items-center justify-between gap-2 text-left text-sm px-3 py-2.5 rounded-lg border transition-colors ${
                          on
                            ? "bg-orange-500/10 border-orange-500 text-orange-300"
                            : "bg-white/5 border-white/10 text-gray-300 hover:border-white/30"
                        }`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <Users className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="truncate">{staffDisplayName(t)}</span>
                        </span>
                        {on && (
                          <span className="text-[10px] flex-shrink-0 px-1.5 py-0.5 rounded-full bg-orange-500/20">
                            {order === 0 ? "Lead" : `#${order + 1}`}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {technicians.length === 0 && (
                  <p className="text-xs text-gray-500 mt-1">No active technicians found. Add staff first.</p>
                )}
                {technicianIds.length > 1 && (
                  <p className="text-xs text-gray-500 mt-2">
                    The first one picked is the lead — the job card shows the whole crew.
                  </p>
                )}
              </div>
            )}

            {/* Inspector — optional. Inspection itself happens later, after
                the job is started, but the owner or whoever's creating this
                job can name who should do it up front if they like. */}
            {centerPlan === "pro" && inspectionEnabled && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                    Inspector <span className="text-gray-600 font-normal normal-case">(optional)</span>
                  </label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setInspectorId("")}
                    className={`flex items-center gap-2 text-left text-sm px-3 py-2.5 rounded-lg border transition-colors ${
                      inspectorId === ""
                        ? "bg-orange-500/10 border-orange-500 text-orange-300"
                        : "bg-white/5 border-white/10 text-gray-300 hover:border-white/30"
                    }`}
                  >
                    Unassigned — anyone can do it
                  </button>
                  {technicians.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setInspectorId(t.id)}
                      className={`flex items-center gap-2 text-left text-sm px-3 py-2.5 rounded-lg border transition-colors truncate ${
                        inspectorId === t.id
                          ? "bg-orange-500/10 border-orange-500 text-orange-300"
                          : "bg-white/5 border-white/10 text-gray-300 hover:border-white/30"
                      }`}
                    >
                      <span className="truncate">{staffDisplayName(t)}</span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  You'll be prompted to inspect the vehicle once the job is started.
                </p>
              </div>
            )}

            {/* Record mileage toggle — off for a quick job (wash, oil top-up)
                that has no meaningful "next service" to track or SMS about. */}
            <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg px-3 py-2.5">
              <div>
                <p className="text-sm text-white">Track mileage &amp; next service</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Turn off for a quick job (wash, oil top-up) — skips the odometer reading and
                  sends a thank-you-only SMS with no mileage line.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRecordMileage((v) => !v)}
                className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ml-3 ${recordMileage ? "bg-orange-500" : "bg-white/10"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${recordMileage ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>

            {/* Mileage In */}
            {recordMileage && (
              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold block mb-2">Mileage In (km)</label>
                <input
                  type="number"
                  placeholder="Current odometer reading"
                  value={mileageIn}
                  onChange={(e) => setMileageIn(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2.5 focus:outline-none focus:border-orange-500"
                />
                {selectedVehicle && (
                  <p className="text-xs text-gray-500 mt-1">
                    {selectedVehicle.currentMileageKm == null
                      ? "No mileage recorded for this vehicle yet."
                      : `Last recorded mileage: ${formatKm(selectedVehicle.currentMileageKm)}`}
                  </p>
                )}
              </div>
            )}

            {/* Services with prices */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Services</label>
                <button
                  type="button"
                  onClick={() => navigate("/services/catalog")}
                  className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300"
                >
                  <SettingsIcon className="w-3.5 h-3.5" /> Manage services &amp; prices
                </button>
              </div>
              {/* Prices below are resolved for THIS vehicle's type, so the tech
                  sees the price that will actually be billed — not every type. */}
              <div className="mb-3 flex items-center gap-1.5 text-xs text-gray-400">
                <Tag className="w-3.5 h-3.5 text-orange-400" />
                Showing prices for
                <span className="px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-300 font-medium">
                  {vehicleTypeLabel(selectedVehicle?.vehicleType)}
                </span>
              </div>
              {catalogNames.length === 0 ? (
                <div className="border border-dashed border-white/10 rounded-lg px-4 py-6 text-center">
                  <p className="text-sm text-gray-400">
                    No services priced for{" "}
                    <span className="text-gray-200">{vehicleTypeLabel(selectedVehicle?.vehicleType)}</span> yet.
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate("/services/catalog")}
                    className="mt-2 text-xs text-orange-400 hover:text-orange-300 font-medium"
                  >
                    Set up services &amp; prices →
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {catalogNames.map((name) => {
                    const item = resolveCatalogItem(name);
                    const on = selectedServices.includes(name);
                    return (
                      <button
                        key={name}
                        onClick={() => toggleService(name)}
                        className={`text-left text-sm px-3 py-2 rounded-lg border transition-colors flex items-center justify-between gap-2 ${
                          on
                            ? "bg-orange-500/10 border-orange-500 text-orange-300"
                            : "bg-white/5 border-white/10 text-gray-300 hover:border-white/30"
                        }`}
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          {on && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                          <span className="truncate">{name}</span>
                        </span>
                        {item
                          ? <span className="text-xs text-gray-400 flex-shrink-0">LKR {catalogPrice(item).toLocaleString()}</span>
                          : <span className="text-[10px] text-gray-600 flex-shrink-0">No price</span>}
                      </button>
                    );
                  })}
                </div>
              )}
              {selectedServices.length > 0 && catalog.length > 0 && (
                <p className="mt-2 text-xs text-gray-400">
                  Catalog subtotal:{" "}
                  <span className="text-white font-medium">
                    LKR {selectedServices.reduce((sum, name) => {
                      const c = resolveCatalogItem(name);
                      return sum + (c ? catalogPrice(c) : 0);
                    }, 0).toLocaleString()}
                  </span>
                  {" "}— an invoice will be auto-generated with these line items.
                </p>
              )}
            </div>

            {/* Parts from inventory — Pro only, same permission gate as adding
                parts from the job card. Picked up front so the crew doesn't
                have to circle back to the job page just to log what they took. */}
            {centerPlan === "pro" && canAddParts && (
              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold block mb-2">
                  Parts <span className="text-gray-600 font-normal normal-case">(optional)</span>
                </label>
                {partsUsed.length > 0 && (
                  <div className="space-y-2 mb-2">
                    {partsUsed.map((p) => (
                      <div key={p.itemId} className="flex items-center justify-between text-sm bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                        <span className="text-white flex items-center gap-2 min-w-0">
                          <Package className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                          <span className="truncate">{p.itemName}</span>
                          {p.partNumber && <span className="text-xs text-gray-500 font-mono flex-shrink-0">({p.partNumber})</span>}
                        </span>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <span className="text-gray-400">×{p.quantity}</span>
                          <button onClick={() => removePart(p.itemId)} className="text-gray-600 hover:text-red-400">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search inventory by name or item code…"
                    value={partSearch}
                    onChange={(e) => { setPartSearch(e.target.value); setSelectedPart(null); }}
                    className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                  />
                  {partResults.length > 0 && !selectedPart && (
                    <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-[#0B1120] border border-white/10 rounded-lg overflow-hidden">
                      {partResults.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => { setSelectedPart(item); setPartSearch(item.name); setPartResults([]); }}
                          className="w-full text-left px-3 py-2 text-sm text-white hover:bg-white/5 flex justify-between gap-2"
                        >
                          <span className="min-w-0">
                            <span className="block truncate">{item.name}</span>
                            {item.partNumber && (
                              <span className="block text-xs text-gray-500 font-mono">Code: {item.partNumber}</span>
                            )}
                          </span>
                          <span className="text-gray-400 flex-shrink-0">Stock: {item.currentQty} {item.unit}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {selectedPart && (
                  <div className="flex gap-2 mt-2">
                    <input
                      type="number"
                      min="1"
                      value={partQty}
                      onChange={(e) => setPartQty(e.target.value)}
                      className="w-20 bg-white/5 border border-white/10 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-orange-500"
                    />
                    <button onClick={addPart} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-1.5 rounded-lg text-sm">
                      Add Part
                    </button>
                    <button onClick={() => { setSelectedPart(null); setPartSearch(""); }} className="text-gray-400 hover:text-white text-sm px-2">
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Custom services */}
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold block mb-2">Custom Services</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter custom service…"
                  value={customServiceInput}
                  onChange={(e) => setCustomServiceInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addCustomService()}
                  className="flex-1 bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 focus:outline-none focus:border-orange-500 text-sm"
                />
                <button
                  onClick={addCustomService}
                  className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm"
                >
                  Add
                </button>
              </div>
              {customServices.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {customServices.map((s) => (
                    <span key={s} className="flex items-center gap-1 bg-white/10 text-white text-xs px-2 py-1 rounded-full">
                      {s}
                      <button onClick={() => setCustomServices((prev) => prev.filter((x) => x !== s))}>
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Internal notes */}
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold block mb-2">Internal Notes (optional)</label>
              <textarea
                placeholder="Notes visible to staff only…"
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                rows={3}
                className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 focus:outline-none focus:border-orange-500 text-sm resize-none"
              />
            </div>

            {jobError && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-3 py-2 text-sm">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                {jobError}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setStep(2)} className="flex-1 bg-white/10 hover:bg-white/20 text-white py-2.5 rounded-lg font-medium">
                Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-lg font-medium disabled:opacity-50"
              >
                {saving ? "Creating…" : "Create Job"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Open job warning modal */}
      {openJobWarning && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#162032] border border-white/10 rounded-xl p-6 max-w-sm w-full space-y-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-400 flex-shrink-0" />
              <h3 className="font-semibold text-white">Open Job Exists</h3>
            </div>
            <p className="text-sm text-gray-300">
              This vehicle already has an open job card. What would you like to do?
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => navigate(`/services/${openJobWarning.jobId}`)}
                className="bg-orange-500 hover:bg-orange-600 text-white py-2 rounded-lg text-sm font-medium"
              >
                View Existing Job
              </button>
              <button
                onClick={async () => {
                  setOpenJobWarning(null);
                  setSaving(true);
                  const jobId = await createJob();
                  setSaving(false);
                  if (!jobId) return;
                  navigate(`/services/${jobId}`);
                }}
                className="bg-white/10 hover:bg-white/20 text-white py-2 rounded-lg text-sm"
              >
                Create New Anyway
              </button>
              <button
                onClick={() => setOpenJobWarning(null)}
                className="text-gray-400 hover:text-white text-sm py-1"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
