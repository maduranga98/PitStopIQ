import { memo, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, query, where, doc, orderBy, serverTimestamp,
  type DocumentReference, type WriteBatch,
} from "firebase/firestore";
import { watchQuery } from "../../lib/listeners";
import { safeUpdateDoc } from "../../lib/firestoreWrite";
import { ReadTimeoutError, boundedGetDoc, boundedGetDocs } from "../../lib/firestoreRead";
import {
  buildCatalogIndex, catalogPrice, resolveFromIndex, vehicleTypeLabel, serviceNamesFromIndex,
} from "../../lib/servicePricing";
import { createServiceJob } from "../../lib/jobCreation";
import { signatureFields } from "../../lib/jobSignature";
import CustomerSignatureModal, { type CapturedSignature } from "../../components/services/CustomerSignatureModal";
import { blankServiceLine } from "../../lib/serviceLines";
import { useServiceBays } from "../../hooks/useWorkshopModules";
import { useCustomerSearch } from "../../hooks/useCustomerSearch";
import { ArrowLeft, X, Car, AlertTriangle, ChevronRight, Settings as SettingsIcon, Tag, Check, Users, UserPlus, Package, PenLine, ShieldOff } from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import type { Customer, Vehicle, StaffMember, ServicePriceItem, InventoryItem, PartUsed } from "../../types/auth";
import { staffDisplayName } from "../../lib/jobTechnicians";
import { serviceCenterPriceOf, purchasePriceOf } from "../../lib/inventoryPricing";
import { searchInventoryItems } from "../../lib/inventorySearch";
import {
  fetchCustomers, fetchVehicles, fetchVehiclesForCustomer, fetchTechnicians,
} from "../../lib/refData";
import { formatKm } from "../../lib/vehicleMileage";
import { DEFAULT_VEHICLE_TYPES, withoutHiddenTypes } from "../../lib/vehicleOptions";
import { useTranslation } from "react-i18next";


// Built once, not per price. Intl.NumberFormat constructs a whole locale
// formatter each time it is called, and Number#toLocaleString constructs one
// per call — so a catalog of 60 services was building 60 of them on every
// keystroke in the step-3 form. Reusing one instance is the same output.
const lkr = new Intl.NumberFormat();

// Module level, not inside the page component. Defined inside, React sees a
// BRAND NEW component type on every render, so the three step circles are
// unmounted and remounted for every keystroke anywhere on the page — which is
// also what react-hooks/static-components was reporting on each of its call
// sites.
function StepCircle({ n, label, step }: { n: number; label: string; step: number }) {
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
}

/**
 * The step-3 service picker.
 *
 * Its own memoised component because it is the most expensive thing on the
 * page — one button per priced service, each resolving a catalog entry and
 * formatting a price — and it does not depend on anything else in the form.
 * Inline in the page body it was rebuilt on every keystroke in mileage,
 * notes or the part search, none of which can change a single one of these
 * buttons. All four props are stable between those keystrokes (`names` and
 * `resolve` are memoised on the catalog and vehicle type, `onToggle` is a
 * useCallback with no deps), so memo actually holds.
 */
const ServiceGrid = memo(function ServiceGrid({
  names, selected, resolve, onToggle,
}: {
  names: string[];
  selected: string[];
  resolve: (name: string) => ServicePriceItem | undefined;
  onToggle: (name: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {names.map((name) => {
        const item = resolve(name);
        const on = selected.includes(name);
        return (
          <button
            key={name}
            onClick={() => onToggle(name)}
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
              ? <span className="text-xs text-gray-400 flex-shrink-0">LKR {lkr.format(catalogPrice(item))}</span>
              : <span className="text-[10px] text-gray-600 flex-shrink-0">No price</span>}
          </button>
        );
      })}
    </div>
  );
});

