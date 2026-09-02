import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import {
  doc, onSnapshot, serverTimestamp, collection,
  query, where, getDocs, getDoc, Timestamp,
  orderBy, limit,
} from "firebase/firestore";
import { safeUpdateDoc, safeAddDoc, safeSetDoc } from "../../lib/firestoreWrite";
import {
  ArrowLeft, Phone, ExternalLink, Plus, X, Printer,
  AlertTriangle, CheckCircle, ChevronRight, Users, ClipboardList,
} from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import type { ServiceJob, InventoryItem, PartUsed, ServiceCenter, SmsLog, ServicePriceItem, StaffMember, VehicleInspection } from "../../types/auth";
import { resolveServicePrice } from "../../lib/servicePricing";
import { jobCrew, jobTechnicianNames, staffDisplayName, technicianFields } from "../../lib/jobTechnicians";
import { serviceCenterPriceOf, purchasePriceOf } from "../../lib/inventoryPricing";
import { logMovement } from "../../lib/inventoryMovements";
import InspectionViewer from "../../components/inspection/InspectionViewer";
import VehicleInspectionForm from "../../components/inspection/VehicleInspectionForm";
import VehicleActivityLog from "../../components/vehicles/VehicleActivityLog";
import { DEFAULT_COMPLETION_TEMPLATE } from "../../lib/smsTemplates";
import { LoadingScreen } from "../../components/LoadingProgress";
import { usePrintDocument } from "../../hooks/usePrintDocument";

/** What the customer pays per unit for a part taken out of stock. */
function partUnitPrice(item: InventoryItem): number {
  return serviceCenterPriceOf(item);
}

/**
 * The price already recorded on a job line. Lines saved before service-center
 * pricing existed only carry `unitCost`, so they keep billing at whatever they
 * were saved with rather than silently re-pricing an invoiced job.
 */
function partLinePrice(part: PartUsed): number {
  return part.unitPrice ?? part.unitCost ?? 0;
}

const isPro = (plan?: string) => plan === "pro";

function formatTs(ts: Timestamp | undefined): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const STATUS_ORDER: ServiceJob["status"][] = ["pending", "in_progress", "done", "delivered"];
const STATUS_LABELS: Record<ServiceJob["status"], string> = {
  pending: "Pending",
  in_progress: "In Progress",
  done: "Done",
  delivered: "Delivered",
};

