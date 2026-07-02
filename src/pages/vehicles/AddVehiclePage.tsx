import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  collection, query, where, getDocs, addDoc, updateDoc, doc, getDoc, Timestamp,
  orderBy, arrayUnion, setDoc,
} from "firebase/firestore";
import { ref, uploadString, getDownloadURL } from "firebase/storage";
import QRCode from "qrcode";
import {
  ArrowLeft, Car, AlertCircle, ExternalLink, ChevronDown,
} from "lucide-react";
import { db, storage } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { Customer, Vehicle } from "../../types/auth";
import { useTranslation } from "react-i18next";


const DEFAULT_OIL_BRANDS = ["Castrol", "Mobil", "Shell", "Caltex", "Elf", "Total", "SinoPec"];
const DEFAULT_OIL_GRADES = ["5W-30", "10W-40", "15W-40", "0W-20", "5W-20"];
const DEFAULT_VEHICLE_TYPES = ["car", "van", "lorry", "motor bike"];

interface AutocompleteProps {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  /** When true, shows an explicit "Add" option for values not yet in the list. */
  allowAdd?: boolean;
}

function Autocomplete({ value, onChange, suggestions, placeholder, className, disabled, id, allowAdd }: AutocompleteProps) {
  const [open, setOpen] = useState(false);
  const filtered = suggestions.filter((s) => s.toLowerCase().includes(value.toLowerCase()) && s !== value);
  const trimmed = value.trim();
  const exactExists = suggestions.some((s) => s.toLowerCase() === trimmed.toLowerCase());
  const showAdd = allowAdd && trimmed.length > 0 && !exactExists;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <input
        id={id}
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {open && (filtered.length > 0 || showAdd) && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-[#1e2d42] border border-white/10 rounded-lg shadow-xl overflow-hidden">
          {filtered.slice(0, 8).map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={() => { onChange(s); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-white transition-colors"
            >
              {s}
            </button>
          ))}
          {showAdd && (
            <button
              type="button"
              onMouseDown={() => { onChange(trimmed); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm text-[#F97316] hover:bg-orange-500/10 transition-colors border-t border-white/10 flex items-center gap-1.5"
            >
              <span className="text-base leading-none">+</span> Add "{trimmed}"
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  vehicleId?: string;
  initialData?: Partial<Vehicle>;
}

export default function AddVehiclePage({ vehicleId, initialData }: Props) {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const prefilledCustomerId = searchParams.get("customerId") ?? "";
  const isEdit = !!vehicleId;


  // Form state
  const [plateNumber, setPlateNumber] = useState(initialData?.plateNumber ?? "");
  const [make, setMake] = useState(initialData?.make ?? "");
  const [model, setModel] = useState(initialData?.model ?? "");
  const [vehicleType, setVehicleType] = useState<string>(initialData?.vehicleType ?? "car");
  const [colour, setColour] = useState(initialData?.colour ?? "");
  const [currentMileage, setCurrentMileage] = useState(
    initialData?.currentMileageKm !== undefined ? String(initialData.currentMileageKm) : ""
  );
  const [nextServiceMileage, setNextServiceMileage] = useState(
    initialData?.nextServiceMileageKm !== undefined ? String(initialData.nextServiceMileageKm) : ""
  );
  const [oilBrand, setOilBrand] = useState(initialData?.oilBrand ?? "");
  const [oilGrade, setOilGrade] = useState(initialData?.oilGrade ?? "");
  const [oilViscosityNotes, setOilViscosityNotes] = useState(initialData?.oilViscosityNotes ?? "");
  const [customerId, setCustomerId] = useState(initialData?.customerId ?? prefilledCustomerId);
  const [customerSearch, setCustomerSearch] = useState(initialData?.customerName ?? "");
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [plateChecking, setPlateChecking] = useState(false);
  const [duplicatePlate, setDuplicatePlate] = useState<{ id: string; plateNumber: string } | null>(null);
  const [showDupModal, setShowDupModal] = useState(false);

  // Customer list
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  // Existing makes/models from this center for autocomplete
  const [existingMakes, setExistingMakes] = useState<string[]>([]);
  const [existingModels, setExistingModels] = useState<string[]>([]);
  const [oilBrandOptions, setOilBrandOptions] = useState<string[]>(DEFAULT_OIL_BRANDS);
  const [oilGradeOptions, setOilGradeOptions] = useState<string[]>(DEFAULT_OIL_GRADES);
  const [vehicleTypeOptions, setVehicleTypeOptions] = useState<string[]>(DEFAULT_VEHICLE_TYPES);

  useEffect(() => {
    if (!currentUser?.centerId) return;
    // Load customers
    getDocs(
      query(
        collection(db, "servicecenters", currentUser.centerId, "customers"),
        where("isDeleted", "==", false),
        orderBy("name"),
      )
    ).then((snap) => {
      setCustomers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
      setLoadingCustomers(false);
    });

    // Load existing makes/models + center-level custom oils for autocomplete
    Promise.all([
      getDocs(
        query(
          collection(db, "servicecenters", currentUser.centerId, "vehicles"),
          where("isDeleted", "==", false),
        )
      ),
      getDoc(doc(db, "servicecenters", currentUser.centerId)),
    ]).then(([snap, centerSnap]) => {
      const makes = new Set<string>();
      const models = new Set<string>();
      const brands = new Set<string>(DEFAULT_OIL_BRANDS);
      const grades = new Set<string>(DEFAULT_OIL_GRADES);
      const types = new Set<string>(DEFAULT_VEHICLE_TYPES);
      snap.docs.forEach((d) => {
        const v = d.data() as Vehicle;
        if (v.make) makes.add(v.make);
        if (v.model) models.add(v.model);
        if (v.oilBrand) brands.add(v.oilBrand);
        if (v.oilGrade) grades.add(v.oilGrade);
        if (v.vehicleType) types.add(v.vehicleType);
      });
      // Merge in custom options saved at the service-center level
      const c = centerSnap.data() as {
        customOilBrands?: string[]; customOilGrades?: string[]; customVehicleTypes?: string[];
      } | undefined;
      (c?.customOilBrands ?? []).forEach((b) => brands.add(b));
      (c?.customOilGrades ?? []).forEach((g) => grades.add(g));
      (c?.customVehicleTypes ?? []).forEach((t) => types.add(t));
      setExistingMakes(Array.from(makes).sort());
      setExistingModels(Array.from(models).sort());
      setOilBrandOptions(Array.from(brands).sort());
      setOilGradeOptions(Array.from(grades).sort());
      setVehicleTypeOptions(Array.from(types).sort());
    });
  }, [currentUser?.centerId]);

  // Persist newly-typed oil brand/grade/vehicle type to the center so they're reusable later.
  async function persistCustomOils(brand: string, grade: string, type: string) {
    if (!currentUser?.centerId) return;
    const update: Record<string, unknown> = {};
    if (brand && !DEFAULT_OIL_BRANDS.includes(brand)) update.customOilBrands = arrayUnion(brand);
    if (grade && !DEFAULT_OIL_GRADES.includes(grade)) update.customOilGrades = arrayUnion(grade);
    if (type && !DEFAULT_VEHICLE_TYPES.includes(type)) update.customVehicleTypes = arrayUnion(type);
    if (Object.keys(update).length === 0) return;
    try {
      await setDoc(doc(db, "servicecenters", currentUser.centerId), update, { merge: true });
    } catch {
      /* non-fatal — saving the vehicle is what matters */
    }
  }

  // Prefill customer name if customerId given
  useEffect(() => {
    if (prefilledCustomerId && customers.length > 0 && !initialData?.customerName) {
      const c = customers.find((cu) => cu.id === prefilledCustomerId);
      if (c) setCustomerSearch(c.name);
    }
  }, [customers, prefilledCustomerId, initialData?.customerName]);

  const filteredCustomers = customers.filter(
    (c) => c.name.toLowerCase().includes(customerSearch.toLowerCase())
  );

  const selectedCustomer = customers.find((c) => c.id === customerId);

  async function checkDuplicatePlate(plate: string) {
    if (!plate.trim() || !currentUser?.centerId) return;
    const normalized = plate.trim().toUpperCase();
    setPlateChecking(true);
    try {
      const q = query(
        collection(db, "servicecenters", currentUser.centerId, "vehicles"),
        where("plateNumber", "==", normalized),
        where("isDeleted", "==", false),
      );
      const snap = await getDocs(q);
      const found = snap.docs.find((d) => d.id !== vehicleId);
      if (found) {
        setDuplicatePlate({ id: found.id, plateNumber: normalized });
        setShowDupModal(true);
      } else {
        setDuplicatePlate(null);
      }
    } finally {
      setPlateChecking(false);
    }
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!plateNumber.trim()) errs.plate = "Plate number is required";
    if (!customerId) errs.customer = "Customer is required";
    const curKm = parseInt(currentMileage);
    if (currentMileage === "" || isNaN(curKm) || curKm < 0) {
      errs.currentMileage = "Current mileage must be 0 or greater";
    }
    const nextKm = parseInt(nextServiceMileage);
    if (nextServiceMileage === "" || isNaN(nextKm)) {
      errs.nextServiceMileage = "Next service mileage is required";
    } else if (!isNaN(curKm) && nextKm <= curKm) {
      errs.nextServiceMileage = "Next service mileage must be greater than current mileage";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate() || !currentUser?.centerId) return;
    await doSave();
  }

  async function doSave() {
    if (!currentUser?.centerId) return;
    setSubmitting(true);
    try {
      const plate = plateNumber.trim().toUpperCase();
      const customer = customers.find((c) => c.id === customerId)!;
      // Save any new custom oil brand/grade/vehicle type for reuse across the center
      await persistCustomOils(oilBrand.trim(), oilGrade.trim(), vehicleType.trim());
      const payload = {
        plateNumber: plate,
        make: make.trim() || null,
        model: model.trim() || null,
        vehicleType: vehicleType.trim() || "car",
        colour: colour.trim() || null,
        customerId,
        customerName: customer.name,
        currentMileageKm: parseInt(currentMileage),
        nextServiceMileageKm: parseInt(nextServiceMileage),
        oilBrand: oilBrand.trim() || null,
        oilGrade: oilGrade.trim() || null,
        oilViscosityNotes: oilViscosityNotes.trim() || null,
        centerId: currentUser.centerId,
        isDeleted: false,
        updatedAt: Timestamp.now(),
      };

      if (isEdit && vehicleId) {
        await updateDoc(
          doc(db, "servicecenters", currentUser.centerId, "vehicles", vehicleId),
          payload,
        );
        navigate(`/vehicles/${vehicleId}`);
      } else {
        const docRef = await addDoc(
          collection(db, "servicecenters", currentUser.centerId, "vehicles"),
          { ...payload, photoUrls: [], createdAt: Timestamp.now() },
        );
        // Generate and store QR code
        try {
          const url = `https://pitstopiq.com/v/${docRef.id}`;
          const dataUrl = await QRCode.toDataURL(url, { width: 300, margin: 2 });
          const storageRef = ref(storage, `servicecenters/${currentUser.centerId}/vehicles/${docRef.id}/qr.png`);
          await uploadString(storageRef, dataUrl, "data_url");
          const downloadURL = await getDownloadURL(storageRef);
          await updateDoc(docRef, { qrCodeUrl: downloadURL });
        } catch {
          // QR generation failure is non-fatal
        }
        navigate(`/vehicles/${docRef.id}`);
      }
    } catch (err) {
      console.error(err);
      setErrors({ submit: "Failed to save vehicle. Please try again." });
      setSubmitting(false);
    }
  }

  const inputClass = (field: string) =>
    `w-full bg-[#0B1120] border rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#F97316]/60 ${
      errors[field] ? "border-red-500" : "border-white/10"
    }`;

  const role = currentUser?.role;
  if (role === "Technician" || role === "Cashier") {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <Car className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to add or edit vehicles.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <div className="border-b border-white/10 bg-[#0B1120]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <button
            onClick={() => navigate(isEdit && vehicleId ? `/vehicles/${vehicleId}` : "/vehicles")}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Car className="w-5 h-5 text-[#F97316]" />
          <h1 className="text-xl font-bold">{isEdit ? t("vehicles.editVehicle") : t("vehicles.addVehicle")}</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Basic Info */}
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 space-y-5">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Vehicle Details</h2>

            {/* Plate Number */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">
                Plate Number <span className="text-[#F97316]">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={plateNumber}
                  onChange={(e) => { setPlateNumber(e.target.value.toUpperCase()); setDuplicatePlate(null); }}
                  onBlur={(e) => checkDuplicatePlate(e.target.value)}
                  placeholder="e.g. CAB-1234 or WP CAB 1234"
                  className={inputClass("plate")}
                />
                {plateChecking && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>
              {errors.plate && <FieldError msg={errors.plate} />}
              <p className="text-xs text-gray-500">Auto-converted to UPPERCASE</p>
            </div>

            {/* Vehicle Type */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">
                Type <span className="text-[#F97316]">*</span>
              </label>
              <Autocomplete
                value={vehicleType}
                onChange={setVehicleType}
                suggestions={vehicleTypeOptions}
                allowAdd
                placeholder="Pick a category or type a new one"
                className={inputClass("vehicleType")}
              />
              <p className="text-xs text-gray-500">Type any new category to add it</p>
            </div>

            {/* Make */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">
                Make <span className="text-gray-500 font-normal">(optional)</span>
              </label>
              <Autocomplete
                value={make}
                onChange={setMake}
                suggestions={existingMakes}
                placeholder="e.g. Toyota, Honda, Suzuki"
                className={inputClass("make")}
              />
            </div>

            {/* Model */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">
                Model <span className="text-gray-500 font-normal">(optional)</span>
              </label>
              <Autocomplete
                value={model}
                onChange={setModel}
                suggestions={existingModels}
                placeholder="e.g. Corolla, Civic, Alto"
                className={inputClass("model")}
              />
            </div>

            {/* Colour */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">
                Colour <span className="text-gray-500 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={colour}
                onChange={(e) => setColour(e.target.value)}
                placeholder="e.g. Silver"
                className={inputClass("colour")}
              />
            </div>

            {/* Customer */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">
                Customer <span className="text-[#F97316]">*</span>
              </label>
              <div className="relative">
                <div
                  className={`w-full bg-[#0B1120] border rounded-lg px-4 py-2.5 text-sm flex items-center justify-between cursor-pointer ${
                    errors.customer ? "border-red-500" : "border-white/10"
                  } ${customerDropdownOpen ? "border-[#F97316]/60" : ""}`}
                  onClick={() => setCustomerDropdownOpen((o) => !o)}
                >
                  <span className={selectedCustomer ? "text-white" : "text-gray-600"}>
                    {selectedCustomer ? selectedCustomer.name : "Search customer…"}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${customerDropdownOpen ? "rotate-180" : ""}`} />
                </div>
                {customerDropdownOpen && (
                  <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-[#1e2d42] border border-white/10 rounded-lg shadow-xl overflow-hidden">
                    <div className="p-2 border-b border-white/10">
                      <input
                        type="text"
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                        placeholder="Type to search…"
                        className="w-full bg-[#0B1120] border border-white/10 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#F97316]/50"
                        autoFocus
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {loadingCustomers ? (
                        <div className="px-3 py-2 text-sm text-gray-500">Loading…</div>
                      ) : filteredCustomers.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-gray-500">No customers found</div>
                      ) : (
                        filteredCustomers.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setCustomerId(c.id);
                              setCustomerSearch(c.name);
                              setCustomerDropdownOpen(false);
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-white transition-colors"
                          >
                            {c.name}
                          </button>
                        ))
                      )}
                      <button
                        type="button"
                        onClick={() => navigate("/customers/add")}
                        className="w-full text-left px-3 py-2 text-sm text-[#F97316] hover:bg-orange-500/10 transition-colors border-t border-white/10"
                      >
                        + Add new customer
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {errors.customer && <FieldError msg={errors.customer} />}
            </div>
          </div>

          {/* Mileage */}
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 space-y-5">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Mileage</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-300">
                  Current Mileage (km) <span className="text-[#F97316]">*</span>
                </label>
                <input
                  type="number"
                  value={currentMileage}
                  onChange={(e) => setCurrentMileage(e.target.value)}
                  placeholder="e.g. 45000"
                  min={0}
                  className={inputClass("currentMileage")}
                />
                {errors.currentMileage && <FieldError msg={errors.currentMileage} />}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-300">
                  Next Service (km) <span className="text-[#F97316]">*</span>
                </label>
                <input
                  type="number"
                  value={nextServiceMileage}
                  onChange={(e) => setNextServiceMileage(e.target.value)}
                  placeholder="e.g. 50000"
                  min={0}
                  className={inputClass("nextServiceMileage")}
                />
                {errors.nextServiceMileage && <FieldError msg={errors.nextServiceMileage} />}
              </div>
            </div>
          </div>

          {/* Oil */}
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 space-y-5">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
              Oil Data <span className="text-gray-500 font-normal normal-case">(optional)</span>
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-300">Oil Brand</label>
                <Autocomplete
                  value={oilBrand}
                  onChange={setOilBrand}
                  suggestions={oilBrandOptions}
                  allowAdd
                  placeholder="Type to add new or pick existing"
                  className={inputClass("oilBrand")}
                />
                <p className="text-xs text-gray-500">Type any new brand to add it</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-300">Oil Grade</label>
                <Autocomplete
                  value={oilGrade}
                  onChange={setOilGrade}
                  suggestions={oilGradeOptions}
                  allowAdd
                  placeholder="Type to add new or pick existing"
                  className={inputClass("oilGrade")}
                />
                <p className="text-xs text-gray-500">Type any new grade to add it</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">Oil Viscosity Notes</label>
              <input
                type="text"
                value={oilViscosityNotes}
                onChange={(e) => setOilViscosityNotes(e.target.value)}
                placeholder="e.g. Full synthetic"
                className={inputClass("oilViscosityNotes")}
              />
            </div>
          </div>

          {errors.submit && (
            <p className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0" /> {errors.submit}
            </p>
          )}

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={() => navigate(isEdit && vehicleId ? `/vehicles/${vehicleId}` : "/vehicles")}
              className="px-5 py-2.5 text-sm text-gray-300 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-[#F97316] hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              {submitting && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              {isEdit ? t("settings.saveChanges") : "Add Vehicle"}
            </button>
          </div>
        </form>
      </div>

      {/* Duplicate Plate Modal */}
      {showDupModal && duplicatePlate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="font-semibold text-white mb-1">Plate Already Registered</h3>
                <p className="text-sm text-gray-400">
                  <span className="text-white font-medium">{duplicatePlate.plateNumber}</span> is already registered.
                  View the existing record?
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 mt-5">
              <button
                onClick={() => navigate(`/vehicles/${duplicatePlate.id}`)}
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium border border-white/10 hover:border-white/20 text-gray-300 hover:text-white rounded-lg transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                View existing record
              </button>
              <button
                onClick={() => setShowDupModal(false)}
                className="w-full px-4 py-2 text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                Go back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldError({ msg }: { msg: string }) {
  return (
    <p className="flex items-center gap-1 text-xs text-red-400">
      <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {msg}
    </p>
  );
}
