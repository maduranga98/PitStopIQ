import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  collection, query, where, getDocs, doc, getDoc, Timestamp, arrayUnion,
} from "firebase/firestore";
import { safeAddDoc, safeUpdateDoc, safeSetDoc } from "../../lib/firestoreWrite";
import { ref, uploadString, getDownloadURL } from "firebase/storage";
import QRCode from "qrcode";
import {
  ArrowLeft, Car, AlertCircle, ExternalLink, ChevronDown, Check, X, Search, Plus,
} from "lucide-react";
import { db, storage } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { Customer, Vehicle } from "../../types/auth";
import { useTranslation } from "react-i18next";
import { DEFAULT_OIL_BRANDS, DEFAULT_OIL_GRADES, DEFAULT_VEHICLE_TYPES, withoutHiddenTypes } from "../../lib/vehicleOptions";
import { getOrCreateShortLink, fullShortLink } from "../../lib/shortLinks";
import { buildViewLink } from "../../lib/smsTemplates";
import { logVehicleEvent } from "../../lib/vehicleLogs";
import { fetchCustomers, fetchVehicles } from "../../lib/refData";

// A vehicle's next service mileage isn't asked for when it's registered — it's
// set for real when a job is closed out. A new vehicle starts one standard
// interval ahead so the dashboard's service-due list has something to work
// with; ServiceDetailPage uses the same interval as its default.
const DEFAULT_SERVICE_INTERVAL_KM = 5000;

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
  /** Fired when the user confirms adding a brand-new value via the "+ Add" row. */
  onAdd?: (value: string) => void;
}

