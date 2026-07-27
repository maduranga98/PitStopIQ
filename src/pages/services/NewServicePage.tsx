import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, query, where, getDocs, doc, getDoc,
  orderBy, limit, Timestamp, serverTimestamp, onSnapshot,
} from "firebase/firestore";
import { safeAddDoc, safeUpdateDoc, safeSetDoc } from "../../lib/firestoreWrite";
import { DEFAULT_VEHICLE_TYPES } from "../../lib/vehicleOptions";
import {
  catalogPrice, resolveServiceItem, uniqueServiceNames, pricedTypeCount, vehicleTypeLabel,
} from "../../lib/servicePricing";
import { ArrowLeft, X, Car, AlertTriangle, ChevronRight, Settings as SettingsIcon, ClipboardList, Search, Tag, Check, Trash2, Users } from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import type { Customer, Vehicle, StaffMember, ServicePriceItem } from "../../types/auth";
import { phoneMatches } from "../../lib/utils";
import { staffDisplayName, technicianFields } from "../../lib/jobTechnicians";
import { useTranslation } from "react-i18next";
import VehicleInspectionForm from "../../components/inspection/VehicleInspectionForm";

const STANDARD_SERVICES = [
  "Oil Change", "Oil Filter", "Air Filter", "Fuel Filter", "Spark Plugs",
  "Brake Service", "Brake Fluid", "Brake Pads", "Tyre Rotation", "Tyre Replacement",
  "Battery Check", "Battery Replacement", "Coolant Flush", "Transmission Service",
  "AC Service / Gas Refill", "Wheel Alignment", "Full Inspection", "Body Wash", "Interior Clean",
];

