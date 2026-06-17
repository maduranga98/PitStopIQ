import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, query, where, getDocs, addDoc, updateDoc, doc,
  orderBy, limit, Timestamp, serverTimestamp,
} from "firebase/firestore";
import { ArrowLeft, Search, Plus, X, User, Car, AlertTriangle, ChevronRight } from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { Customer, Vehicle, StaffMember } from "../../types/auth";

const STANDARD_SERVICES = [
  "Oil Change", "Oil Filter", "Air Filter", "Fuel Filter", "Spark Plugs",
  "Brake Service", "Brake Fluid", "Brake Pads", "Tyre Rotation", "Tyre Replacement",
  "Battery Check", "Battery Replacement", "Coolant Flush", "Transmission Service",
  "AC Service / Gas Refill", "Wheel Alignment", "Full Inspection", "Body Wash", "Interior Clean",
];

function normaliseLKPhone(raw: string): string | null {
  const s = raw.replace(/[\s\-()]/g, "");
  if (/^\+94\d{9}$/.test(s)) return s;
  if (/^0\d{9}$/.test(s)) return "+94" + s.slice(1);
  if (/^94\d{9}$/.test(s)) return "+" + s;
  return null;
}

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

  useEffect(() => {
  }, [currentUser, navigate]);

  const [step, setStep] = useState(1);

  // Step 1: Customer
  const [custSearch, setCustSearch] = useState("");
  const [custResults, setCustResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showNewCust, setShowNewCust] = useState(false);
  const [newCustName, setNewCustName] = useState("");
  const [newCustPhone, setNewCustPhone] = useState("");
  const [custError, setCustError] = useState("");
  const [savingCust, setSavingCust] = useState(false);

  // Step 2: Vehicle
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [showNewVehicle, setShowNewVehicle] = useState(false);
  const [newPlate, setNewPlate] = useState("");
  const [newMake, setNewMake] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newYear, setNewYear] = useState("");
  const [vehicleError, setVehicleError] = useState("");
  const [savingVehicle, setSavingVehicle] = useState(false);

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

  // Customer search with debounce
  useEffect(() => {
    if (!custSearch.trim() || !currentUser?.centerId) {
      setCustResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const lower = custSearch.toLowerCase();
      const snap = await getDocs(
        query(
          collection(db, "servicecenters", currentUser.centerId!, "customers"),
          where("isDeleted", "==", false),
          orderBy("name"),
          limit(10),
        ),
      );
      const results = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Customer))
        .filter(
          (c) =>
            c.name.toLowerCase().includes(lower) ||
            c.phone.includes(custSearch),
        );
      setCustResults(results);
    }, 300);
    return () => clearTimeout(timer);
  }, [custSearch, currentUser?.centerId]);

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
    setCustSearch("");
    setCustResults([]);
    setShowNewCust(false);
  }, []);

  const handleAddNewCustomer = async () => {
    if (!newCustName.trim()) { setCustError("Name is required"); return; }
    const phone = normaliseLKPhone(newCustPhone);
    if (!phone) { setCustError("Enter a valid Sri Lanka phone number"); return; }
    if (!currentUser?.centerId) return;
    setSavingCust(true);
    setCustError("");
    try {
      const ref = await addDoc(collection(db, "servicecenters", currentUser.centerId, "customers"), {
        name: newCustName.trim(),
        phone,
        isDeleted: false,
        vehicleCount: 0,
        lastServiceDate: null,
        createdAt: Timestamp.now(),
        centerId: currentUser.centerId,
      });
      handleSelectCustomer({ id: ref.id, name: newCustName.trim(), phone, isDeleted: false, vehicleCount: 0, lastServiceDate: null, createdAt: Timestamp.now(), centerId: currentUser.centerId });
    } catch {
      setCustError("Failed to create customer");
    } finally {
      setSavingCust(false);
    }
  };

  const handleAddNewVehicle = async () => {
    if (!newPlate.trim() || !newMake.trim() || !newModel.trim() || !newYear.trim()) {
      setVehicleError("All fields are required");
      return;
    }
    const year = parseInt(newYear, 10);
    if (isNaN(year) || year < 1900 || year > new Date().getFullYear() + 1) {
      setVehicleError("Enter a valid year");
      return;
    }
    if (!currentUser?.centerId || !selectedCustomer) return;
    setSavingVehicle(true);
    setVehicleError("");
    try {
      const ref = await addDoc(collection(db, "servicecenters", currentUser.centerId, "vehicles"), {
        plateNumber: newPlate.trim().toUpperCase(),
        customerId: selectedCustomer.id,
        customerName: selectedCustomer.name,
        make: newMake.trim(),
        model: newModel.trim(),
        year,
        currentMileageKm: 0,
        nextServiceMileageKm: 5000,
        isDeleted: false,
        centerId: currentUser.centerId,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      const v: Vehicle = {
        id: ref.id,
        plateNumber: newPlate.trim().toUpperCase(),
        customerId: selectedCustomer.id,
        customerName: selectedCustomer.name,
        make: newMake.trim(),
        model: newModel.trim(),
        year,
        currentMileageKm: 0,
        nextServiceMileageKm: 5000,
        isDeleted: false,
        centerId: currentUser.centerId,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };
      setVehicles((prev) => [...prev, v]);
      setSelectedVehicle(v);
      setShowNewVehicle(false);
    } catch {
      setVehicleError("Failed to register vehicle");
    } finally {
      setSavingVehicle(false);
    }
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

      await createJob();
    } catch {
      setJobError("Failed to create job. Please try again.");
      setSaving(false);
    }
  };

  const createJob = async () => {
    if (!currentUser?.centerId || !selectedCustomer || !selectedVehicle) return;
    const mi = parseInt(mileageIn, 10);
    const tech = technicians.find((t) => t.id === technicianId);
    if (!tech) return;

    const jobNumber = await generateJobNumber(currentUser.centerId);

    const ref = await addDoc(collection(db, "servicecenters", currentUser.centerId, "jobs"), {
      jobNumber,
      vehicleId: selectedVehicle.id,
      plateNumber: selectedVehicle.plateNumber,
      customerId: selectedCustomer.id,
      customerName: selectedCustomer.name,
      customerPhone: selectedCustomer.phone,
      make: selectedVehicle.make,
      model: selectedVehicle.model,
      year: selectedVehicle.year,
      mileageIn: mi,
      nextServiceMileageKm: selectedVehicle.nextServiceMileageKm,
      oilBrand: selectedVehicle.oilBrand ?? "",
      oilGrade: selectedVehicle.oilGrade ?? "",
      oilViscosityNotes: selectedVehicle.oilViscosityNotes ?? "",
      technicianId,
      technicianName: tech.displayName ?? tech.email,
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
    await updateDoc(doc(db, "servicecenters", currentUser.centerId, "vehicles", selectedVehicle.id), {
      currentMileageKm: mi,
      updatedAt: serverTimestamp(),
    });

    navigate(`/services/${ref.id}`);
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
          <h1 className="text-lg font-semibold">New Service</h1>
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

            {selectedCustomer ? (
              <div className="bg-[#162032] border border-white/10 rounded-lg p-4 flex items-center justify-between">
                <div>
                  <div className="font-medium text-white">{selectedCustomer.name}</div>
                  <div className="text-sm text-gray-400">{selectedCustomer.phone}</div>
                </div>
                <button
                  onClick={() => { setSelectedCustomer(null); setShowNewCust(false); }}
                  className="text-gray-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by name or phone…"
                  value={custSearch}
                  onChange={(e) => setCustSearch(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 text-white rounded-lg pl-9 pr-4 py-2.5 focus:outline-none focus:border-orange-500"
                />
                {custResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-[#162032] border border-white/10 rounded-lg overflow-hidden z-10 shadow-xl">
                    {custResults.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => handleSelectCustomer(c)}
                        className="w-full text-left px-4 py-2.5 hover:bg-white/5 flex items-center gap-3"
                      >
                        <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <div>
                          <div className="text-sm text-white">{c.name}</div>
                          <div className="text-xs text-gray-400">{c.phone}</div>
                        </div>
                      </button>
                    ))}
                    <button
                      onClick={() => { setShowNewCust(true); setCustResults([]); setCustSearch(""); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-white/5 flex items-center gap-2 text-orange-400 border-t border-white/10"
                    >
                      <Plus className="w-4 h-4" />
                      <span className="text-sm">Add new customer</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {!selectedCustomer && !custSearch && (
              <button
                onClick={() => setShowNewCust((v) => !v)}
                className="flex items-center gap-2 text-orange-400 text-sm hover:text-orange-300"
              >
                <Plus className="w-4 h-4" />
                Add new customer
              </button>
            )}

            {showNewCust && !selectedCustomer && (
              <div className="bg-[#162032] border border-white/10 rounded-lg p-4 space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">New Customer</p>
                <input
                  type="text"
                  placeholder="Full name"
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 focus:outline-none focus:border-orange-500 text-sm"
                />
                <input
                  type="tel"
                  placeholder="Phone (07X XXX XXXX)"
                  value={newCustPhone}
                  onChange={(e) => setNewCustPhone(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 focus:outline-none focus:border-orange-500 text-sm"
                />
                {custError && <p className="text-red-400 text-xs">{custError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={handleAddNewCustomer}
                    disabled={savingCust}
                    className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    {savingCust ? "Saving…" : "Save Customer"}
                  </button>
                  <button onClick={() => setShowNewCust(false)} className="text-gray-400 text-sm hover:text-white px-3">
                    Cancel
                  </button>
                </div>
              </div>
            )}

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
                  <div className="text-xs text-gray-400">{v.make} {v.model} {v.year}</div>
                </button>
              ))}

              <button
                onClick={() => setShowNewVehicle((x) => !x)}
                className="text-left border border-dashed border-white/20 rounded-lg p-3 hover:border-orange-500 hover:text-orange-400 text-gray-500 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  <span className="text-sm">Register new vehicle</span>
                </div>
              </button>
            </div>

            {showNewVehicle && (
              <div className="bg-[#162032] border border-white/10 rounded-lg p-4 space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">New Vehicle</p>
                <input
                  type="text"
                  placeholder="Plate number (e.g. ABC-1234)"
                  value={newPlate}
                  onChange={(e) => setNewPlate(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 focus:outline-none focus:border-orange-500 text-sm uppercase"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Make (e.g. Toyota)"
                    value={newMake}
                    onChange={(e) => setNewMake(e.target.value)}
                    className="bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 focus:outline-none focus:border-orange-500 text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Model (e.g. Corolla)"
                    value={newModel}
                    onChange={(e) => setNewModel(e.target.value)}
                    className="bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 focus:outline-none focus:border-orange-500 text-sm"
                  />
                </div>
                <input
                  type="number"
                  placeholder="Year (e.g. 2018)"
                  value={newYear}
                  onChange={(e) => setNewYear(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 focus:outline-none focus:border-orange-500 text-sm"
                />
                {vehicleError && <p className="text-red-400 text-xs">{vehicleError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={handleAddNewVehicle}
                    disabled={savingVehicle}
                    className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    {savingVehicle ? "Saving…" : "Register Vehicle"}
                  </button>
                  <button onClick={() => setShowNewVehicle(false)} className="text-gray-400 text-sm hover:text-white px-3">
                    Cancel
                  </button>
                </div>
              </div>
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
                className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2.5 focus:outline-none focus:border-orange-500"
              >
                <option value="">Select technician…</option>
                {technicians.map((t) => (
                  <option key={t.id} value={t.id}>{t.displayName ?? t.email}</option>
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

            {/* Services checklist */}
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold block mb-2">Services</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {STANDARD_SERVICES.map((s) => {
                  const on = selectedServices.includes(s);
                  return (
                    <button
                      key={s}
                      onClick={() => toggleService(s)}
                      className={`text-left text-sm px-3 py-2 rounded-lg border transition-colors ${
                        on
                          ? "bg-orange-500/10 border-orange-500 text-orange-300"
                          : "bg-white/5 border-white/10 text-gray-300 hover:border-white/30"
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
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
                onClick={async () => { setOpenJobWarning(null); setSaving(true); await createJob(); }}
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