function Autocomplete({ value, onChange, suggestions, placeholder, className, disabled, id, allowAdd, onAdd }: AutocompleteProps) {
  const [open, setOpen] = useState(false);
  // The typed query is kept apart from the committed value so opening the list
  // shows every option instead of the ones matching the current selection —
  // centers with 18 vehicle types shouldn't have to clear the box to browse.
  const [queryText, setQueryText] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const trimmed = queryText.trim();
  const filtered = useMemo(() => {
    const q = trimmed.toLowerCase();
    if (!q) return suggestions;
    // Prefix matches first: typing "l" should surface "lorry" before "trailer".
    return suggestions
      .filter((s) => s.toLowerCase().includes(q))
      .sort((a, b) => Number(b.toLowerCase().startsWith(q)) - Number(a.toLowerCase().startsWith(q)));
  }, [suggestions, trimmed]);
  const exactExists = suggestions.some((s) => s.toLowerCase() === trimmed.toLowerCase());
  const showAdd = !!allowAdd && trimmed.length > 0 && !exactExists;
  const rowCount = filtered.length + (showAdd ? 1 : 0);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQueryText("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function openList() {
    if (disabled) return;
    setOpen(true);
    setActiveIndex(Math.max(0, filtered.indexOf(value)));
  }

  function commit(v: string, isNew = false) {
    onChange(v);
    if (isNew) onAdd?.(v);
    setQueryText("");
    setOpen(false);
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { openList(); return; }
      if (rowCount === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => (i + step + rowCount) % rowCount);
    } else if (e.key === "Enter") {
      if (!open || rowCount === 0) return;
      e.preventDefault();
      if (activeIndex < filtered.length) commit(filtered[activeIndex]);
      else commit(trimmed, true);
    } else if (e.key === "Escape") {
      if (!open) return;
      e.preventDefault();
      setOpen(false);
      setQueryText("");
    }
  }

  // While the list is open the input doubles as the search box; closed, it just
  // displays the current selection.
  const shown = open ? queryText : value;

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        {open && (
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
        )}
        <input
          id={id}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          value={shown}
          disabled={disabled}
          onChange={(e) => { setQueryText(e.target.value); setOpen(true); setActiveIndex(0); }}
          onFocus={openList}
          onClick={openList}
          onKeyDown={handleKeyDown}
          placeholder={open ? (value ? `Search… (${value})` : "Search…") : placeholder}
          className={`${className ?? ""} ${open ? "pl-9" : ""} pr-16`}
          autoComplete="off"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {!!value && !disabled && (
            <button
              type="button"
              aria-label="Clear"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(""); setQueryText(""); setOpen(true); inputRef.current?.focus(); }}
              className="p-1 rounded-md text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            aria-label="Toggle options"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (open ? (setOpen(false), setQueryText("")) : (openList(), inputRef.current?.focus()))}
            className="p-1 rounded-md text-gray-400 hover:text-white transition-colors disabled:opacity-40"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {open && (
        <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-[#1e2d42] border border-white/10 rounded-lg shadow-xl overflow-hidden">
          {/* Capped height + scroll: an 18-item list stays a dropdown, not a page. */}
          <div ref={listRef} role="listbox" className="max-h-56 overflow-y-auto overscroll-contain py-1">
            {filtered.map((s, i) => {
              const selected = s === value;
              return (
                <button
                  key={s}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-active={i === activeIndex}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(e) => { e.preventDefault(); commit(s); }}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 transition-colors ${
                    i === activeIndex ? "bg-white/10 text-white" : "text-gray-300"
                  }`}
                >
                  <span className="truncate capitalize">{s}</span>
                  {selected && <Check className="h-4 w-4 text-[#F97316] shrink-0" />}
                </button>
              );
            })}
            {filtered.length === 0 && !showAdd && (
              <p className="px-3 py-3 text-sm text-gray-500">No matches</p>
            )}
          </div>
          {showAdd && (
            <button
              type="button"
              role="option"
              aria-selected={activeIndex === filtered.length}
              data-active={activeIndex === filtered.length}
              onMouseEnter={() => setActiveIndex(filtered.length)}
              onMouseDown={(e) => { e.preventDefault(); commit(trimmed, true); }}
              className={`w-full text-left px-3 py-2 text-sm text-[#F97316] transition-colors border-t border-white/10 flex items-center gap-1.5 ${
                activeIndex === filtered.length ? "bg-orange-500/10" : ""
              }`}
            >
              <Plus className="h-3.5 w-3.5" /> Add &ldquo;{trimmed}&rdquo;
            </button>
          )}
          {suggestions.length > 8 && (
            <div className="px-3 py-1.5 border-t border-white/10 text-[11px] text-gray-500">
              {filtered.length} of {suggestions.length} options
            </div>
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
  const [vehicleType, setVehicleType] = useState<string>(initialData?.vehicleType ?? "");
  const [colour, setColour] = useState(initialData?.colour ?? "");
  const [currentMileage, setCurrentMileage] = useState(
    initialData?.currentMileageKm !== undefined ? String(initialData.currentMileageKm) : ""
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
    const centerId = currentUser?.centerId;
    if (!centerId) return;
    // Load customers from the reference cache (see lib/refData.ts).
    fetchCustomers(centerId).then((list) => {
      setCustomers(list);
      setLoadingCustomers(false);
    });

    // Load existing makes/models + center-level custom oils for autocomplete.
    // The vehicle list is the cached one — this page only mines it for
    // autocomplete values, which never justified its own full-collection read.
    Promise.all([
      fetchVehicles(centerId),
      getDoc(doc(db, "servicecenters", centerId)),
    ]).then(([vehicleList, centerSnap]) => {
      const makes = new Set<string>();
      const models = new Set<string>();
      const brands = new Set<string>(DEFAULT_OIL_BRANDS);
      const grades = new Set<string>(DEFAULT_OIL_GRADES);
      const types = new Set<string>(DEFAULT_VEHICLE_TYPES);
      vehicleList.forEach((v) => {
        if (v.make) makes.add(v.make);
        if (v.model) models.add(v.model);
        if (v.oilBrand) brands.add(v.oilBrand);
        if (v.oilGrade) grades.add(v.oilGrade);
        if (v.vehicleType) types.add(v.vehicleType);
      });
      // Merge in custom options saved at the service-center level
      const c = centerSnap.data() as {
        customOilBrands?: string[]; customOilGrades?: string[]; customVehicleTypes?: string[];
        hiddenVehicleTypes?: string[];
      } | undefined;
      (c?.customOilBrands ?? []).forEach((b) => brands.add(b));
      (c?.customOilGrades ?? []).forEach((g) => grades.add(g));
      (c?.customVehicleTypes ?? []).forEach((t) => types.add(t));
      setExistingMakes(Array.from(makes).sort());
      setExistingModels(Array.from(models).sort());
      setOilBrandOptions(Array.from(brands).sort());
      setOilGradeOptions(Array.from(grades).sort());
      // Types the catalog removed are no longer offered here either.
      setVehicleTypeOptions(withoutHiddenTypes(types, c?.hiddenVehicleTypes ?? []));
    });
  }, [currentUser?.centerId]);

  // Add a custom oil brand/grade to the center's reusable option list right
  // away (when the user confirms the "+ Add" row), so it's saved even before
  // the vehicle itself is saved, and shows up in the suggestions immediately.
  async function addOilOption(kind: "brand" | "grade", value: string) {
    const v = value.trim();
    if (!v || !currentUser?.centerId) return;
    const defaults = kind === "brand" ? DEFAULT_OIL_BRANDS : DEFAULT_OIL_GRADES;
    if (kind === "brand") setOilBrandOptions((prev) => Array.from(new Set([...prev, v])).sort());
    else setOilGradeOptions((prev) => Array.from(new Set([...prev, v])).sort());
    if (defaults.includes(v)) return;
    const field = kind === "brand" ? "customOilBrands" : "customOilGrades";
    try {
      await safeSetDoc(doc(db, "servicecenters", currentUser.centerId), { [field]: arrayUnion(v) }, { merge: true });
    } catch {
      /* non-fatal — it will also be persisted when the vehicle is saved */
    }
  }

  // Persist newly-typed oil brand/grade/vehicle type to the center so they're reusable later.
  async function persistCustomOils(brand: string, grade: string, type: string) {
    if (!currentUser?.centerId) return;
    const update: Record<string, unknown> = {};
    if (brand && !DEFAULT_OIL_BRANDS.includes(brand)) update.customOilBrands = arrayUnion(brand);
    if (grade && !DEFAULT_OIL_GRADES.includes(grade)) update.customOilGrades = arrayUnion(grade);
    if (type && !DEFAULT_VEHICLE_TYPES.includes(type)) update.customVehicleTypes = arrayUnion(type);
    if (Object.keys(update).length === 0) return;
    try {
      await safeSetDoc(doc(db, "servicecenters", currentUser.centerId), update, { merge: true });
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
    if (!vehicleType.trim()) errs.vehicleType = "Vehicle type is required";
    // Mileage is optional — a vehicle can be registered before anyone reads
    // the odometer. A figure that *is* typed still has to be a sane one.
    if (currentMileage.trim() !== "") {
      const curKm = parseInt(currentMileage, 10);
      if (isNaN(curKm) || curKm < 0) {
        errs.currentMileage = "Current mileage must be 0 or greater";
      }
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
      const enteredMileage = currentMileage.trim() === "" ? null : parseInt(currentMileage, 10);
      // Save any new custom oil brand/grade/vehicle type for reuse across the center
      await persistCustomOils(oilBrand.trim(), oilGrade.trim(), vehicleType.trim());
      const payload = {
        plateNumber: plate,
        make: make.trim() || null,
        model: model.trim() || null,
        vehicleType: vehicleType.trim(),
        colour: colour.trim() || null,
        customerId,
        customerName: customer.name,
        currentMileageKm: enteredMileage,
        // No longer asked for on the form: the next service is set properly
        // when a job is closed out, so a new vehicle just starts one standard
        // interval ahead and an existing one keeps whatever it already had.
        // With no reading at all there is nothing to count down from, so the
        // due figure stays empty until a job records one.
        nextServiceMileageKm:
          initialData?.nextServiceMileageKm
          ?? (enteredMileage === null ? null : enteredMileage + DEFAULT_SERVICE_INTERVAL_KM),
        oilBrand: oilBrand.trim() || null,
        oilGrade: oilGrade.trim() || null,
        oilViscosityNotes: oilViscosityNotes.trim() || null,
        centerId: currentUser.centerId,
        isDeleted: false,
        updatedAt: Timestamp.now(),
      };

      if (isEdit && vehicleId) {
        await safeUpdateDoc(
          doc(db, "servicecenters", currentUser.centerId, "vehicles", vehicleId),
          payload,
        );
        const changes = buildEditChangeSummary(initialData, {
          make: payload.make, model: payload.model, colour: payload.colour,
          currentMileageKm: payload.currentMileageKm, nextServiceMileageKm: payload.nextServiceMileageKm,
          oilBrand: payload.oilBrand, oilGrade: payload.oilGrade, oilViscosityNotes: payload.oilViscosityNotes,
        });
        if (changes.length > 0) {
          void logVehicleEvent(currentUser.centerId, vehicleId, {
            type: "system",
            message: `Vehicle updated — ${changes.join("; ")}`,
            actor: currentUser,
          });
        }
        navigate(`/vehicles/${vehicleId}`);
      } else {
        const docRef = await safeAddDoc(
          collection(db, "servicecenters", currentUser.centerId, "vehicles"),
          { ...payload, photoUrls: [], createdAt: Timestamp.now() },
        );
        void logVehicleEvent(currentUser.centerId, docRef.id, {
          type: "system",
          message: `Vehicle added — ${payload.plateNumber}`
            + (payload.currentMileageKm === null ? "" : `, ${payload.currentMileageKm.toLocaleString()} km`),
          actor: currentUser,
        });
        // Generate and store QR code. It must encode a link the public /v/
        // resolver understands — a short-link code that maps to the customer's
        // self-service view — not the vehicle id. Fall back to the full /c/
        // link if a short code can't be minted.
        try {
          const code = await getOrCreateShortLink(currentUser.centerId, customerId).catch(() => null);
          const target = code ? fullShortLink(code) : buildViewLink(currentUser.centerId, customerId);
          const dataUrl = await QRCode.toDataURL(target, { width: 300, margin: 2 });
          const storageRef = ref(storage, `servicecenters/${currentUser.centerId}/vehicles/${docRef.id}/qr.png`);
          await uploadString(storageRef, dataUrl, "data_url");
          const downloadURL = await getDownloadURL(storageRef);
          await safeUpdateDoc(docRef, { qrCodeUrl: downloadURL, qrEncodesShortLink: true });
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
                placeholder="Select a vehicle type"
                className={inputClass("vehicleType")}
              />
              {errors.vehicleType && <FieldError msg={errors.vehicleType} />}
              <p className="text-xs text-gray-500">Search the list, or type a new category to add it</p>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-300">
                  Current Mileage (km)
                  <span className="text-gray-500 font-normal"> (optional)</span>
                </label>
                <input
                  type="number"
                  value={currentMileage}
                  onChange={(e) => setCurrentMileage(e.target.value)}
                  placeholder="e.g. 45000 — leave blank if unknown"
                  min={0}
                  className={inputClass("currentMileage")}
                />
                {errors.currentMileage && <FieldError msg={errors.currentMileage} />}
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
                  onAdd={(v) => addOilOption("brand", v)}
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
                  onAdd={(v) => addOilOption("grade", v)}
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

// Compares the vehicle's prior values against the fields just saved and
// returns a short human-readable list of what changed, for the activity log.
function buildEditChangeSummary(
  before: Partial<Vehicle> | undefined,
  after: {
    make: string | null; model: string | null; colour: string | null;
    currentMileageKm: number | null; nextServiceMileageKm: number | null;
    oilBrand: string | null; oilGrade: string | null; oilViscosityNotes: string | null;
  },
): string[] {
  if (!before) return [];
  const changes: string[] = [];
  const km = (v: number | null | undefined) => (v == null ? "—" : `${v.toLocaleString()} km`);
  if ((before.currentMileageKm ?? null) !== after.currentMileageKm) {
    changes.push(`mileage ${km(before.currentMileageKm)} → ${km(after.currentMileageKm)}`);
  }
  if ((before.nextServiceMileageKm ?? null) !== after.nextServiceMileageKm) {
    changes.push(`next service ${km(before.nextServiceMileageKm)} → ${km(after.nextServiceMileageKm)}`);
  }
  if ((before.make ?? "") !== (after.make ?? "")) changes.push(`make → ${after.make ?? "—"}`);
  if ((before.model ?? "") !== (after.model ?? "")) changes.push(`model → ${after.model ?? "—"}`);
  if ((before.colour ?? "") !== (after.colour ?? "")) changes.push(`colour → ${after.colour ?? "—"}`);
  if ((before.oilBrand ?? "") !== (after.oilBrand ?? "")) changes.push(`oil brand → ${after.oilBrand ?? "—"}`);
  if ((before.oilGrade ?? "") !== (after.oilGrade ?? "")) changes.push(`oil grade → ${after.oilGrade ?? "—"}`);
  if ((before.oilViscosityNotes ?? "") !== (after.oilViscosityNotes ?? "")) changes.push("oil notes updated");
  return changes;
}

function FieldError({ msg }: { msg: string }) {
  return (
    <p className="flex items-center gap-1 text-xs text-red-400">
      <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {msg}
    </p>
  );
}