async function generateJobNumber(centerId: string): Promise<string> {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `${yyyy}-${mm}-`;

  // Order by jobNumber (a plain string set immediately) rather than
  // createdAt (a serverTimestamp). Offline writes leave createdAt
  // unresolved (null) until the server acknowledges them, which would
  // make a just-created job invisible to an orderBy("createdAt") query
  // and hand out a duplicate number to the next job created offline.
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

export default function NewServicePage() {
  const { currentUser } = useAuth();
  const canConductInspection = usePermission("inspection.conduct");
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
  const [showCatalogModal, setShowCatalogModal] = useState(false);

  // Step 3: Job Details
  const [technicians, setTechnicians] = useState<StaffMember[]>([]);
  // A job can be shared by a crew — the mechanic, whoever washes it, whoever
  // does the AC. The first one picked is the lead.
  const [technicianIds, setTechnicianIds] = useState<string[]>([]);
  const [mileageIn, setMileageIn] = useState("");
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [customServiceInput, setCustomServiceInput] = useState("");
  const [customServices, setCustomServices] = useState<string[]>([]);
  const [internalNotes, setInternalNotes] = useState("");
  const [jobError, setJobError] = useState("");
  const [saving, setSaving] = useState(false);

  // Open job warning
  const [openJobWarning, setOpenJobWarning] = useState<{ jobId: string } | null>(null);

  // Inspection flow (Pro only)
  const [centerPlan, setCenterPlan] = useState<"basic" | "pro">("basic");
  const [inspectionEnabled, setInspectionEnabled] = useState(false);
  const [createdJobId, setCreatedJobId] = useState<string | null>(null);
  const [showInspectionPrompt, setShowInspectionPrompt] = useState(false);
  const [showInspectionForm, setShowInspectionForm] = useState(false);

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

  // Unique service names across the catalog (a name may have several
  // vehicle-type-specific price entries, but should appear once in the grid).
  const catalogNames = uniqueServiceNames(catalog);

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
    if (!mileageIn || isNaN(mi)) { setJobError("Enter mileage in"); return; }
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
      if (!openSnap.empty) {
        setOpenJobWarning({ jobId: openSnap.docs[0].id });
        setSaving(false);
        return;
      }

      const jobId = await createJob();
      if (!jobId) return;
      setCreatedJobId(jobId);
      setSaving(false);

      // Show inspection prompt for Pro centers with inspection enabled
      if (centerPlan === "pro" && inspectionEnabled && canConductInspection) {
        setShowInspectionPrompt(true);
      } else {
        navigate(`/services/${jobId}`);
      }
    } catch {
      setJobError("Failed to create job. Please try again.");
      setSaving(false);
    }
  };

  const handleSkipInspection = async () => {
    if (!createdJobId || !currentUser?.centerId) return;
    await safeSetDoc(
      doc(db, "servicecenters", currentUser.centerId, "jobs", createdJobId, "inspection", "main"),
      {
        conductedBy: currentUser.uid,
        completedAt: Timestamp.now(),
        skipped: true,
        fuelLevel: "half",
        odometerReading: 0,
        overallCondition: "good",
        checklistItems: [],
        damageReports: [],
        notes: null,
      },
    );
    navigate(`/services/${createdJobId}`);
  };

  const createJob = async (): Promise<string | undefined> => {
    if (!currentUser?.centerId || !selectedCustomer || !selectedVehicle) return;
    const mi = parseInt(mileageIn, 10);
    // Keep the crew in the order it was picked — the first is the lead, which
    // is what technicianId/technicianName end up holding.
    const crew = technicianIds.flatMap((id) => {
      const staff = technicians.find((t) => t.id === id);
      return staff ? [{ id, name: staffDisplayName(staff) }] : [];
    });
    // Pro requires a technician; on Basic the job can be created unassigned.
    if (centerPlan === "pro" && crew.length === 0) return;

    const jobNumber = await generateJobNumber(currentUser.centerId);

    const ref = await safeAddDoc(collection(db, "servicecenters", currentUser.centerId, "jobs"), {
      jobNumber,
      vehicleId: selectedVehicle.id,
      plateNumber: selectedVehicle.plateNumber,
      customerId: selectedCustomer.id,
      customerName: selectedCustomer.name,
      customerPhone: selectedCustomer.phone,
      make: selectedVehicle.make ?? "",
      model: selectedVehicle.model ?? "",
      year: selectedVehicle.year ?? null,
      // Store the vehicle type so the invoice can later re-resolve per-type
      // prices (e.g. from the Service Detail page) without re-fetching it.
      vehicleType: selectedVehicle.vehicleType ?? "",
      mileageIn: mi,
      nextServiceMileageKm: selectedVehicle.nextServiceMileageKm,
      oilBrand: selectedVehicle.oilBrand ?? "",
      oilGrade: selectedVehicle.oilGrade ?? "",
      oilViscosityNotes: selectedVehicle.oilViscosityNotes ?? "",
      ...technicianFields(crew),
      services: selectedServices,
      customServices,
      internalNotes: internalNotes.trim(),
      status: "pending",
      partsUsed: [],
      smsSent: false,
      centerId: currentUser.centerId,
      // Client timestamp, not serverTimestamp(): a pending serverTimestamp is
      // null in the local cache, which would hide jobs created offline from
      // the orderBy("createdAt") services list until they sync.
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    // Update vehicle mileage
    await safeUpdateDoc(doc(db, "servicecenters", currentUser.centerId, "vehicles", selectedVehicle.id), {
      currentMileageKm: mi,
      updatedAt: serverTimestamp(),
    });

    // Auto-generate invoice line items for ALL selected services. Priced
    // catalog services carry their price; services without a catalog price
    // (and custom services) are added at 0 so they still appear on the
    // invoice and can be priced on the Invoice page.
    const lineItems = [
      ...selectedServices.map((name) => {
        const c = resolveCatalogItem(name);
        const price = c ? catalogPrice(c) : 0;
        return { description: name, qty: 1, unitPrice: price, lineTotal: price };
      }),
      ...customServices.map((name) => ({ description: name, qty: 1, unitPrice: 0, lineTotal: 0 })),
    ];
    if (lineItems.length > 0) {
      const subtotal = lineItems.reduce((s, li) => s + li.lineTotal, 0);
      const invoiceNumber = `${jobNumber}-INV`;
      await safeAddDoc(collection(db, "servicecenters", currentUser.centerId, "invoices"), {
        invoiceNumber,
        serviceId: ref.id,
        customerId: selectedCustomer.id,
        customerName: selectedCustomer.name,
        customerPhone: selectedCustomer.phone,
        vehicleId: selectedVehicle.id,
        plateNumber: selectedVehicle.plateNumber,
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
        centerId: currentUser.centerId,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    }

    return ref.id;
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

            {/* Mileage In */}
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
                  Last recorded mileage: {selectedVehicle.currentMileageKm.toLocaleString()} km
                </p>
              )}
            </div>

            {/* Services with prices */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Services</label>
                <button
                  type="button"
                  onClick={() => setShowCatalogModal(true)}
                  className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300"
                >
                  <SettingsIcon className="w-3.5 h-3.5" /> Manage catalog & prices
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  ...catalogNames.map((name) => ({ name, price: resolveCatalogItem(name) && catalogPrice(resolveCatalogItem(name)!) })),
                  ...STANDARD_SERVICES.filter((s) => !catalogNames.includes(s)).map((s) => ({ name: s, price: undefined as number | undefined })),
                ].map((s) => {
                  const on = selectedServices.includes(s.name);
                  return (
                    <button
                      key={s.name}
                      onClick={() => toggleService(s.name)}
                      className={`text-left text-sm px-3 py-2 rounded-lg border transition-colors flex items-center justify-between gap-2 ${
                        on
                          ? "bg-orange-500/10 border-orange-500 text-orange-300"
                          : "bg-white/5 border-white/10 text-gray-300 hover:border-white/30"
                      }`}
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        {on && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                        <span className="truncate">{s.name}</span>
                      </span>
                      {s.price != null
                        ? <span className="text-xs text-gray-400 flex-shrink-0">LKR {s.price.toLocaleString()}</span>
                        : <span className="text-[10px] text-gray-600 flex-shrink-0">No price</span>}
                    </button>
                  );
                })}
              </div>
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

      {/* Inspection prompt modal */}
      {showInspectionPrompt && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 max-w-sm w-full space-y-5">
            <div className="flex flex-col items-center text-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-[#F97316]/15 flex items-center justify-center">
                <ClipboardList className="w-7 h-7 text-[#F97316]" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white mb-1">Start vehicle inspection?</h3>
                <p className="text-sm text-gray-400">
                  Inspecting before service protects your center from damage claims.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { setShowInspectionPrompt(false); setShowInspectionForm(true); }}
                className="w-full bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold py-3 rounded-xl text-sm"
              >
                Start Inspection
              </button>
              <button
                onClick={handleSkipInspection}
                className="w-full bg-white/10 hover:bg-white/20 text-gray-300 py-2.5 rounded-xl text-sm"
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inspection form (full screen) */}
      {showInspectionForm && createdJobId && currentUser?.centerId && (
        <VehicleInspectionForm
          centerId={currentUser.centerId}
          jobId={createdJobId}
          conductedBy={currentUser.uid}
          plateNumber={selectedVehicle?.plateNumber}
          onComplete={() => navigate(`/services/${createdJobId}`)}
        />
      )}

      {/* Service catalog modal */}
      {showCatalogModal && currentUser?.centerId && (
        <ServiceCatalogModal
          centerId={currentUser.centerId}
          catalog={catalog}
          onClose={() => setShowCatalogModal(false)}
        />
      )}

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
                  if (!jobId) return;
                  setCreatedJobId(jobId);
                  setSaving(false);
                  if (centerPlan === "pro" && inspectionEnabled && canConductInspection) {
                    setShowInspectionPrompt(true);
                  } else {
                    navigate(`/services/${jobId}`);
                  }
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


// Service price catalog, organised by vehicle type. The same service (e.g.
// "Oil Change") can carry a different price for each vehicle type, so the
// owner picks a vehicle type and sets the price of each service for it.
// An "All vehicle types" tab holds a general price used as a fallback when a
// vehicle's type has no specific price. Prices resolve per vehicle when a job
// is created (see resolveCatalogItem above).
function ServiceCatalogModal({
  centerId, catalog, onClose,
}: {
  centerId: string;
  catalog: ServicePriceItem[];
  onClose: () => void;
}) {
  // "" = the general "All vehicle types" price.
  const [activeType, setActiveType] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [extraNames, setExtraNames] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [vehicleTypeOptions, setVehicleTypeOptions] = useState<string[]>(DEFAULT_VEHICLE_TYPES);

  // Vehicle types: defaults + types on saved vehicles + center custom types.
  useEffect(() => {
    let active = true;
    Promise.all([
      getDoc(doc(db, "servicecenters", centerId)),
      getDocs(query(
        collection(db, "servicecenters", centerId, "vehicles"),
        where("isDeleted", "==", false),
      )),
    ]).then(([centerSnap, vSnap]) => {
      if (!active) return;
      const c = centerSnap.data() as { customVehicleTypes?: string[] } | undefined;
      const types = new Set<string>(DEFAULT_VEHICLE_TYPES);
      vSnap.docs.forEach((d) => { const t = d.data().vehicleType; if (t) types.add(t); });
      (c?.customVehicleTypes ?? []).forEach((t) => types.add(t));
      setVehicleTypeOptions(Array.from(types).sort());
    }).catch(() => { /* non-fatal — defaults still work */ });
    return () => { active = false; };
  }, [centerId]);

  // Every service name that can be priced: the standard list, anything already
  // in the catalog, plus names the owner just added this session.
  const serviceNames = Array.from(
    new Set<string>([...STANDARD_SERVICES, ...catalog.map((c) => c.name), ...extraNames]),
  ).sort();

  const filteredNames = search.trim()
    ? serviceNames.filter((n) => n.toLowerCase().includes(search.trim().toLowerCase()))
    : serviceNames;

  // The catalog entry for a service under the currently selected vehicle type.
  function docFor(name: string): ServicePriceItem | undefined {
    return catalog.find((c) => c.name === name && (c.vehicleType ?? "") === activeType);
  }

  // How many vehicle types (incl. general) a service has a price for — shown
  // as a hint so the owner can see a service is already priced elsewhere.
  function pricedCount(name: string): number {
    return pricedTypeCount(catalog, name);
  }

  // Number of services with a price set for the currently selected type — a
  // progress cue in the header.
  const pricedForActive = serviceNames.filter((n) => docFor(n) != null).length;

  function changeType(t: string) {
    setActiveType(t);
    setPrices({});
    setError("");
  }

  async function savePrice(name: string) {
    const existing = docFor(name);
    const raw = (prices[name] ?? "").trim();
    setError("");
    // Empty value clears any price set for this vehicle type.
    if (raw === "") {
      if (existing) await removePrice(existing);
      else setPrices((prev) => { const n = { ...prev }; delete n[name]; return n; });
      return;
    }
    const p = parseFloat(raw);
    if (isNaN(p) || p < 0) { setError("Enter a valid price"); return; }
    setBusyId(name);
    try {
      if (existing) {
        // Write both fields so readers on either `defaultPrice` (current) or
        // the legacy `price` field stay consistent.
        await safeUpdateDoc(
          doc(db, "servicecenters", centerId, "servicePrices", existing.id),
          { defaultPrice: p, price: p },
        );
      } else {
        await safeAddDoc(collection(db, "servicecenters", centerId, "servicePrices"), {
          name, defaultPrice: p, price: p, centerId, createdAt: Timestamp.now(),
          ...(activeType ? { vehicleType: activeType } : {}),
        });
      }
      setPrices((prev) => { const n = { ...prev }; delete n[name]; return n; });
      setSavedId(name);
      setTimeout(() => setSavedId((s) => (s === name ? null : s)), 1500);
    } finally {
      setBusyId(null);
    }
  }

  async function removePrice(existing: ServicePriceItem) {
    setBusyId(existing.name);
    try {
      const { safeDeleteDoc } = await import("../../lib/firestoreWrite");
      await safeDeleteDoc(doc(db, "servicecenters", centerId, "servicePrices", existing.id));
      setPrices((prev) => { const n = { ...prev }; delete n[existing.name]; return n; });
    } finally {
      setBusyId(null);
    }
  }

  function addCustomName() {
    const n = newName.trim();
    if (!n) { setError("Service name required"); return; }
    if (serviceNames.some((s) => s.toLowerCase() === n.toLowerCase())) {
      setError("That service already exists"); return;
    }
    setExtraNames((prev) => [...prev, n]);
    setNewName("");
    setSearch("");
    setError("");
  }

  const typeLabel = vehicleTypeLabel(activeType);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#162032] border border-white/10 rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center flex-shrink-0">
              <Tag className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <h3 className="font-bold text-white leading-tight">Service Catalog &amp; Prices</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Price each service per vehicle type — bikes and cars can differ.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 -mr-1"><X className="w-5 h-5" /></button>
        </div>

        {/* Vehicle type selector (sticky under header) */}
        <div className="px-5 pt-4 pb-3 border-b border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold">Vehicle Type</p>
            <span className="text-[11px] text-gray-500">
              {pricedForActive} priced for <span className="text-gray-300">{typeLabel}</span>
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => changeType("")}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                activeType === ""
                  ? "bg-orange-500 border-orange-500 text-white"
                  : "bg-white/5 border-white/10 text-gray-300 hover:border-white/30"
              }`}
            >
              All vehicle types
            </button>
            {vehicleTypeOptions.map((vt) => {
              const count = catalog.filter((c) => (c.vehicleType ?? "") === vt).length;
              return (
                <button
                  key={vt}
                  onClick={() => changeType(vt)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors capitalize flex items-center gap-1.5 ${
                    activeType === vt
                      ? "bg-orange-500 border-orange-500 text-white"
                      : "bg-white/5 border-white/10 text-gray-300 hover:border-white/30"
                  }`}
                >
                  {vt}
                  {count > 0 && (
                    <span className={`text-[10px] px-1.5 rounded-full ${activeType === vt ? "bg-white/25" : "bg-white/10"}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search services…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-white/5 border border-white/10 text-white rounded-lg text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
            />
          </div>
        </div>

        {/* Prices list (scrollable) */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-2">
            {filteredNames.map((name) => {
              const existing = docFor(name);
              const existingStr = existing != null ? String(catalogPrice(existing)) : "";
              const draft = prices[name];
              const val = draft ?? existingStr;
              const dirty = draft !== undefined && draft.trim() !== existingStr;
              const others = pricedCount(name) - (existing ? 1 : 0);
              const busy = busyId === name;
              const justSaved = savedId === name;
              return (
                <div
                  key={name}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 border transition-colors ${
                    existing != null
                      ? "bg-orange-500/[0.07] border-orange-500/30"
                      : "bg-white/5 border-white/10"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{name}</div>
                    {existing == null && others > 0 && (
                      <div className="text-[10px] text-gray-500">
                        Priced for {others} other {others === 1 ? "type" : "types"}
                      </div>
                    )}
                    {existing != null && (
                      <div className="text-[10px] text-orange-400/80">Priced for {typeLabel}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 bg-[#0B1120] border border-white/10 rounded-lg pl-2 focus-within:border-orange-500">
                    <span className="text-[11px] text-gray-500">LKR</span>
                    <input
                      type="number"
                      placeholder="—"
                      value={val}
                      onChange={(e) => setPrices((prev) => ({ ...prev, [name]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter" && dirty) savePrice(name); }}
                      className="w-20 bg-transparent text-white rounded px-1.5 py-1.5 text-sm text-right focus:outline-none"
                    />
                  </div>
                  {dirty ? (
                    <button
                      onClick={() => savePrice(name)}
                      disabled={busy}
                      className="text-xs bg-orange-500 hover:bg-orange-600 text-white px-2.5 py-1.5 rounded-lg disabled:opacity-50 font-medium min-w-[52px]"
                    >
                      {busy ? "…" : "Save"}
                    </button>
                  ) : justSaved ? (
                    <span className="flex items-center justify-center min-w-[52px] text-green-400">
                      <Check className="w-4 h-4" />
                    </span>
                  ) : existing ? (
                    <button
                      onClick={() => removePrice(existing)}
                      disabled={busy}
                      title="Clear price"
                      className="text-gray-500 hover:text-red-400 px-2 py-1.5 disabled:opacity-50 min-w-[52px] flex justify-center"
                    >
                      {busy ? "…" : <Trash2 className="w-4 h-4" />}
                    </button>
                  ) : (
                    <span className="min-w-[52px]" />
                  )}
                </div>
              );
            })}
            {filteredNames.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-6">No services match “{search}”.</p>
            )}
          </div>
        </div>

        {/* Add a custom service name (sticky footer) */}
        <div className="border-t border-white/10 p-5 space-y-1">
          <p className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold mb-2">Add Custom Service</p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="e.g. Nano Coating"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomName(); } }}
              className="flex-1 bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
            />
            <button
              onClick={addCustomName}
              className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap"
            >
              Add
            </button>
          </div>
          {error
            ? <p className="text-xs text-red-400 mt-1">{error}</p>
            : <p className="text-[11px] text-gray-500 mt-1">Adds the service to the list so you can price it for each vehicle type.</p>}
        </div>
      </div>
    </div>
  );
}