export default function ServiceDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const canMarkInProgress = usePermission("jobs.markInProgress");
  const canMarkDone       = usePermission("jobs.markDone");
  const canMarkDelivered  = usePermission("jobs.markDelivered");
  const canEditJob        = usePermission("jobs.edit");
  const canRecordServices = usePermission("jobs.recordServices");
  const canAddParts       = usePermission("jobs.addParts");
  const canViewInspection = usePermission("inspection.view");
  const canConductInspection = usePermission("inspection.conduct");
  const canViewCustomer   = usePermission("customers.view");
  const canViewInvoice    = usePermission("invoices.viewDetail");
  const canMarkPayment    = usePermission("invoices.markPayment") && canViewInvoice;
  const canAssignTech     = usePermission("jobs.assignTechnician");
  const canRecordActivity = usePermission("jobs.addNotes");

  const [job, setJob] = useState<ServiceJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [centerName, setCenterName] = useState("");
  const [centerAddress, setCenterAddress] = useState("");
  const [centerPlan, setCenterPlan] = useState<"basic" | "pro">("basic");
  const [inspectionEnabled, setInspectionEnabled] = useState(false);
  const [completionTemplate, setCompletionTemplate] = useState(DEFAULT_COMPLETION_TEMPLATE);

  // Vehicle inspection — conducted by the technician after the job is
  // started, not at job creation. `inspection` mirrors whether a record
  // already exists on this job: undefined while loading, null once we know
  // there isn't one yet, an object once it exists (or was skipped).
  const [inspection, setInspection] = useState<VehicleInspection | null | undefined>(undefined);
  const [showInspectionForm, setShowInspectionForm] = useState(false);
  const [editingInspector, setEditingInspector] = useState(false);
  const [savingInspector, setSavingInspector] = useState(false);

  // Service editing
  const [addingService, setAddingService] = useState(false);
  const [newService, setNewService] = useState("");
  const [servicesDirty, setServicesDirty] = useState(false);
  const [localServices, setLocalServices] = useState<string[]>([]);
  const [localCustomServices, setLocalCustomServices] = useState<string[]>([]);

  // Mileage & oil
  const [mileageOut, setMileageOut] = useState("");
  const [nextServiceMileage, setNextServiceMileage] = useState("");
  const [oilBrand, setOilBrand] = useState("");
  const [oilGrade, setOilGrade] = useState("");
  const [oilViscosityNotes, setOilViscosityNotes] = useState("");
  const [mileageDirty, setMileageDirty] = useState(false);

  // Parts (Pro)
  const [partSearch, setPartSearch] = useState("");
  const [partResults, setPartResults] = useState<InventoryItem[]>([]);
  const [selectedPart, setSelectedPart] = useState<InventoryItem | null>(null);
  const [partQty, setPartQty] = useState("1");

  // Modals / alerts
  const [revertModal, setRevertModal] = useState(false);
  const [stockWarning, setStockWarning] = useState<{ item: InventoryItem; needed: number } | null>(null);

  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);

  // Crew
  const [technicianOptions, setTechnicianOptions] = useState<StaffMember[]>([]);
  const [editingCrew, setEditingCrew] = useState(false);
  const [savingCrew, setSavingCrew] = useState(false);

  const printRef = useRef<HTMLDivElement>(null);

  // Load job
  useEffect(() => {
    if (!jobId || !currentUser?.centerId) return;
    return onSnapshot(
      doc(db, "servicecenters", currentUser.centerId, "jobs", jobId),
      (snap) => {
        if (!snap.exists()) { navigate("/services"); return; }
        const j = { id: snap.id, ...snap.data() } as ServiceJob;
        setJob(j);
        setLocalServices(j.services ?? []);
        setLocalCustomServices(j.customServices ?? []);
        if (j.mileageOut) {
          setMileageOut(String(j.mileageOut));
        } else {
          // Pre-fill from mileageIn so the user doesn't have to enter it twice.
          setMileageOut(String(j.mileageIn));
        }
        if (j.nextServiceMileageKm) {
          setNextServiceMileage(String(j.nextServiceMileageKm));
        } else {
          setNextServiceMileage(String(j.mileageIn + 5000));
        }
        setOilBrand(j.oilBrand ?? "");
        setOilGrade(j.oilGrade ?? "");
        setOilViscosityNotes(j.oilViscosityNotes ?? "");
        setLoading(false);
      },
    );
  }, [jobId, currentUser?.centerId, navigate]);

  // Load linked invoice (if job is done or delivered)
  useEffect(() => {
    if (!jobId || !currentUser?.centerId || !job) return;
    if (job.status !== "done" && job.status !== "delivered") return;
    getDocs(
      query(collection(db, "servicecenters", currentUser.centerId, "invoices"), where("serviceId", "==", jobId)),
    ).then((snap) => {
      if (!snap.empty) setInvoiceId(snap.docs[0].id);
    });
  }, [jobId, currentUser?.centerId, job?.status]);

  // Live SMS log entries for this job
  const [smsLogs, setSmsLogs] = useState<SmsLog[]>([]);
  useEffect(() => {
    if (!jobId || !currentUser?.centerId) return;
    return onSnapshot(
      query(
        collection(db, "servicecenters", currentUser.centerId, "smsLogs"),
        where("jobId", "==", jobId),
      ),
      (snap) => {
        setSmsLogs(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as SmsLog))
            .sort((a, b) => (b.sentAt?.toMillis?.() ?? 0) - (a.sentAt?.toMillis?.() ?? 0)),
        );
      },
    );
  }, [jobId, currentUser?.centerId]);

  // Active technicians, for assigning the crew. Only fetched for roles that
  // can actually change it.
  useEffect(() => {
    if (!currentUser?.centerId || !canAssignTech) return;
    getDocs(
      query(
        collection(db, "servicecenters", currentUser.centerId, "staff"),
        where("role", "==", "Technician"),
        where("active", "==", true),
      ),
    ).then((snap) => {
      setTechnicianOptions(snap.docs.map((d) => ({ id: d.id, ...d.data() } as StaffMember)));
    }).catch(() => { /* non-fatal — the crew simply can't be edited */ });
  }, [currentUser?.centerId, canAssignTech]);

  // Load center info for print
  useEffect(() => {
    if (!currentUser?.centerId) return;
    getDoc(doc(db, "servicecenters", currentUser.centerId)).then((snap) => {
      if (snap.exists()) {
        const d = snap.data() as ServiceCenter;
        setCenterName(d.name ?? "");
        setCenterAddress(d.address ?? "");
        setCenterPlan(d.plan ?? "basic");
        setInspectionEnabled(d.inspectionEnabled === true);
        if (d.completionSmsTemplate) setCompletionTemplate(d.completionSmsTemplate);
      }
    });
  }, [currentUser?.centerId]);

  // Whether this job already has an inspection record (or was skipped) —
  // drives whether the "start inspection" prompt still shows.
  useEffect(() => {
    if (!jobId || !currentUser?.centerId) return;
    return onSnapshot(
      doc(db, "servicecenters", currentUser.centerId, "jobs", jobId, "inspection", "main"),
      (snap) => setInspection(snap.exists() ? (snap.data() as VehicleInspection) : null),
    );
  }, [jobId, currentUser?.centerId]);

  // Auto-calc next service mileage when mileage out changes
  const handleMileageOutChange = (val: string) => {
    setMileageOut(val);
    setMileageDirty(true);
    const mo = parseInt(val, 10);
    if (!isNaN(mo)) {
      setNextServiceMileage(String(mo + 5000));
    }
  };

  // Part search
  useEffect(() => {
    if (!partSearch.trim() || !currentUser?.centerId) { setPartResults([]); return; }
    const timer = setTimeout(async () => {
      const snap = await getDocs(
        query(collection(db, "servicecenters", currentUser.centerId!, "inventory"),
          where("name", ">=", partSearch),
          where("name", "<=", partSearch + ""),
        ),
      );
      setPartResults(snap.docs.map((d) => ({ id: d.id, ...d.data() } as InventoryItem)));
    }, 300);
    return () => clearTimeout(timer);
  }, [partSearch, currentUser?.centerId]);

  const addPart = () => {
    if (!selectedPart || !job) return;
    const qty = parseInt(partQty, 10);
    if (isNaN(qty) || qty <= 0) return;
    const existing = job.partsUsed.find((p) => p.itemId === selectedPart.id);
    const newParts: PartUsed[] = existing
      ? job.partsUsed.map((p) => p.itemId === selectedPart.id ? { ...p, quantity: p.quantity + qty } : p)
      : [...job.partsUsed, {
          itemId: selectedPart.id,
          itemName: selectedPart.name,
          quantity: qty,
          // A part used on a job is billed to the customer at the item's
          // service-center price — never at what the workshop paid for it.
          unitPrice: partUnitPrice(selectedPart),
          // Mirrored so an older build reading this job still shows a figure.
          unitCost: partUnitPrice(selectedPart),
          // What the workshop paid, snapshotted now so margin reporting stays
          // accurate even if the item's purchase price changes later.
          costPrice: purchasePriceOf(selectedPart),
        }];
    safeUpdateDoc(doc(db, "servicecenters", currentUser!.centerId!, "jobs", job.id), { partsUsed: newParts, updatedAt: serverTimestamp() });
    setSelectedPart(null);
    setPartSearch("");
    setPartQty("1");
    setPartResults([]);
  };

  const removePart = (itemId: string) => {
    if (!job) return;
    safeUpdateDoc(doc(db, "servicecenters", currentUser!.centerId!, "jobs", job.id), {
      partsUsed: job.partsUsed.filter((p) => p.itemId !== itemId),
      updatedAt: serverTimestamp(),
    });
  };

  // Add or drop a technician. Dropping the lead promotes whoever is next, so
  // technicianId/technicianName always name someone actually on the job.
  const toggleCrewMember = async (staff: StaffMember) => {
    if (!job) return;
    const current = jobCrew(job);
    const next = current.some((c) => c.id === staff.id)
      ? current.filter((c) => c.id !== staff.id)
      : [...current, { id: staff.id, name: staffDisplayName(staff) }];
    setSavingCrew(true);
    setActionError("");
    try {
      // The job's department follows the (possibly new) lead technician, so a
      // crew change that swaps who's leading also re-routes the job.
      const lead = technicianOptions.find((t) => t.id === next[0]?.id);
      await safeUpdateDoc(doc(db, "servicecenters", currentUser!.centerId!, "jobs", job.id), {
        ...technicianFields(next),
        departmentId: lead?.departmentId ?? null,
        departmentName: lead?.departmentName ?? null,
        updatedAt: serverTimestamp(),
      });
    } catch { setActionError("Failed to update the technicians"); }
    setSavingCrew(false);
  };

  const saveServices = async () => {
    if (!job) return;
    await safeUpdateDoc(doc(db, "servicecenters", currentUser!.centerId!, "jobs", job.id), {
      services: localServices,
      customServices: localCustomServices,
      updatedAt: serverTimestamp(),
    });
    setServicesDirty(false);
    setAddingService(false);
  };

  const saveMileage = async () => {
    if (!job) return;
    const mo = parseInt(mileageOut, 10);
    const ns = parseInt(nextServiceMileage, 10);
    await safeUpdateDoc(doc(db, "servicecenters", currentUser!.centerId!, "jobs", job.id), {
      mileageOut: isNaN(mo) ? null : mo,
      nextServiceMileageKm: isNaN(ns) ? null : ns,
      oilBrand, oilGrade, oilViscosityNotes,
      updatedAt: serverTimestamp(),
    });
    setMileageDirty(false);
  };

  // Status actions
  const handleStartJob = async () => {
    if (!job) return;
    setSaving(true);
    setActionError("");
    try {
      await safeUpdateDoc(doc(db, "servicecenters", currentUser!.centerId!, "jobs", job.id), {
        status: "in_progress",
        startedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch { setActionError("Failed to update status"); }
    setSaving(false);
  };

  const handleSkipInspection = async () => {
    if (!job || !currentUser?.centerId) return;
    await safeSetDoc(
      doc(db, "servicecenters", currentUser.centerId, "jobs", job.id, "inspection", "main"),
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
  };

  // An inspector named on the job is optional — the owner or whoever created
  // the job may pick one, otherwise anyone who can conduct an inspection on
  // this job may do it.
  const assignInspector = async (staff: StaffMember | null) => {
    if (!job) return;
    setSavingInspector(true);
    setActionError("");
    try {
      await safeUpdateDoc(doc(db, "servicecenters", currentUser!.centerId!, "jobs", job.id), {
        inspectorId: staff?.id ?? null,
        inspectorName: staff ? staffDisplayName(staff) : null,
        updatedAt: serverTimestamp(),
      });
      setEditingInspector(false);
    } catch { setActionError("Failed to update the inspector"); }
    setSavingInspector(false);
  };

  // Create (or refresh) the draft invoice for this job. A job may already
  // have an invoice — one is auto-created when the job is opened — so this
  // must NOT create a second invoice: it updates the existing draft with the
  // final services/parts instead. Only when no invoice exists yet is a new
  // one created.
  const createDraftInvoice = async (job: ServiceJob) => {
    const centerId = currentUser!.centerId!;

    // Fetch service library to price the services on this job. Prices can be
    // set per vehicle type, so resolve each service against THIS vehicle's
    // type (falling back to the general price) rather than picking an arbitrary
    // type's price. Older jobs may not carry vehicleType — fall back to the
    // vehicle record when needed.
    const priceSnap = await getDocs(collection(db, "servicecenters", centerId, "servicePrices"));
    const catalog = priceSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ServicePriceItem));

    let vehicleType = job.vehicleType;
    if (!vehicleType && job.vehicleId) {
      const vSnap = await getDoc(doc(db, "servicecenters", centerId, "vehicles", job.vehicleId));
      vehicleType = vSnap.exists() ? (vSnap.data().vehicleType as string | undefined) : undefined;
    }

    // Match catalog names case-insensitively against the job's services.
    const nameByLower = new Map(catalog.map((c) => [c.name.toLowerCase(), c.name] as const));

    const serviceLineItems = [...(job.services ?? []), ...(job.customServices ?? [])].map((name) => {
      const catalogName = nameByLower.get(name.toLowerCase());
      const unitPrice = catalogName
        ? resolveServicePrice(catalog, catalogName, vehicleType) ?? 0
        : 0;
      return { description: name, qty: 1, unitPrice, lineTotal: unitPrice };
    });

    const partLineItems = (job.partsUsed ?? []).map((p) => ({
      description: p.itemName,
      qty: p.quantity,
      unitPrice: partLinePrice(p),
      lineTotal: p.quantity * partLinePrice(p),
    }));

    const lineItems = [
      ...serviceLineItems,
      ...partLineItems,
      ...(serviceLineItems.length === 0 && partLineItems.length === 0
        ? [{ description: "Labour", qty: 1, unitPrice: 0, lineTotal: 0 }]
        : []),
    ];
    const subtotal = lineItems.reduce((s, l) => s + l.lineTotal, 0);

    // Reuse the invoice that was auto-created when the job was opened.
    const existingSnap = await getDocs(
      query(collection(db, "servicecenters", centerId, "invoices"), where("serviceId", "==", job.id)),
    );
    if (!existingSnap.empty) {
      const existing = existingSnap.docs[0];
      const data = existing.data() as { status?: string; paidAmount?: number };
      setInvoiceId(existing.id);
      // Never rewrite an invoice that already has money against it.
      if (data.status === "pending" && !(data.paidAmount && data.paidAmount > 0)) {
        await safeUpdateDoc(existing.ref, {
          lineItems,
          subtotal,
          grandTotal: subtotal,
          balanceDue: subtotal,
          serviceDate: Timestamp.now(),
          updatedAt: serverTimestamp(),
        });
      }
      return;
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const prefix = `INV-${year}-${month}-`;

    const lastSnap = await getDocs(
      query(
        collection(db, "servicecenters", centerId, "invoices"),
        where("invoiceNumber", ">=", prefix),
        where("invoiceNumber", "<=", prefix + "￿"),
        orderBy("invoiceNumber", "desc"),
        limit(1),
      ),
    );

    let seq = 1;
    if (!lastSnap.empty) {
      const lastNum = lastSnap.docs[0].data().invoiceNumber as string;
      const n = parseInt(lastNum.slice(prefix.length), 10);
      if (!isNaN(n)) seq = n + 1;
    }
    const invoiceNumber = `${prefix}${String(seq).padStart(4, "0")}`;

    const invRef = await safeAddDoc(collection(db, "servicecenters", centerId, "invoices"), {
      invoiceNumber,
      serviceId: job.id,
      customerId: job.customerId,
      customerName: job.customerName,
      customerPhone: job.customerPhone,
      vehicleId: job.vehicleId,
      plateNumber: job.plateNumber,
      // Client timestamps so the invoice is orderable/visible in cached lists
      // while offline (pending serverTimestamps read back as null).
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
      centerId,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    setInvoiceId(invRef.id);
  };

  const handleMarkDone = async () => {
    if (!job) return;
    const mo = parseInt(mileageOut, 10);
    if (!mileageOut || isNaN(mo)) { setActionError("Enter mileage out first"); return; }
    if (mo < job.mileageIn) { setActionError("Mileage out must be ≥ mileage in"); return; }

    setSaving(true);
    setActionError("");

    try {
      const ns = parseInt(nextServiceMileage, 10);

      // Check stock for Pro users
      if (isPro(centerPlan) && job.partsUsed.length > 0) {
        for (const part of job.partsUsed) {
          const itemSnap = await getDoc(doc(db, "servicecenters", currentUser!.centerId!, "inventory", part.itemId));
          if (itemSnap.exists()) {
            const item = { id: itemSnap.id, ...itemSnap.data() } as InventoryItem;
            if (item.currentQty < part.quantity) {
              setStockWarning({ item, needed: part.quantity });
              setSaving(false);
              return;
            }
          }
        }
        await deductParts();
      }

      await safeUpdateDoc(doc(db, "servicecenters", currentUser!.centerId!, "jobs", job.id), {
        status: "done",
        mileageOut: mo,
        nextServiceMileageKm: isNaN(ns) ? mo + 5000 : ns,
        oilBrand, oilGrade, oilViscosityNotes,
        smsSent: false,
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Auto-create draft invoice — SMS to the customer is sent later
      // when the owner finalises the invoice from the Invoice page.
      await createDraftInvoice({ ...job, mileageOut: mo });

      // Update vehicle
      const reminderFields = await buildReminderFields(job.vehicleId);
      await safeUpdateDoc(doc(db, "servicecenters", currentUser!.centerId!, "vehicles", job.vehicleId), {
        currentMileageKm: mo,
        nextServiceMileageKm: isNaN(ns) ? mo + 5000 : ns,
        oilBrand, oilGrade, oilViscosityNotes,
        lastServiceDate: serverTimestamp(),
        ...reminderFields,
        updatedAt: serverTimestamp(),
      });
    } catch { setActionError("Failed to mark done"); }
    setSaving(false);
  };

  // Derive a time-based service interval from the gap since the previous
  // service so the backend can send a reminder SMS when the next one is due.
  // Resets reminderSent so the new service cycle can trigger a fresh reminder.
  const buildReminderFields = async (vehicleId: string): Promise<Record<string, unknown>> => {
    const fields: Record<string, unknown> = { reminderSent: false };
    try {
      const vSnap = await getDoc(doc(db, "servicecenters", currentUser!.centerId!, "vehicles", vehicleId));
      const prev = vSnap.exists() ? (vSnap.data().lastServiceDate as Timestamp | null | undefined) : null;
      if (prev?.toMillis) {
        const nowMs = Date.now();
        const intervalDays = Math.round((nowMs - prev.toMillis()) / 86_400_000);
        if (intervalDays > 0) {
          fields.serviceIntervalDays = intervalDays;
          fields.nextServiceDate = Timestamp.fromMillis(nowMs + intervalDays * 86_400_000);
        }
      }
    } catch {
      /* non-fatal — reminder scheduling is best-effort */
    }
    return fields;
  };

  const deductParts = async () => {
    if (!job) return;
    for (const part of job.partsUsed) {
      const itemRef = doc(db, "servicecenters", currentUser!.centerId!, "inventory", part.itemId);
      const itemSnap = await getDoc(itemRef);
      if (itemSnap.exists()) {
        const item = itemSnap.data() as InventoryItem;
        const newQty = Math.max(0, item.currentQty - part.quantity);
        await safeUpdateDoc(itemRef, { currentQty: newQty });
        logMovement({
          centerId: currentUser!.centerId!,
          itemId: part.itemId,
          itemName: part.itemName,
          unit: item.unit,
          type: "deduction",
          qtyChange: newQty - item.currentQty,
          qtyBefore: item.currentQty,
          qtyAfter: newQty,
          refId: job.id,
          refLabel: `Job ${job.jobNumber} · ${job.plateNumber}`,
          performedBy: currentUser!.uid,
          performedByName: currentUser!.displayName ?? currentUser!.email ?? "Staff",
        }).catch(() => {});
      }
    }
  };

  const handleStockWarningConfirm = async () => {
    if (!stockWarning || !job) return;
    setStockWarning(null);
    setSaving(true);
    // Force deduct (set to 0)
    await safeUpdateDoc(doc(db, "servicecenters", currentUser!.centerId!, "inventory", stockWarning.item.id), { currentQty: 0 });
    await deductParts();
    const mo = parseInt(mileageOut, 10);
    const ns = parseInt(nextServiceMileage, 10);
    await safeUpdateDoc(doc(db, "servicecenters", currentUser!.centerId!, "jobs", job.id), {
      status: "done",
      mileageOut: mo,
      nextServiceMileageKm: isNaN(ns) ? mo + 5000 : ns,
      oilBrand, oilGrade, oilViscosityNotes,
      smsSent: false,
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await createDraftInvoice({ ...job, mileageOut: mo });
    const reminderFields = await buildReminderFields(job.vehicleId);
    await safeUpdateDoc(doc(db, "servicecenters", currentUser!.centerId!, "vehicles", job.vehicleId), {
      currentMileageKm: mo,
      nextServiceMileageKm: isNaN(ns) ? mo + 5000 : ns,
      lastServiceDate: serverTimestamp(),
      ...reminderFields,
      updatedAt: serverTimestamp(),
    });
    setSaving(false);
  };

  const handleMarkDelivered = async () => {
    if (!job) return;
    setSaving(true);
    setActionError("");
    try {
      await safeUpdateDoc(doc(db, "servicecenters", currentUser!.centerId!, "jobs", job.id), {
        status: "delivered",
        deliveredAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch { setActionError("Failed to update status"); }
    setSaving(false);
  };

  const handleRevert = async () => {
    if (!job) return;
    const idx = STATUS_ORDER.indexOf(job.status);
    if (idx <= 0) return;
    const prev = STATUS_ORDER[idx - 1];
    setRevertModal(false);
    setSaving(true);
    try {
      const updates: Record<string, unknown> = { status: prev, updatedAt: serverTimestamp() };
      if (prev === "pending") updates.startedAt = null;
      if (prev === "in_progress") updates.completedAt = null;
      if (prev === "done") updates.deliveredAt = null;
      await safeUpdateDoc(doc(db, "servicecenters", currentUser!.centerId!, "jobs", job.id), updates);
    } catch { setActionError("Failed to revert status"); }
    setSaving(false);
  };

  // Prints the job card under its own number rather than the app name, and
  // offers the one-time steps for the browser's header/footer (see
  // lib/printDocument.ts).
  const { print: handlePrint, setupDialog } = usePrintDocument(job?.jobNumber);

  if (loading) {
    return (
      <LoadingScreen />
    );
  }
  if (!job) return null;

  const statusIdx = STATUS_ORDER.indexOf(job.status);
  const crew = jobCrew(job);
  const isEditable = job.status !== "done" && job.status !== "delivered";
  // Recording work and consuming parts are separate permissions from editing
  // the job itself, so a role can be allowed one without the other.
  const canEditServices = isEditable && (canRecordServices || canEditJob);
  const canEditParts = isEditable && (canAddParts || canEditJob);
  // Completion SMS template is now resolved & sent from the Invoice page
  // after the owner finalises the invoice. Keep state mounted so we don't
  // re-fetch when the user navigates between pages.
  void completionTemplate;

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #print-card, #print-card * { visibility: visible !important; }
          #print-card { position: fixed; inset: 0; background: white; color: black; padding: 24px; }
        }
      `}</style>

      <div className="min-h-screen bg-[#0B1120] text-white print:hidden">
        {/* Header */}
        <div className="border-b border-white/10 bg-[#162032]">
          <div className="max-w-4xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <button onClick={() => navigate("/services")} className="text-gray-400 hover:text-white">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wider">Job Card</div>
                  <div className="text-lg font-bold text-white">{job.jobNumber}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrint}
                  className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg text-sm"
                >
                  <Printer className="w-4 h-4" />
                  Print
                </button>
                {canEditJob && job.status !== "pending" && (
                  <button
                    onClick={() => setRevertModal(true)}
                    className="text-xs text-gray-500 hover:text-gray-300 underline"
                  >
                    Revert Status
                  </button>
                )}
              </div>
            </div>

            {/* Progress bar */}
            <div className="flex items-center gap-1">
              {STATUS_ORDER.map((s, i) => {
                const done = i < statusIdx;
                const active = i === statusIdx;
                return (
                  <div key={s} className="flex items-center gap-1 flex-1">
                    <div className="flex flex-col items-center gap-1 flex-1">
                      <div className={`w-full h-1.5 rounded-full ${done || active ? (done ? "bg-green-500" : "bg-orange-500") : "bg-white/10"}`} />
                      <span className={`text-xs ${active ? "text-orange-400" : done ? "text-green-400" : "text-gray-600"}`}>
                        {STATUS_LABELS[s]}
                      </span>
                    </div>
                    {i < STATUS_ORDER.length - 1 && <ChevronRight className="w-3 h-3 text-gray-600 flex-shrink-0" />}
                  </div>
                );
              })}
            </div>

            <div className="text-xs text-gray-500 mt-2">Created {formatTs(job.createdAt)}</div>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
          {/* Customer & Vehicle cards. Roles without customer access (technicians)
              see the vehicle only — the plate and mileage are what the work needs. */}
          <div className={`grid grid-cols-1 gap-4 ${canViewCustomer ? "md:grid-cols-2" : ""}`}>
            {canViewCustomer && (
              <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
                <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Customer</div>
                <div className="font-semibold text-white text-lg">{job.customerName}</div>
                <a href={`tel:${job.customerPhone}`} className="flex items-center gap-1.5 text-orange-400 text-sm mt-1 hover:text-orange-300">
                  <Phone className="w-3.5 h-3.5" />
                  {job.customerPhone}
                </a>
                <Link to={`/customers/${job.customerId}`} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white mt-2">
                  <ExternalLink className="w-3 h-3" />
                  View Customer
                </Link>
              </div>
            )}
            <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Vehicle</div>
              <div className="font-bold text-white text-xl">{job.plateNumber}</div>
              <div className="text-sm text-gray-300 mt-0.5">{job.make} {job.model} · {job.year}</div>
              <div className="grid grid-cols-2 gap-x-4 mt-3 text-xs text-gray-400">
                <div>Mileage In: <span className="text-white">{job.mileageIn.toLocaleString()} km</span></div>
                {job.mileageOut && <div>Mileage Out: <span className="text-white">{job.mileageOut.toLocaleString()} km</span></div>}
                {job.oilBrand && <div>Oil: <span className="text-white">{job.oilBrand} {job.oilGrade}</span></div>}
              </div>
            </div>
          </div>

          {/* Services Performed */}
          <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Services Performed</div>
              {canEditServices && (
                <button
                  onClick={() => setAddingService(true)}
                  className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add service
                </button>
              )}
            </div>
            <div className="space-y-1">
              {localServices.map((s) => (
                <div key={s} className="flex items-center gap-2 text-sm">
                  <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                  <span className="text-white">{s}</span>
                  {canEditServices && (
                    <button onClick={() => { setLocalServices((p) => p.filter((x) => x !== s)); setServicesDirty(true); }} className="ml-auto text-gray-600 hover:text-red-400">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
              {localCustomServices.map((s) => (
                <div key={s} className="flex items-center gap-2 text-sm">
                  <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                  <span className="text-white">{s}</span>
                  {canEditServices && (
                    <button onClick={() => { setLocalCustomServices((p) => p.filter((x) => x !== s)); setServicesDirty(true); }} className="ml-auto text-gray-600 hover:text-red-400">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {addingService && (
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  placeholder="Service name…"
                  value={newService}
                  onChange={(e) => setNewService(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newService.trim()) {
                      setLocalCustomServices((p) => [...p, newService.trim()]);
                      setServicesDirty(true);
                      setNewService("");
                      setAddingService(false);
                    }
                  }}
                  className="flex-1 bg-white/5 border border-white/10 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-orange-500"
                  autoFocus
                />
                <button
                  onClick={() => {
                    if (newService.trim()) {
                      setLocalCustomServices((p) => [...p, newService.trim()]);
                      setServicesDirty(true);
                      setNewService("");
                    }
                    setAddingService(false);
                  }}
                  className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg text-sm"
                >
                  Add
                </button>
                <button onClick={() => setAddingService(false)} className="text-gray-400 hover:text-white px-2 text-sm">Cancel</button>
              </div>
            )}
            {servicesDirty && (
              <button onClick={saveServices} className="mt-3 bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-lg text-sm">
                Save Changes
              </button>
            )}
          </div>

          {/* Parts Used (Pro only) */}
          {isPro(centerPlan) && (
            <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Parts Used</div>
              {job.partsUsed.length > 0 && (
                <div className="space-y-2 mb-3">
                  {job.partsUsed.map((p) => (
                    <div key={p.itemId} className="flex items-center justify-between text-sm">
                      <span className="text-white">{p.itemName}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-gray-400">×{p.quantity}</span>
                        {partLinePrice(p) > 0 && (
                          <span className="text-gray-400">LKR {(partLinePrice(p) * p.quantity).toLocaleString()}</span>
                        )}
                        {canEditParts && (
                          <button onClick={() => removePart(p.itemId)} className="text-gray-600 hover:text-red-400">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {canEditParts && (
                <div className="space-y-2">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search inventory item…"
                      value={partSearch}
                      onChange={(e) => { setPartSearch(e.target.value); setSelectedPart(null); }}
                      className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                    />
                    {partResults.length > 0 && !selectedPart && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-[#0B1120] border border-white/10 rounded-lg overflow-hidden z-10">
                        {partResults.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => { setSelectedPart(item); setPartSearch(item.name); setPartResults([]); }}
                            className="w-full text-left px-3 py-2 text-sm text-white hover:bg-white/5 flex justify-between"
                          >
                            <span>{item.name}</span>
                            <span className="text-gray-400">Stock: {item.currentQty} {item.unit}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {selectedPart && (
                    <div className="flex gap-2">
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
            </div>
          )}

          {/* Mileage Out & Next Service — only once the job has actually
              started; before that there's nothing to record yet. */}
          {job.status === "in_progress" && (
            <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Mileage Out & Next Service</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Mileage Out (km) *</label>
                  <input
                    type="number"
                    value={mileageOut}
                    onChange={(e) => handleMileageOutChange(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                    placeholder={`Min: ${job.mileageIn.toLocaleString()}`}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Next Service Mileage (km)</label>
                  <input
                    type="number"
                    value={nextServiceMileage}
                    onChange={(e) => { setNextServiceMileage(e.target.value); setMileageDirty(true); }}
                    className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Oil Brand</label>
                  <input
                    type="text"
                    value={oilBrand}
                    onChange={(e) => { setOilBrand(e.target.value); setMileageDirty(true); }}
                    className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                    placeholder="e.g. Mobil"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Oil Grade</label>
                  <input
                    type="text"
                    value={oilGrade}
                    onChange={(e) => { setOilGrade(e.target.value); setMileageDirty(true); }}
                    className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                    placeholder="e.g. 5W-30"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-gray-400 block mb-1">Oil Notes</label>
                  <input
                    type="text"
                    value={oilViscosityNotes}
                    onChange={(e) => { setOilViscosityNotes(e.target.value); setMileageDirty(true); }}
                    className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>
              {mileageDirty && (
                <button onClick={saveMileage} className="mt-3 bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-lg text-sm">
                  Save
                </button>
              )}
            </div>
          )}

          {/* Vehicle Inspection (Pro only) — conducted after the job starts,
              not at creation. Once a record exists (or was skipped), show it;
              otherwise offer to start it, plus who's meant to do it. */}
          {isPro(centerPlan) && inspectionEnabled && canViewInspection && inspection !== undefined && (
            inspection !== null ? (
              <InspectionViewer centerId={currentUser!.centerId!} jobId={job.id} />
            ) : job.status === "in_progress" ? (
              <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 text-gray-300">
                    <ClipboardList className="w-4 h-4 text-[#F97316]" />
                    <span className="text-xs uppercase tracking-wider font-semibold">Vehicle Inspection</span>
                  </div>
                  {canAssignTech && (
                    <button
                      onClick={() => setEditingInspector((v) => !v)}
                      className="text-xs text-orange-400 hover:text-orange-300"
                    >
                      {editingInspector ? "Done" : job.inspectorName ? "Change inspector" : "Assign inspector"}
                    </button>
                  )}
                </div>

                <p className="text-sm text-gray-400">
                  {job.inspectorName
                    ? <>Assigned to <span className="text-white">{job.inspectorName}</span>.</>
                    : "Not assigned to anyone in particular — any technician on this job can do it."}
                </p>

                {canAssignTech && editingInspector && (
                  <div className="mt-3 border-t border-white/5 pt-3">
                    {technicianOptions.length === 0 ? (
                      <p className="text-xs text-gray-500">No active technicians found.</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          onClick={() => assignInspector(null)}
                          disabled={savingInspector}
                          className={`text-left text-sm px-3 py-2 rounded-lg border transition-colors disabled:opacity-50 ${
                            !job.inspectorId
                              ? "bg-orange-500/10 border-orange-500 text-orange-300"
                              : "bg-white/5 border-white/10 text-gray-300 hover:border-white/30"
                          }`}
                        >
                          Unassigned (anyone)
                        </button>
                        {technicianOptions.map((t) => (
                          <button
                            key={t.id}
                            onClick={() => assignInspector(t)}
                            disabled={savingInspector}
                            className={`text-left text-sm px-3 py-2 rounded-lg border transition-colors truncate disabled:opacity-50 ${
                              job.inspectorId === t.id
                                ? "bg-orange-500/10 border-orange-500 text-orange-300"
                                : "bg-white/5 border-white/10 text-gray-300 hover:border-white/30"
                            }`}
                          >
                            {staffDisplayName(t)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {canConductInspection && (!job.inspectorId || job.inspectorId === currentUser?.uid) && (
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => setShowInspectionForm(true)}
                      className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold py-2 rounded-lg text-sm"
                    >
                      Start Inspection
                    </button>
                    <button
                      onClick={handleSkipInspection}
                      className="flex-1 bg-white/10 hover:bg-white/20 text-gray-300 py-2 rounded-lg text-sm"
                    >
                      Skip
                    </button>
                  </div>
                )}
              </div>
            ) : null
          )}

          {/* Internal notes */}
          {job.internalNotes && (
            <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">Internal Notes</div>
              <p className="text-sm text-gray-300 whitespace-pre-wrap">{job.internalNotes}</p>
            </div>
          )}

          {/* Technicians — a car in a bay is often more than one person's work,
              so the job carries a crew rather than a single name. */}
          <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
                {crew.length > 1 ? "Technicians" : "Technician"}
              </div>
              {canAssignTech && (
                <button
                  onClick={() => setEditingCrew((v) => !v)}
                  className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300"
                >
                  <Users className="w-3.5 h-3.5" />
                  {editingCrew ? "Done" : crew.length === 0 ? "Assign" : "Change"}
                </button>
              )}
            </div>

            {crew.length === 0 ? (
              <p className="text-sm text-gray-500">Unassigned</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {crew.map((tech, i) => (
                  <span
                    key={tech.id || tech.name}
                    className="flex items-center gap-1.5 text-sm bg-white/5 border border-white/10 text-white px-2.5 py-1 rounded-full"
                  >
                    {tech.name || "Technician"}
                    {crew.length > 1 && (
                      <span className="text-[10px] text-gray-500">{i === 0 ? "lead" : `#${i + 1}`}</span>
                    )}
                  </span>
                ))}
              </div>
            )}

            {canAssignTech && editingCrew && (
              <div className="mt-3 border-t border-white/5 pt-3">
                {technicianOptions.length === 0 ? (
                  <p className="text-xs text-gray-500">No active technicians found.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {technicianOptions.map((t) => {
                      const idx = crew.findIndex((c) => c.id === t.id);
                      const on = idx >= 0;
                      return (
                        <button
                          key={t.id}
                          onClick={() => toggleCrewMember(t)}
                          disabled={savingCrew}
                          className={`flex items-center justify-between gap-2 text-left text-sm px-3 py-2 rounded-lg border transition-colors disabled:opacity-50 ${
                            on
                              ? "bg-orange-500/10 border-orange-500 text-orange-300"
                              : "bg-white/5 border-white/10 text-gray-300 hover:border-white/30"
                          }`}
                        >
                          <span className="truncate">{staffDisplayName(t)}</span>
                          {on && (
                            <span className="text-[10px] flex-shrink-0 px-1.5 py-0.5 rounded-full bg-orange-500/20">
                              {idx === 0 ? "Lead" : `#${idx + 1}`}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="text-[11px] text-gray-600 mt-2">
                  Everyone assigned sees this job in their own list. The first is the lead.
                </p>
              </div>
            )}
          </div>

          {/* Vehicle Activity Log — flags from a previous visit surface here
              too, and whoever's on this job can record what they noticed. */}
          <VehicleActivityLog
            centerId={currentUser!.centerId!}
            vehicleId={job.vehicleId}
            canAdd={canRecordActivity}
            canManage={canEditJob}
          />

          {/* Action error */}
          {actionError && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-3 py-2 text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {actionError}
            </div>
          )}

          {/* Status action buttons */}
          {(canMarkInProgress || canMarkDone || canMarkDelivered) && (
            <div className="flex flex-col sm:flex-row gap-3 pb-8">
              {job.status === "pending" && canMarkInProgress && (
                <button
                  onClick={handleStartJob}
                  disabled={saving}
                  className="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
                >
                  {saving ? "Updating…" : "▶ Start Job"}
                </button>
              )}
              {job.status === "in_progress" && canMarkDone && (
                <button
                  onClick={handleMarkDone}
                  disabled={saving}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
                >
                  {saving ? "Updating…" : "✓ Mark Done & Generate Invoice"}
                </button>
              )}
              {job.status === "done" && canMarkDelivered && (
                <button
                  onClick={handleMarkDelivered}
                  disabled={saving}
                  className="flex-1 bg-blue-700 hover:bg-blue-800 text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
                >
                  {saving ? "Updating…" : "🚗 Mark Delivered"}
                </button>
              )}
              {canViewInvoice && invoiceId && (job.status === "done" || job.status === "delivered") && (
                <Link
                  to={`/invoices/${invoiceId}`}
                  className="flex-1 flex items-center justify-center gap-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 py-3 rounded-xl font-semibold text-sm"
                >
                  📄 View Invoice
                </Link>
              )}
              {/* How the customer settled — cash, card, cheque or credit — is
                  recorded against this job's invoice, so send them there. */}
              {canMarkPayment && invoiceId && (job.status === "done" || job.status === "delivered") && (
                <Link
                  to={`/invoices/${invoiceId}`}
                  className="flex-1 flex items-center justify-center gap-2 bg-green-600/20 hover:bg-green-600/30 text-green-300 border border-green-500/30 py-3 rounded-xl font-semibold text-sm"
                >
                  💵 Record Payment
                </Link>
              )}
            </div>
          )}

          {/* ── SMS Status ── */}
          {smsLogs.length > 0 && (
            <div className="bg-[#162032] border border-white/10 rounded-xl p-4 mt-6">
              <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">
                SMS Notifications
              </div>
              <div className="space-y-2">
                {smsLogs.map((log) => {
                  const status = log.status;
                  const colour =
                    status === "delivered" ? "text-green-400 bg-green-500/10 border-green-500/20"
                    : status === "failed" ? "text-red-400 bg-red-500/10 border-red-500/20"
                    : "text-amber-400 bg-amber-500/10 border-amber-500/20";
                  return (
                    <div key={log.id} className={`border rounded-lg px-3 py-2 ${colour}`}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium capitalize">
                          {log.messageType} · {status === "sent" ? "Queued — awaiting gateway" : status}
                        </span>
                        <span className="text-gray-400">{formatTs(log.sentAt)}</span>
                      </div>
                      <p className="text-xs text-gray-300 mt-1 break-words">{log.message}</p>
                      {status === "failed" && (
                        <div className="mt-1 text-[11px] text-red-300">
                          {log.errorCode && <div>Error: {log.errorCode}</div>}
                          {log.errorMessage && <div className="mt-0.5">{log.errorMessage}</div>}
                          {typeof log.providerResponse === "string" && log.providerResponse && (
                            <div className="break-all">{log.providerResponse}</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-gray-500 mt-2">
                Status updates automatically once the gateway responds. Failed messages can be retried from the SMS Log page.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Print card */}
      <div id="print-card" ref={printRef} style={{ display: "none" }} className="hidden print:block bg-white text-black p-8 max-w-lg mx-auto">
        <div className="text-center mb-6 border-b border-gray-300 pb-4">
          <div className="font-bold text-xl">{centerName}</div>
          <div className="text-sm text-gray-600">{centerAddress}</div>
        </div>
        <div className="text-center mb-4">
          <div className="text-lg font-bold">Job Card #{job.jobNumber}</div>
          <div className="text-sm text-gray-500">{formatTs(job.createdAt)}</div>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
          <div><strong>Customer:</strong> {job.customerName}</div>
          <div><strong>Phone:</strong> {job.customerPhone}</div>
          <div><strong>Plate:</strong> {job.plateNumber}</div>
          <div><strong>Vehicle:</strong> {job.make} {job.model} {job.year}</div>
          <div><strong>Mileage In:</strong> {job.mileageIn.toLocaleString()} km</div>
          {job.mileageOut && <div><strong>Mileage Out:</strong> {job.mileageOut.toLocaleString()} km</div>}
          <div><strong>{crew.length > 1 ? "Technicians" : "Technician"}:</strong> {jobTechnicianNames(job).join(", ") || "Unassigned"}</div>
        </div>
        <div className="mb-4">
          <strong className="text-sm">Services Performed:</strong>
          <ul className="mt-1 text-sm list-disc ml-4">
            {[...job.services, ...job.customServices].map((s) => <li key={s}>{s}</li>)}
          </ul>
        </div>
        {job.oilBrand && (
          <div className="text-sm"><strong>Oil:</strong> {job.oilBrand} {job.oilGrade} {job.oilViscosityNotes}</div>
        )}
      </div>

      {/* Inspection form (full screen) */}
      {showInspectionForm && currentUser?.centerId && (
        <VehicleInspectionForm
          centerId={currentUser.centerId}
          jobId={job.id}
          conductedBy={currentUser.uid}
          plateNumber={job.plateNumber}
          onComplete={() => setShowInspectionForm(false)}
        />
      )}

      {/* Stock Warning Modal */}
      {stockWarning && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#162032] border border-white/10 rounded-xl p-6 max-w-sm w-full space-y-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-400" />
              <h3 className="font-semibold text-white">Insufficient Stock</h3>
            </div>
            <p className="text-sm text-gray-300">
              <strong className="text-white">{stockWarning.item.name}</strong> has only{" "}
              {stockWarning.item.currentQty} {stockWarning.item.unit} in stock but {stockWarning.needed} required.
              Stock will be set to 0. Proceed anyway?
            </p>
            <div className="flex gap-2">
              <button onClick={handleStockWarningConfirm} className="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-2 rounded-lg text-sm font-medium">
                Proceed
              </button>
              <button onClick={() => setStockWarning(null)} className="flex-1 bg-white/10 hover:bg-white/20 text-white py-2 rounded-lg text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revert Modal */}
      {revertModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#162032] border border-white/10 rounded-xl p-6 max-w-sm w-full space-y-4">
            <h3 className="font-semibold text-white">Revert Status?</h3>
            <p className="text-sm text-gray-300">
              This will change status from <strong className="text-white">{STATUS_LABELS[job.status]}</strong> back to{" "}
              <strong className="text-white">{STATUS_LABELS[STATUS_ORDER[statusIdx - 1]]}</strong>.
            </p>
            <div className="flex gap-2">
              <button onClick={handleRevert} className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg text-sm font-medium">
                Revert
              </button>
              <button onClick={() => setRevertModal(false)} className="flex-1 bg-white/10 hover:bg-white/20 text-white py-2 rounded-lg text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {setupDialog}
    </>
  );
}
