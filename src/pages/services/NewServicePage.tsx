import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, query, where, getDocs, doc, getDoc,
  orderBy, limit, Timestamp, serverTimestamp, onSnapshot,
} from "firebase/firestore";
import { safeAddDoc, safeUpdateDoc, safeSetDoc } from "../../lib/firestoreWrite";
import { ArrowLeft, X, Car, AlertTriangle, ChevronRight, Settings as SettingsIcon, ClipboardList } from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { Customer, Vehicle, StaffMember, ServicePriceItem } from "../../types/auth";
import { phoneMatches } from "../../lib/utils";
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

  const snap = await getDocs(
    query(
      collection(db, "servicecenters", centerId, "jobs"),
      orderBy("createdAt", "desc"),
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
  const [technicianId, setTechnicianId] = useState("");
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
    if (!technicianId) { setJobError("Select a technician"); return; }
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
      if (centerPlan === "pro" && inspectionEnabled) {
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
    const tech = technicians.find((t) => t.id === technicianId);
    if (!tech) return;

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
      mileageIn: mi,
      nextServiceMileageKm: selectedVehicle.nextServiceMileageKm,
      oilBrand: selectedVehicle.oilBrand ?? "",
      oilGrade: selectedVehicle.oilGrade ?? "",
      oilViscosityNotes: selectedVehicle.oilViscosityNotes ?? "",
      technicianId,
      technicianName: tech.fullName || tech.displayName || tech.email.split("@")[0],
      services: selectedServices,
      customServices,
      internalNotes: internalNotes.trim(),
      status: "pending",
      partsUsed: [],
      smsSent: false,
      centerId: currentUser.centerId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
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
        const c = catalog.find((x) => x.name === name);
        const price = c?.price ?? 0;
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

            {/* Technician */}
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold block mb-2">Technician</label>
              <select
                value={technicianId}
                onChange={(e) => setTechnicianId(e.target.value)}
                className="w-full bg-[#162032] border border-white/10 text-white rounded-lg px-3 py-2.5 focus:outline-none focus:border-orange-500"
              >
                <option value="" className="bg-[#162032] text-white">Select technician…</option>
                {technicians.map((t) => (
                  <option key={t.id} value={t.id} className="bg-[#162032] text-white">
                    {t.fullName || t.displayName || t.email.split("@")[0]}
                  </option>
                ))}
              </select>
              {technicians.length === 0 && (
                <p className="text-xs text-gray-500 mt-1">No active technicians found. Add staff first.</p>
              )}
            </div>

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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  ...catalog.map((c) => ({ name: c.name, price: c.price })),
                  ...STANDARD_SERVICES.filter((s) => !catalog.some((c) => c.name === s)).map((s) => ({ name: s, price: undefined as number | undefined })),
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
                      <span>{s.name}</span>
                      {s.price != null && (
                        <span className="text-xs text-gray-400">LKR {s.price.toLocaleString()}</span>
                      )}
                    </button>
                  );
                })}
              </div>
              {selectedServices.length > 0 && catalog.length > 0 && (
                <p className="mt-2 text-xs text-gray-400">
                  Catalog subtotal:{" "}
                  <span className="text-white font-medium">
                    LKR {selectedServices.reduce((sum, name) => {
                      const c = catalog.find((x) => x.name === name);
                      return sum + (c?.price ?? 0);
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
                  if (centerPlan === "pro" && inspectionEnabled) {
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

function ServiceCatalogModal({
  centerId, catalog, onClose,
}: {
  centerId: string;
  catalog: ServicePriceItem[];
  onClose: () => void;
}) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [standardPrices, setStandardPrices] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const catalogByName = new Map(catalog.map((c) => [c.name, c]));
  const standardMissing = STANDARD_SERVICES.filter((s) => !catalogByName.has(s));

  async function handleSaveExisting(item: ServicePriceItem) {
    const raw = edits[item.id];
    if (raw === undefined) return;
    const p = parseFloat(raw);
    if (isNaN(p) || p < 0) { setError("Enter a valid price"); return; }
    setError("");
    setBusyId(item.id);
    try {
      await safeUpdateDoc(
        doc(db, "servicecenters", centerId, "servicePrices", item.id),
        { price: p },
      );
      setEdits((prev) => { const n = { ...prev }; delete n[item.id]; return n; });
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    try {
      const { safeDeleteDoc } = await import("../../lib/firestoreWrite");
      await safeDeleteDoc(doc(db, "servicecenters", centerId, "servicePrices", id));
    } finally {
      setBusyId(null);
    }
  }

  async function handleAddStandard(name: string) {
    const raw = standardPrices[name];
    const p = parseFloat(raw ?? "");
    if (isNaN(p) || p < 0) { setError(`Enter a price for ${name}`); return; }
    setError("");
    setBusyId(name);
    try {
      await safeAddDoc(collection(db, "servicecenters", centerId, "servicePrices"), {
        name, price: p, centerId, createdAt: Timestamp.now(),
      });
      setStandardPrices((prev) => { const n = { ...prev }; delete n[name]; return n; });
    } finally {
      setBusyId(null);
    }
  }

  async function handleAddNew() {
    const trimmed = newName.trim();
    const p = parseFloat(newPrice);
    if (!trimmed) { setError("Service name required"); return; }
    if (isNaN(p) || p < 0) { setError("Enter a valid price"); return; }
    if (catalogByName.has(trimmed)) { setError("That service is already in the catalog"); return; }
    setError("");
    setBusyId("__new__");
    try {
      await safeAddDoc(collection(db, "servicecenters", centerId, "servicePrices"), {
        name: trimmed, price: p, centerId, createdAt: Timestamp.now(),
      });
      setNewName("");
      setNewPrice("");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-[#162032] border border-white/10 rounded-xl p-6 max-w-lg w-full space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-white">Service Catalog & Prices</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <p className="text-xs text-gray-400">
          Priced services auto-generate invoice line items. Update the price anytime — future jobs use the new value.
        </p>

        {/* Priced services — editable */}
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">Priced Services</p>
          {catalog.length === 0 ? (
            <p className="text-sm text-gray-500">No priced services yet. Add one below.</p>
          ) : (
            <div className="space-y-2">
              {catalog.map((c) => {
                const draft = edits[c.id];
                const dirty = draft !== undefined && draft !== String(c.price);
                return (
                  <div key={c.id} className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                    <div className="flex-1 min-w-0 text-sm text-white truncate">{c.name}</div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-500">LKR</span>
                      <input
                        type="number"
                        value={draft ?? String(c.price)}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [c.id]: e.target.value }))}
                        className="w-24 bg-[#0B1120] border border-white/10 text-white rounded px-2 py-1 text-sm focus:outline-none focus:border-orange-500"
                      />
                    </div>
                    {dirty ? (
                      <button
                        onClick={() => handleSaveExisting(c)}
                        disabled={busyId === c.id}
                        className="text-xs bg-orange-500 hover:bg-orange-600 text-white px-2 py-1 rounded disabled:opacity-50"
                      >
                        {busyId === c.id ? "…" : "Save"}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleDelete(c.id)}
                        disabled={busyId === c.id}
                        className="text-xs text-red-400 hover:text-red-300 px-2 py-1 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Standard services not yet priced */}
        {standardMissing.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">Set Price for Standard Services</p>
            <div className="space-y-2">
              {standardMissing.map((name) => (
                <div key={name} className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                  <div className="flex-1 min-w-0 text-sm text-gray-300 truncate">{name}</div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-500">LKR</span>
                    <input
                      type="number"
                      placeholder="0"
                      value={standardPrices[name] ?? ""}
                      onChange={(e) => setStandardPrices((prev) => ({ ...prev, [name]: e.target.value }))}
                      className="w-24 bg-[#0B1120] border border-white/10 text-white rounded px-2 py-1 text-sm focus:outline-none focus:border-orange-500"
                    />
                  </div>
                  <button
                    onClick={() => handleAddStandard(name)}
                    disabled={busyId === name || !standardPrices[name]}
                    className="text-xs bg-orange-500 hover:bg-orange-600 text-white px-2 py-1 rounded disabled:opacity-40"
                  >
                    {busyId === name ? "…" : "Add"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Free-form add */}
        <div className="border-t border-white/10 pt-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">Add Custom Service</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              placeholder="Service name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1 bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
            />
            <input
              type="number"
              placeholder="Price (LKR)"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              className="w-full sm:w-32 bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
            />
            <button
              onClick={handleAddNew}
              disabled={busyId === "__new__"}
              className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {busyId === "__new__" ? "…" : "Add"}
            </button>
          </div>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}