export default function NewServicePage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
  }, [currentUser, navigate]);

  const [step, setStep] = useState(1);

  // Fetch the job card's chunk while the form is still being filled in. Create
  // navigates straight to it, so on a slow phone the spinner after Create used
  // to cover a 78 kB chunk download that had not started until that moment.
  // Step 3 is the last step, so by the time the button is tapped the chunk is
  // usually already parsed. Failures are ignored on purpose: this is a
  // prefetch, and the route's own lazy import still loads it on navigation.
  useEffect(() => {
    if (step === 3) void import("./ServiceDetailPage").catch(() => {});
  }, [step]);

  // Who the job is for. A workshop sees plenty of vehicles that will never
  // come back — a tourist, a passing breakdown — and registering a customer
  // for each one only fills the book with names nobody will search for. A
  // walk-in job carries the plate and whatever name was given, and nothing
  // is written to the customer or vehicle lists. Same choice a bill offers.
  const [jobMode, setJobMode] = useState<"customer" | "walkin">("customer");
  const isWalkIn = jobMode === "walkin";
  const [walkInName, setWalkInName] = useState("");
  const [walkInPhone, setWalkInPhone] = useState("");
  const [walkInPlate, setWalkInPlate] = useState("");
  const [walkInMake, setWalkInMake] = useState("");
  const [walkInModel, setWalkInModel] = useState("");
  const [walkInVehicleType, setWalkInVehicleType] = useState("");

  // Step 1: Customer (existing only)
  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
  // Distinguishes "still fetching" from "confirmed zero customers" — without
  // this, an empty array during a slow load and a genuinely empty center
  // render the exact same "No customers yet" message, so a fetch that is
  // still in flight reads as a final answer.
  const [customersLoaded, setCustomersLoaded] = useState(false);
  const [allVehicles, setAllVehicles] = useState<{ customerId: string; plateNumber: string }[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");

  // Step 2: Vehicle (customer's only)
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);

  // Service catalog (priced)
  const [catalog, setCatalog] = useState<ServicePriceItem[]>([]);
  // Same "still loading" vs "confirmed empty" distinction as customersLoaded
  // above, for the catalog's onSnapshot listener. Stored as the center it
  // settled for rather than a bare boolean: switching center has to reset it,
  // and deriving that below beats clearing it from inside the effect (which
  // would be a synchronous setState, and a second render on every mount).
  const [catalogLoadedFor, setCatalogLoadedFor] = useState<string | null>(null);

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
  // The valuables waiver, for the customers who want one signed before the
  // workshop touches the vehicle. Offered like the walk-in / registered
  // choice on a bill — one of two cards — and never required: `signature`
  // stays null unless the customer actually signs.
  const [signatureRequired, setSignatureRequired] = useState(false);
  const [signature, setSignature] = useState<CapturedSignature | null>(null);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [jobError, setJobError] = useState("");
  const [saving, setSaving] = useState(false);

  // Open job warning — the modal that gates the Create button.
  const [openJobWarning, setOpenJobWarning] = useState<{ jobId: string } | null>(null);
  // The open job found by the background pre-check (see below), if any. Carries
  // the vehicle it was found for so a result from a previous pick is simply not
  // rendered, rather than having to be cleared — one less state write, and no
  // window in which the wrong vehicle's warning is on screen.
  const [openJobFound, setOpenJobFound] =
    useState<{ vehicleId: string; jobId: string } | null>(null);

  const [centerPlan, setCenterPlan] = useState<"basic" | "pro">("basic");
  // Whether this center runs vehicle inspections at all — if so, Step 3 offers
  // to name an inspector; the inspection itself happens later, after the job
  // starts (see ServiceDetailPage).
  const [inspectionEnabled, setInspectionEnabled] = useState(false);
  // The two optional workshop modules. Both off for the great majority of
  // centers, in which case Step 3 renders exactly as it did before they
  // existed — no extra fields, no extra reads, no `serviceLines` on the job.
  const [bayWorkflowEnabled, setBayWorkflowEnabled] = useState(false);
  const [commissionEnabled, setCommissionEnabled] = useState(false);
  // Whether this center takes the valuables waiver at all (Settings →
  // Services & Modules). Off for most, in which case the new-job form shows
  // nothing about signatures.
  const [signatureEnabled, setSignatureEnabled] = useState(false);
  // Who performs each service, and which bay it goes to. Keyed by service
  // name, so it survives services being toggled off and back on. Never
  // required: a job saves fine with every one of these blank.
  const [lineAssignments, setLineAssignments] = useState<
    Record<string, { technicianId: string; bayId: string }>
  >({});

  // The vehicle types a walk-in can be tagged with — the built-ins plus
  // whatever this center added on the vehicle form, minus the ones it
  // removed from the catalog. Same list the vehicle form offers.
  const [vehicleTypeOptions, setVehicleTypeOptions] = useState<string[]>(DEFAULT_VEHICLE_TYPES);

  // Load center inspection settings
  useEffect(() => {
    if (!currentUser?.centerId) return;
    boundedGetDoc(doc(db, "servicecenters", currentUser.centerId)).then((snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setCenterPlan(d.plan ?? "basic");
        setVehicleTypeOptions(withoutHiddenTypes(
          [...DEFAULT_VEHICLE_TYPES, ...((d.customVehicleTypes as string[] | undefined) ?? [])],
          (d.hiddenVehicleTypes as string[] | undefined) ?? [],
        ));
        setInspectionEnabled(d.inspectionEnabled === true);
        setBayWorkflowEnabled(d.bayWorkflowEnabled === true);
        setCommissionEnabled(d.commissionEnabled === true);
        setSignatureEnabled(d.customerSignatureEnabled === true);
      }
    });
  }, [currentUser?.centerId]);

  // Load all customers and vehicles for dropdown search. Both come from the
  // reference cache (see lib/refData.ts) — this page is opened many times a day
  // and re-reading every customer and vehicle on each mount was one of the
  // largest sources of billed reads in the app.
  useEffect(() => {
    const centerId = currentUser?.centerId;
    if (!centerId) return;
    let active = true;
    // Both fetches are bounded now (lib/refData.ts), so they REJECT on a dead
    // connection where they used to hang forever. Swallowed here: the cache
    // never stores a failure (lib/refCache.ts), so the next mount retries, and
    // an empty picker is the same thing the hang left on screen anyway — only
    // now it settles instead of spinning.
    fetchCustomers(centerId)
      .then((list) => { if (active) setAllCustomers(list); })
      .catch(() => {})
      // Loaded either way: a fetch that FAILED has also stopped being "in
      // flight", and leaving the dropdown on "Loading…" forever would be the
      // very hang this is meant to make visible.
      .finally(() => { if (active) setCustomersLoaded(true); });
    fetchVehicles(centerId)
      .then((list) => {
        if (active) {
          setAllVehicles(list.map((v) => ({ customerId: v.customerId, plateNumber: v.plateNumber })));
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [currentUser?.centerId]);

  // Load service catalog (live)
  //
  // Deliberately left as a listener rather than moved to the reference cache:
  // with persistent local caching on (see config/firebase.ts) a re-attached
  // listener resumes from its stored token and the server sends back only what
  // CHANGED, so a remount costs ~0 reads — cheaper than a one-shot re-fetch
  // once a TTL lapses, and live besides.
  useEffect(() => {
    const centerId = currentUser?.centerId;
    if (!centerId) return;
    return watchQuery(
      query(collection(db, "servicecenters", centerId, "servicePrices"), orderBy("name")),
      (snap) => {
        setCatalog(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ServicePriceItem)));
        setCatalogLoadedFor(centerId);
      }, // A listener that errors has also stopped loading — show the real empty
      // state rather than a "Loading…" that never resolves.
      () => { setCatalogLoadedFor(centerId); });
  }, [currentUser?.centerId]);

  // True only once the listener has delivered a snapshot for the CURRENT
  // center; a center switch makes this false again with no extra render.
  const catalogLoaded = catalogLoadedFor === currentUser?.centerId;

  // The type of the vehicle this job is for — the picked vehicle's, or the
  // one chosen by hand for a walk-in. It is what per-vehicle-type catalog
  // prices resolve against, so a walk-in lorry is billed lorry prices.
  const jobVehicleType = isWalkIn
    ? (walkInVehicleType.trim() || undefined)
    : selectedVehicle?.vehicleType;

  // The catalog grouped by service name, once per catalog load. Everything
  // below resolves a price per service NAME, and the service grid does it for
  // every name at once — against the raw catalog that is a full scan per name,
  // so O(catalog²) to paint the grid. It was also unmemoised, so React redid
  // all of it on every render, and a render happens on every keystroke anywhere
  // on this page: the customer search, the part search, the notes field. Each
  // character typed paid the full quadratic bill, which on a counter tablet is
  // the job card appearing to freeze. Same bug, and the same fix, as the
  // customer dropdown in hooks/useCustomerSearch.ts.
  const catalogIndex = useMemo(() => buildCatalogIndex(catalog), [catalog]);

  // Resolve the catalog entry that applies to a service for the selected
  // vehicle. Prices can be set per vehicle type, so this prefers an exact
  // vehicle-type match, then falls back to a general (no vehicleType) entry.
  const resolveCatalogItem = useCallback(
    (name: string): ServicePriceItem | undefined =>
      resolveFromIndex(catalogIndex, name, jobVehicleType),
    [catalogIndex, jobVehicleType],
  );

  // The services on offer for THIS vehicle: those priced for its type, plus
  // the general (all-types) ones. A bike shouldn't be offered a wheel
  // alignment the workshop only prices for cars. With no vehicle picked yet —
  // or one with no type recorded — there is nothing to narrow by, so the whole
  // catalog shows.
  const catalogNames = useMemo(
    () => serviceNamesFromIndex(catalogIndex, jobVehicleType),
    [catalogIndex, jobVehicleType],
  );

  // Only subscribed when the bay workflow is on.
  const { activeBays } = useServiceBays(currentUser?.centerId, bayWorkflowEnabled);
  // Whether Step 3 shows any per-service assignment at all.
  const assignPerService = commissionEnabled || bayWorkflowEnabled;
  // Who can be named as having performed a service. Supervisors are excluded
  // deliberately: an override is never assigned by hand, it is derived at
  // completion from the technician's `reportsTo`.
  const commissionTechnicians = technicians.filter(
    (t) => t.commission?.role !== "supervisor",
  );

  // Load vehicles for selected customer — filtered out of the cached full
  // vehicle list above, so picking a customer costs no extra read.
  useEffect(() => {
    const centerId = currentUser?.centerId;
    if (!selectedCustomer || !centerId) return;
    let active = true;
    fetchVehiclesForCustomer(centerId, selectedCustomer.id).then((list) => {
      if (active) setVehicles(list);
    });
    return () => { active = false; };
  }, [selectedCustomer, currentUser?.centerId]);

  // Load technicians — filtered out of the cached staff list.
  useEffect(() => {
    const centerId = currentUser?.centerId;
    if (!centerId) return;
    let active = true;
    fetchTechnicians(centerId).then((list) => {
      if (active) setTechnicians(list);
    });
    return () => { active = false; };
  }, [currentUser?.centerId]);

  // Indexed, deferred and capped — see hooks/useCustomerSearch.ts.
  const {
    matches: customerMatches,
    totalMatches: customerTotalMatches,
    truncated: customerSearchTruncated,
  } = useCustomerSearch(allCustomers, allVehicles, customerSearch);

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

  // useCallback with no deps: the functional update below already reads the
  // current selection, so this closes over nothing and stays identical for
  // the life of the page — which is what lets ServiceGrid's memo hold.
  const toggleService = useCallback((s: string) => {
    setSelectedServices((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }, []);

  const setAssignment = (name: string, field: "technicianId" | "bayId", value: string) => {
    setLineAssignments((prev) => ({
      ...prev,
      [name]: { ...(prev[name] ?? { technicianId: "", bayId: "" }), [field]: value },
    }));
  };

  const addCustomService = () => {
    const v = customServiceInput.trim();
    if (v && !customServices.includes(v)) {
      setCustomServices((prev) => [...prev, v]);
    }
    setCustomServiceInput("");
  };

  // The vehicle the job is for, whichever mode built it. A walk-in's has no
  // id — there is no record behind the plate — which is what every
  // record-dependent step keys off.
  const jobVehicle: Vehicle | null = isWalkIn
    ? (walkInPlate.trim()
        ? ({
            id: "",
            plateNumber: walkInPlate.trim().toUpperCase(),
            make: walkInMake.trim(),
            model: walkInModel.trim(),
            vehicleType: walkInVehicleType.trim(),
          } as Vehicle)
        : null)
    : selectedVehicle;

  // ── Open-job pre-check ──────────────────────────────────────────────────────
  // "Does this vehicle already have an open job card?" used to be asked inside
  // handleSubmit: a live, server-first read standing between the Create button
  // and the job, run only AFTER the technician had filled in the entire form.
  // Bounded (see lib/firestoreRead.ts) but still a full round trip over the
  // forced long-polling transport (config/firebase.ts), which on workshop Wi-Fi
  // is a visible wait on the one press that should feel instant.
  //
  // It is asked here instead, the moment a vehicle is picked, so it runs in the
  // background while the form is still being filled in and the warning (if
  // there is one) shows straight away. handleSubmit awaits this same in-flight
  // promise rather than issuing a second query.
  const openJobCheckRef = useRef<Promise<string | null> | null>(null);

  const startOpenJobCheck = useCallback((centerId: string, vehicleId: string) => {
    const check = boundedGetDocs(
      query(
        collection(db, "servicecenters", centerId, "jobs"),
        where("vehicleId", "==", vehicleId),
        where("status", "in", ["pending", "in_progress"]),
      ),
      // A deleted job can still carry an open status — it's hidden, not
      // resolved, so it shouldn't block (or be offered as) the open job here.
    ).then((snap) => snap.docs.find((d) => !d.data().isDeleted)?.id ?? null);
    // A FAILED check is never cached. Reaching here means both the network and
    // the offline cache gave nothing, and that must still BLOCK job creation
    // with a real error rather than be read as "no open job" — so the failure
    // is dropped and handleSubmit re-runs the check live, where its rejection
    // becomes the message the technician sees.
    check.catch(() => {
      if (openJobCheckRef.current === check) openJobCheckRef.current = null;
    });
    openJobCheckRef.current = check;
    return check;
  }, []);

  const centerId = currentUser?.centerId;
  const selectedVehicleId = selectedVehicle?.id;
  useEffect(() => {
    openJobCheckRef.current = null;
    // A walk-in has no vehicle record to have an open job against, so there is
    // nothing to check.
    if (isWalkIn || !centerId || !selectedVehicleId) return;
    let active = true;
    startOpenJobCheck(centerId, selectedVehicleId)
      .then((jobId) => {
        if (active && jobId) setOpenJobFound({ vehicleId: selectedVehicleId, jobId });
      })
      // Swallowed on purpose: a background check that fails must not interrupt
      // a form still being filled in. handleSubmit re-runs it and reports it.
      .catch(() => {});
    return () => { active = false; };
  }, [isWalkIn, centerId, selectedVehicleId, startOpenJobCheck]);

  /** The open job on the vehicle currently picked, if the check has found one. */
  const openJobOnVehicle =
    openJobFound && openJobFound.vehicleId === selectedVehicleId ? openJobFound.jobId : null;

  const handleSubmit = async () => {
    if (!currentUser?.centerId || !jobVehicle) return;
    if (!isWalkIn && !selectedCustomer) return;
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
    if (signatureEnabled && signatureRequired && !signature) {
      setJobError("Take the customer's signature, or switch back to “No signature needed”");
      setSignatureOpen(true);
      return;
    }
    setJobError("");
    setSaving(true);

    try {
      // The open-job check already ran in the background the moment the vehicle
      // was picked, so this normally resolves instantly instead of putting a
      // round trip in front of the Create button. Only a check that FAILED —
      // no network and no cache — is re-run here, where its rejection reaches
      // the catch below and blocks job creation with a real error instead of
      // silently letting a duplicate job through.
      if (!isWalkIn) {
        const existingJobId = await (
          openJobCheckRef.current ??
          startOpenJobCheck(currentUser.centerId, selectedVehicle!.id)
        );
        if (existingJobId) {
          setOpenJobWarning({ jobId: existingJobId });
          setSaving(false);
          return;
        }
      }

      const jobId = await createJob();
      if (!jobId) return;
      setSaving(false);
      // Inspection (if this center runs them) happens after the job is
      // started, from the job card — not here at creation.
      navigate(`/services/${jobId}`);
    } catch (err) {
      setJobError(
        err instanceof ReadTimeoutError
          ? "The connection stalled while checking this vehicle. Check your signal and try again."
          : "Failed to create job. Please try again.",
      );
      setSaving(false);
    }
  };

  // One service line carrying whatever was assigned to it. A blank assignment
  // is left null rather than an empty string, so the Cloud Function's
  // `if (!line.technicianId) continue` reads the same either way.
  const buildLine = (name: string, custom: boolean) => {
    const assignment = lineAssignments[name];
    const item = custom ? undefined : resolveCatalogItem(name);
    return {
      ...blankServiceLine(name, item ? catalogPrice(item) : 0, custom, bayWorkflowEnabled),
      technicianId: assignment?.technicianId || null,
      bayId: (bayWorkflowEnabled && assignment?.bayId) || null,
    };
  };

  const createJob = async (): Promise<string | undefined> => {
    if (!currentUser?.centerId || !jobVehicle) return;
    if (!isWalkIn && !selectedCustomer) return;
    const parsedMi = parseInt(mileageIn, 10);
    // A quick job that isn't tracking mileage may leave the field blank —
    // fall back to the vehicle's last known reading rather than writing 0.
    // A vehicle registered without an odometer reading (and every walk-in,
    // which has no record at all) has nothing to fall back to, so the job
    // records zero until a reading is taken.
    const mi = !isNaN(parsedMi) ? parsedMi : (jobVehicle.currentMileageKm ?? 0);
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
      // A walk-in registers nothing: no customer id, and whatever name was
      // given (or none) is what the job and its bill are headed with.
      walkIn: isWalkIn,
      customerId: isWalkIn ? "" : selectedCustomer!.id,
      customerName: isWalkIn
        ? (walkInName.trim() || "Walk-in Customer")
        : selectedCustomer!.name,
      customerPhone: isWalkIn ? walkInPhone.trim() : selectedCustomer!.phone,
      vehicle: jobVehicle,
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
      // Only sent when a module is on; otherwise the job is written without
      // any `serviceLines` field, exactly as before.
      ...(assignPerService
        ? {
            bayWorkflowEnabled,
            serviceLines: [
              ...selectedServices.map((name) => buildLine(name, false)),
              ...customServices.map((name) => buildLine(name, true)),
            ],
          }
        : {}),
      // The waiver's flag is part of the job's create data now rather than a
      // second write to a document seconds old.
      signatureCaptured: signature !== null,
      // The waiver document itself rides in the job's own batch: its create
      // rule is the job's create rule exactly (Owner/Manager/Receptionist/
      // Technician), so sharing a batch narrows nothing. It is also what
      // makes the flag above safe — batch writes land together or not at all,
      // so a job can no longer claim a signature whose image didn't save.
      ...(signature
        ? {
            extraWrites: (batch: WriteBatch, jobRef: DocumentReference) => {
              batch.set(doc(jobRef, "signature", "main"), signatureFields(signature, {
                id: currentUser.uid,
                name: currentUser.displayName ?? currentUser.email ?? "",
              }));
            },
          }
        : {}),
      // Vehicle mileage — skipped for a job that isn't tracking it, so a quick
      // wash/top-up doesn't overwrite the vehicle's real odometer reading with
      // the fallback value used above. Passed as `alongside` rather than
      // batched with the job: `vehicles` update allows Owner/Manager/
      // Receptionist, so a Technician sharing a batch with it would be denied
      // the job as well.
      ...(recordMileage && !isWalkIn
        ? {
            alongside: () => [
              safeUpdateDoc(
                doc(db, "servicecenters", currentUser.centerId!, "vehicles", selectedVehicle!.id),
                { currentMileageKm: mi, updatedAt: serverTimestamp() },
              ),
            ],
          }
        : {}),
    });

    return jobId;
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
            <StepCircle n={1} label="Customer" step={step} />
            <div className={`flex-1 h-0.5 mx-2 ${step > 1 ? "bg-green-500" : "bg-white/10"}`} />
            <StepCircle n={2} label="Vehicle" step={step} />
            <div className={`flex-1 h-0.5 mx-2 ${step > 2 ? "bg-green-500" : "bg-white/10"}`} />
            <StepCircle n={3} label="Job Details" step={step} />
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">

        {/* Step 1: Customer */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold">Customer</h2>

            {/* Who the job is for — the same choice a bill offers. */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { setJobMode("customer"); setJobError(""); }}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  !isWalkIn ? "border-orange-500 bg-orange-500/10" : "border-white/10 bg-[#162032] hover:border-white/30"
                }`}
              >
                <Users className={`w-4 h-4 flex-shrink-0 ${!isWalkIn ? "text-orange-400" : "text-gray-500"}`} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-white">Registered Customer</span>
                  <span className="block text-[11px] text-gray-500">Full history &amp; SMS</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => { setJobMode("walkin"); setJobError(""); }}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  isWalkIn ? "border-orange-500 bg-orange-500/10" : "border-white/10 bg-[#162032] hover:border-white/30"
                }`}
              >
                <UserPlus className={`w-4 h-4 flex-shrink-0 ${isWalkIn ? "text-orange-400" : "text-gray-500"}`} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-white">Walk-in</span>
                  <span className="block text-[11px] text-gray-500">Vehicle number only</span>
                </span>
              </button>
            </div>

            {/* Walk-in: nothing is registered — the name is only for the
                job card and the bill it produces. */}
            {isWalkIn && (
              <div className="bg-[#162032] border border-white/10 rounded-xl p-4 space-y-3">
                <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Walk-in Details</div>
                <input
                  type="text"
                  value={walkInName}
                  onChange={(e) => setWalkInName(e.target.value)}
                  placeholder="Customer name (optional — shown on the job card &amp; bill)"
                  className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
                />
                <input
                  type="tel"
                  value={walkInPhone}
                  onChange={(e) => setWalkInPhone(e.target.value)}
                  placeholder="Phone (optional)"
                  className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
                />
                <p className="text-xs text-gray-500">
                  No customer or vehicle record is created, so there is no service history and no
                  reminder SMS. Use a registered customer for anyone who will come back.
                </p>
              </div>
            )}

            {!isWalkIn && (
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
                    {customerMatches.map(({ customer: c, matchedPlate }) => (
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
                    ))}
                    {allCustomers.length === 0 && (
                      <div className="px-3 py-2 text-sm text-gray-500">
                        {customersLoaded ? "No customers yet" : "Loading customers…"}
                      </div>
                    )}
                    {allCustomers.length > 0 && customerMatches.length === 0 && (
                      <div className="px-3 py-2 text-sm text-gray-500">No customers match “{customerSearch}”</div>
                    )}
                    {/* Only the first page of matches is rendered — building a
                        row for every customer in the center is what used to
                        freeze this dropdown on a tablet. */}
                    {customerSearchTruncated && (
                      <div className="px-3 py-2 text-xs text-gray-500 border-t border-white/5">
                        Showing {customerMatches.length} of {customerTotalMatches} — keep typing to narrow it down
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            )}

            <button
              onClick={() => setStep(2)}
              disabled={!isWalkIn && !selectedCustomer}
              className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Step 2: Vehicle */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold">
              {isWalkIn ? "Vehicle" : "Select Vehicle"}
            </h2>
            <p className="text-sm text-gray-400">
              Customer: <span className="text-white">
                {isWalkIn ? (walkInName.trim() || "Walk-in Customer") : selectedCustomer?.name}
              </span>
            </p>

            {/* A walk-in's vehicle isn't on file, so its details are typed
                here and live on the job alone. */}
            {isWalkIn && (
              <div className="bg-[#162032] border border-white/10 rounded-xl p-4 space-y-3">
                <div className="relative">
                  <Car className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                  <input
                    type="text"
                    value={walkInPlate}
                    onChange={(e) => setWalkInPlate(e.target.value.toUpperCase())}
                    placeholder="Vehicle number — e.g. CAB-1234"
                    className="w-full pl-9 pr-3 py-2.5 bg-white/5 border border-white/10 text-white rounded-lg text-sm font-mono uppercase placeholder-gray-500 focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={walkInMake}
                    onChange={(e) => setWalkInMake(e.target.value)}
                    placeholder="Make (optional)"
                    className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
                  />
                  <input
                    type="text"
                    value={walkInModel}
                    onChange={(e) => setWalkInModel(e.target.value)}
                    placeholder="Model (optional)"
                    className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2.5 text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
                  />
                </div>
                {/* The type is what per-vehicle-type catalog prices resolve
                    against, so it is worth asking even for a walk-in. */}
                <div className="flex flex-wrap gap-2">
                  {vehicleTypeOptions.map((vt) => (
                    <button
                      key={vt}
                      type="button"
                      onClick={() => setWalkInVehicleType(walkInVehicleType === vt ? "" : vt)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize ${
                        walkInVehicleType === vt
                          ? "bg-orange-500 border-orange-500 text-white"
                          : "bg-white/5 border-white/10 text-gray-300 hover:border-white/30"
                      }`}
                    >
                      {vt}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500">
                  The vehicle type decides which catalog price each service is billed at.
                </p>
              </div>
            )}

            {!isWalkIn && (
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
            )}

            {/* Answered by the background check above, so it is on screen while
                the rest of the form is still being filled in — not sprung on
                the technician at the Create button. Informational: creating a
                second job is allowed, the modal at submit just confirms it. */}
            {!isWalkIn && openJobOnVehicle && (
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-amber-200/90 min-w-0">
                  This vehicle already has an open job card.{" "}
                  <button
                    type="button"
                    onClick={() => navigate(`/services/${openJobOnVehicle}`)}
                    className="underline underline-offset-2 font-medium hover:text-white"
                  >
                    View it
                  </button>
                  , or carry on to create another.
                </div>
              </div>
            )}

            {!isWalkIn && vehicles.length === 0 && (
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
                disabled={!jobVehicle}
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
              Vehicle: <span className="text-white font-medium">{jobVehicle?.plateNumber}</span> &nbsp;·&nbsp;
              {jobVehicle?.make} {jobVehicle?.model}
              {isWalkIn && <span className="ml-2 text-[11px] text-orange-400">Walk-in</span>}
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

            {/* Customer signature — the valuables waiver. Some customers want
                one taken before the workshop touches the car, most don't, so
                it's a choice of two cards rather than a step everybody walks
                through — and the whole thing is hidden at a center that has
                the module switched off. */}
            {signatureEnabled && (
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold block mb-2">
                Customer Signature <span className="text-gray-600 font-normal normal-case">(optional)</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => { setSignatureRequired(false); setJobError(""); }}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    !signatureRequired
                      ? "border-orange-500 bg-orange-500/10"
                      : "border-white/10 bg-white/5 hover:border-white/30"
                  }`}
                >
                  <ShieldOff className={`w-4 h-4 flex-shrink-0 ${!signatureRequired ? "text-orange-400" : "text-gray-500"}`} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-white">No signature needed</span>
                    <span className="block text-[11px] text-gray-500">Start the job as usual</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSignatureRequired(true);
                    setJobError("");
                    if (!signature) setSignatureOpen(true);
                  }}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    signatureRequired
                      ? "border-orange-500 bg-orange-500/10"
                      : "border-white/10 bg-white/5 hover:border-white/30"
                  }`}
                >
                  <PenLine className={`w-4 h-4 flex-shrink-0 ${signatureRequired ? "text-orange-400" : "text-gray-500"}`} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-white">Take signature</span>
                    <span className="block text-[11px] text-gray-500">Valuables waiver, 3 languages</span>
                  </span>
                </button>
              </div>
              {signatureRequired && (
                <div className="mt-2 bg-[#162032] border border-white/10 rounded-xl p-3">
                  {signature ? (
                    <div className="flex items-center gap-3">
                      <img
                        src={signature.dataUrl}
                        alt="Customer signature"
                        className="h-12 w-28 object-contain bg-white rounded-md flex-shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-white truncate">Signed by {signature.signedByName}</p>
                        <p className="text-[11px] text-gray-500">
                          {signature.hasValuables
                            ? `Valuables declared: ${signature.valuables}`
                            : "Nothing of value left in the vehicle"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSignatureOpen(true)}
                        className="text-xs text-orange-400 hover:text-orange-300 flex-shrink-0"
                      >
                        Redo
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSignatureOpen(true)}
                      className="flex items-center gap-2 text-sm text-orange-400 hover:text-orange-300"
                    >
                      <PenLine className="w-4 h-4" />
                      Open the waiver &amp; sign
                    </button>
                  )}
                </div>
              )}
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
                  {vehicleTypeLabel(jobVehicleType)}
                </span>
              </div>
              {catalogNames.length === 0 ? (
                <div className="border border-dashed border-white/10 rounded-lg px-4 py-6 text-center">
                  {catalogLoaded ? (
                    <>
                      <p className="text-sm text-gray-400">
                        No services priced for{" "}
                        <span className="text-gray-200">{vehicleTypeLabel(jobVehicleType)}</span> yet.
                      </p>
                      <button
                        type="button"
                        onClick={() => navigate("/services/catalog")}
                        className="mt-2 text-xs text-orange-400 hover:text-orange-300 font-medium"
                      >
                        Set up services &amp; prices →
                      </button>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400">Loading services…</p>
                  )}
                </div>
              ) : (
                <ServiceGrid
                  names={catalogNames}
                  selected={selectedServices}
                  resolve={resolveCatalogItem}
                  onToggle={toggleService}
                />
              )}
              {selectedServices.length > 0 && catalog.length > 0 && (
                <p className="mt-2 text-xs text-gray-400">
                  Catalog subtotal:{" "}
                  <span className="text-white font-medium">
                    LKR {lkr.format(selectedServices.reduce((sum, name) => {
                      const c = resolveCatalogItem(name);
                      return sum + (c ? catalogPrice(c) : 0);
                    }, 0))}
                  </span>
                  {" "}— an invoice will be auto-generated with these line items.
                </p>
              )}
            </div>

            {/* Per-service assignment — only for centers running the commission
                and/or bay module. Both dropdowns are optional: a job saves
                with every one of them left blank. The supervisor is never
                picked here; it is derived at completion from whoever the
                assigned technician reports to. */}
            {assignPerService && (selectedServices.length > 0 || customServices.length > 0) && (
              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold block mb-2">
                  Per-Service Assignment{" "}
                  <span className="text-gray-600 font-normal normal-case">(optional)</span>
                </label>
                <div className="space-y-2">
                  {[...selectedServices, ...customServices].map((name) => (
                    <div
                      key={name}
                      className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 space-y-2"
                    >
                      <div className="text-sm text-white truncate">{name}</div>
                      <div className={`grid gap-2 ${commissionEnabled && bayWorkflowEnabled ? "sm:grid-cols-2" : "grid-cols-1"}`}>
                        {commissionEnabled && (
                          <select
                            value={lineAssignments[name]?.technicianId ?? ""}
                            onChange={(e) => setAssignment(name, "technicianId", e.target.value)}
                            className="w-full bg-[#0B1120] border border-white/10 text-white rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-orange-500"
                          >
                            {/* Options carry the background too — Windows and
                                Android paint the list separately from the box. */}
                            <option value="" className="bg-[#1e2d42] text-white">Technician —</option>
                            {commissionTechnicians.map((tech) => (
                              <option key={tech.id} value={tech.id} className="bg-[#1e2d42] text-white">
                                {staffDisplayName(tech)}
                              </option>
                            ))}
                          </select>
                        )}
                        {bayWorkflowEnabled && (
                          <select
                            value={lineAssignments[name]?.bayId ?? ""}
                            onChange={(e) => setAssignment(name, "bayId", e.target.value)}
                            className="w-full bg-[#0B1120] border border-white/10 text-white rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-orange-500"
                          >
                            <option value="" className="bg-[#1e2d42] text-white">Bay —</option>
                            {activeBays.map((bay) => (
                              <option key={bay.id} value={bay.id} className="bg-[#1e2d42] text-white">
                                {bay.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {bayWorkflowEnabled && activeBays.length === 0 && (
                  <p className="mt-2 text-xs text-gray-500">
                    No bays set up yet — add them under Settings → Services &amp; Modules.
                  </p>
                )}
              </div>
            )}

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

      {/* The waiver itself — full screen, so it can be handed to the customer
          to read and sign on. */}
      <CustomerSignatureModal
        open={signatureOpen}
        onClose={() => setSignatureOpen(false)}
        onConfirm={(captured) => { setSignature(captured); setSignatureOpen(false); }}
        plateNumber={jobVehicle?.plateNumber}
        customerName={selectedCustomer?.name}
      />
    </div>
  );
}
