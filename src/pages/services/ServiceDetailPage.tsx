import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import {
  doc, onSnapshot, updateDoc, serverTimestamp, collection,
  query, where, getDocs, getDoc, addDoc, Timestamp,
  runTransaction,
} from "firebase/firestore";
import {
  ArrowLeft, Phone, ExternalLink, Plus, X, Printer,
  AlertTriangle, CheckCircle, ChevronRight,
} from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { ServiceJob, InventoryItem, PartUsed, UserRole, ServiceCenter, SmsLog, ServicePriceItem } from "../../types/auth";
import InspectionViewer from "../../components/inspection/InspectionViewer";
import { DEFAULT_COMPLETION_TEMPLATE } from "../../lib/smsTemplates";

const canChangeStatus = (role?: UserRole) =>
  role === "Owner" || role === "Manager" || role === "Technician";
const canRevert = (role?: UserRole) =>
  role === "Owner" || role === "Manager";
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

  const [job, setJob] = useState<ServiceJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [centerName, setCenterName] = useState("");
  const [centerAddress, setCenterAddress] = useState("");
  const [centerPlan, setCenterPlan] = useState<"basic" | "pro">("basic");
  const [completionTemplate, setCompletionTemplate] = useState(DEFAULT_COMPLETION_TEMPLATE);

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

  // Load center info for print
  useEffect(() => {
    if (!currentUser?.centerId) return;
    getDoc(doc(db, "servicecenters", currentUser.centerId)).then((snap) => {
      if (snap.exists()) {
        const d = snap.data() as ServiceCenter;
        setCenterName(d.name ?? "");
        setCenterAddress(d.address ?? "");
        setCenterPlan(d.plan ?? "basic");
        if (d.completionSmsTemplate) setCompletionTemplate(d.completionSmsTemplate);
      }
    });
  }, [currentUser?.centerId]);

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
      : [...job.partsUsed, { itemId: selectedPart.id, itemName: selectedPart.name, quantity: qty, unitCost: selectedPart.unitCost }];
    updateDoc(doc(db, "servicecenters", currentUser!.centerId!, "jobs", job.id), { partsUsed: newParts, updatedAt: serverTimestamp() });
    setSelectedPart(null);
    setPartSearch("");
    setPartQty("1");
    setPartResults([]);
  };

  const removePart = (itemId: string) => {
    if (!job) return;
    updateDoc(doc(db, "servicecenters", currentUser!.centerId!, "jobs", job.id), {
      partsUsed: job.partsUsed.filter((p) => p.itemId !== itemId),
      updatedAt: serverTimestamp(),
    });
  };

  const saveServices = async () => {
    if (!job) return;
    await updateDoc(doc(db, "servicecenters", currentUser!.centerId!, "jobs", job.id), {
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
    await updateDoc(doc(db, "servicecenters", currentUser!.centerId!, "jobs", job.id), {
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
      await updateDoc(doc(db, "servicecenters", currentUser!.centerId!, "jobs", job.id), {
        status: "in_progress",
        startedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch { setActionError("Failed to update status"); }
    setSaving(false);
  };

  const createDraftInvoice = async (job: ServiceJob) => {
    const centerId = currentUser!.centerId!;
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const key = `${year}_${month}`;

    const counterRef = doc(db, "servicecenters", centerId, "counters", "invoices");
    let seq = 1;
    await runTransaction(db, async (t) => {
      const snap = await t.get(counterRef);
      if (snap.exists()) {
        seq = ((snap.data()[key] as number) ?? 0) + 1;
        t.update(counterRef, { [key]: seq });
      } else {
        t.set(counterRef, { [key]: seq });
      }
    });
    const invoiceNumber = `INV-${year}-${month}-${String(seq).padStart(4, "0")}`;

    // Fetch service library to price the services on this job
    const priceSnap = await getDocs(collection(db, "servicecenters", centerId, "servicePrices"));
    const priceMap = new Map<string, number>();
    priceSnap.docs.forEach((d) => {
      const item = d.data() as ServicePriceItem;
      priceMap.set(item.name.toLowerCase(), item.defaultPrice ?? item.price ?? 0);
    });

    const serviceLineItems = [...(job.services ?? []), ...(job.customServices ?? [])].map((name) => {
      const unitPrice = priceMap.get(name.toLowerCase()) ?? 0;
      return { description: name, qty: 1, unitPrice, lineTotal: unitPrice };
    });

    const partLineItems = (job.partsUsed ?? []).map((p) => ({
      description: p.itemName,
      qty: p.quantity,
      unitPrice: p.unitCost ?? 0,
      lineTotal: p.quantity * (p.unitCost ?? 0),
    }));

    const lineItems = [
      ...serviceLineItems,
      ...partLineItems,
      ...(serviceLineItems.length === 0 && partLineItems.length === 0
        ? [{ description: "Labour", qty: 1, unitPrice: 0, lineTotal: 0 }]
        : []),
    ];
    const subtotal = lineItems.reduce((s, l) => s + l.lineTotal, 0);

    await addDoc(collection(db, "servicecenters", centerId, "invoices"), {
      invoiceNumber,
      serviceId: job.id,
      customerId: job.customerId,
      customerName: job.customerName,
      customerPhone: job.customerPhone,
      vehicleId: job.vehicleId,
      plateNumber: job.plateNumber,
      serviceDate: serverTimestamp(),
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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
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

      await updateDoc(doc(db, "servicecenters", currentUser!.centerId!, "jobs", job.id), {
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
      await updateDoc(doc(db, "servicecenters", currentUser!.centerId!, "vehicles", job.vehicleId), {
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
        await updateDoc(itemRef, { currentQty: newQty });
      }
    }
  };

  const handleStockWarningConfirm = async () => {
    if (!stockWarning || !job) return;
    setStockWarning(null);
    setSaving(true);
    // Force deduct (set to 0)
    await updateDoc(doc(db, "servicecenters", currentUser!.centerId!, "inventory", stockWarning.item.id), { currentQty: 0 });
    await deductParts();
    const mo = parseInt(mileageOut, 10);
    const ns = parseInt(nextServiceMileage, 10);
    await updateDoc(doc(db, "servicecenters", currentUser!.centerId!, "jobs", job.id), {
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
    await updateDoc(doc(db, "servicecenters", currentUser!.centerId!, "vehicles", job.vehicleId), {
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
      await updateDoc(doc(db, "servicecenters", currentUser!.centerId!, "jobs", job.id), {
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
      await updateDoc(doc(db, "servicecenters", currentUser!.centerId!, "jobs", job.id), updates);
    } catch { setActionError("Failed to revert status"); }
    setSaving(false);
  };

  const handlePrint = () => window.print();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center text-gray-400">
        Loading…
      </div>
    );
  }
  if (!job) return null;

  const statusIdx = STATUS_ORDER.indexOf(job.status);
  const isEditable = job.status !== "done" && job.status !== "delivered";
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
                {canRevert(currentUser?.role) && job.status !== "pending" && (
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
          {/* Customer & Vehicle cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              {isEditable && (
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
                  {isEditable && (
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
                  {isEditable && (
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
                        {p.unitCost && <span className="text-gray-400">LKR {(p.unitCost * p.quantity).toLocaleString()}</span>}
                        {isEditable && (
                          <button onClick={() => removePart(p.itemId)} className="text-gray-600 hover:text-red-400">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {isEditable && (
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

          {/* Mileage Out & Next Service */}
          {(job.status === "in_progress" || job.status === "pending") && (
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

          {/* Vehicle Inspection (Pro only — visible if an inspection record exists) */}
          {isPro(centerPlan) && (
            <InspectionViewer centerId={currentUser!.centerId!} jobId={job.id} />
          )}

          {/* Internal notes */}
          {job.internalNotes && (
            <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">Internal Notes</div>
              <p className="text-sm text-gray-300 whitespace-pre-wrap">{job.internalNotes}</p>
            </div>
          )}

          {/* Technician */}
          <div className="text-sm text-gray-400">
            Technician: <span className="text-white">{job.technicianName}</span>
          </div>

          {/* Action error */}
          {actionError && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-3 py-2 text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {actionError}
            </div>
          )}

          {/* Status action buttons */}
          {canChangeStatus(currentUser?.role) && (
            <div className="flex flex-col sm:flex-row gap-3 pb-8">
              {job.status === "pending" && (
                <button
                  onClick={handleStartJob}
                  disabled={saving}
                  className="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
                >
                  {saving ? "Updating…" : "▶ Start Job"}
                </button>
              )}
              {job.status === "in_progress" && (
                <button
                  onClick={handleMarkDone}
                  disabled={saving}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
                >
                  {saving ? "Updating…" : "✓ Mark Done & Generate Invoice"}
                </button>
              )}
              {job.status === "done" && (
                <button
                  onClick={handleMarkDelivered}
                  disabled={saving}
                  className="flex-1 bg-blue-700 hover:bg-blue-800 text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
                >
                  {saving ? "Updating…" : "🚗 Mark Delivered"}
                </button>
              )}
              {invoiceId && (job.status === "done" || job.status === "delivered") && (
                <Link
                  to={`/invoices/${invoiceId}`}
                  className="flex-1 flex items-center justify-center gap-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 py-3 rounded-xl font-semibold text-sm"
                >
                  📄 View Invoice
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
          <div><strong>Technician:</strong> {job.technicianName}</div>
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
    </>
  );
}
