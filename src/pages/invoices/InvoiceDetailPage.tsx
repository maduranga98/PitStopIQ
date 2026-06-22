import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import {
  doc, onSnapshot, updateDoc, serverTimestamp, getDoc,
  addDoc, collection, Timestamp, increment,
} from "firebase/firestore";
import {
  ArrowLeft, Plus, X, Printer, MessageCircle, Send,
  AlertTriangle, CheckCircle2, Lock, ExternalLink,
} from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { Invoice, InvoiceLineItem, InvoiceStatus, DiscountType, ServiceCenter } from "../../types/auth";
import { useTranslation } from "react-i18next";
import {
  resolveCompletionTemplate,
  buildViewLink,
  smsQuotaLimit,
  getCompletionTemplate,
  type SmsLang,
} from "../../lib/smsTemplates";

// ── Formatting ────────────────────────────────────────────────────────────────

function formatDate(ts: { toDate: () => Date } | undefined): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatLKR(n: number): string {
  return `LKR ${n.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_CHIP: Record<InvoiceStatus, string> = {
  pending: "bg-gray-500/20 text-gray-300 border border-gray-500/30",
  partial: "bg-amber-500/20 text-amber-300 border border-amber-500/30",
  paid:    "bg-green-500/20 text-green-300 border border-green-500/30",
};
const STATUS_LABEL: Record<InvoiceStatus, string> = {
  pending: "Pending",
  partial: "Partial",
  paid: "Paid",
};

// ── Line item helpers ─────────────────────────────────────────────────────────

function calcTotals(
  items: InvoiceLineItem[],
  discount: number,
  discountType: DiscountType,
  tax: number,
): { subtotal: number; discountAmount: number; grandTotal: number } {
  const subtotal = items.reduce((s, l) => s + l.lineTotal, 0);
  const discountAmount = discountType === "percent"
    ? Math.round((subtotal * discount) / 100 * 100) / 100
    : discount;
  const grandTotal = Math.max(0, subtotal - discountAmount + tax);
  return { subtotal, discountAmount, grandTotal };
}

// ── Main component ────────────────────────────────────────────────────────────

export default function InvoiceDetailPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [centerName, setCenterName] = useState("");
  const [centerAddress, setCenterAddress] = useState("");
  const [centerPhone, setCenterPhone] = useState("");
  const [centerLogoUrl, setCenterLogoUrl] = useState("");
  const [centerData, setCenterData] = useState<Record<string, unknown> | null>(null);
  const [customerLang, setCustomerLang] = useState<SmsLang>("english");
  const [smsQuotaUsed, setSmsQuotaUsed] = useState(0);
  const [smsQuotaMax, setSmsQuotaMax] = useState(200);
  const [smsModal, setSmsModal] = useState(false);
  const [smsSending, setSmsSending] = useState(false);
  const [job, setJob] = useState<{ services?: string[]; customServices?: string[]; mileageOut?: number; nextServiceMileageKm?: number; mileageIn?: number } | null>(null);

  // Editable local state (mirrors invoice)
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [discountType, setDiscountType] = useState<DiscountType>("amount");
  const [tax, setTax] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");

  // Load invoice
  useEffect(() => {
    if (!invoiceId || !currentUser?.centerId) return;

    return onSnapshot(
      doc(db, "servicecenters", currentUser.centerId, "invoices", invoiceId),
      (snap) => {
        if (!snap.exists()) { navigate("/invoices"); return; }
        const inv = { id: snap.id, ...snap.data() } as Invoice;
        setInvoice(inv);
        setLineItems(inv.lineItems ?? []);
        setDiscount(inv.discount ?? 0);
        setDiscountType(inv.discountType ?? "amount");
        setTax(inv.tax ?? 0);
        setPaidAmount(inv.paidAmount ?? 0);
        setDirty(false);
        setLoading(false);
      },
    );
  }, [invoiceId, currentUser?.centerId, currentUser?.role, navigate]);

  // Load center info
  useEffect(() => {
    if (!currentUser?.centerId) return;
    getDoc(doc(db, "servicecenters", currentUser.centerId)).then((snap) => {
      if (snap.exists()) {
        const d = snap.data() as ServiceCenter;
        setCenterName(d.name ?? "");
        setCenterAddress(d.address ?? "");
        setCenterPhone(d.phone ?? "");
        setCenterLogoUrl(d.logoUrl ?? "");
        setCenterData(d as unknown as Record<string, unknown>);
        const used = d.smsQuotaUsed ?? 0;
        const limit = d.smsQuotaLimit ?? smsQuotaLimit(d.plan ?? "basic");
        setSmsQuotaUsed(used);
        setSmsQuotaMax(limit);
      }
    });
  }, [currentUser?.centerId]);

  // Load linked job for service details (used in SMS body)
  useEffect(() => {
    if (!invoice?.serviceId || !currentUser?.centerId) return;
    getDoc(doc(db, "servicecenters", currentUser.centerId, "jobs", invoice.serviceId)).then((snap) => {
      if (snap.exists()) setJob(snap.data() as typeof job);
    });
  }, [invoice?.serviceId, currentUser?.centerId]);

  // Load the customer's preferred SMS language so we send in the right language
  useEffect(() => {
    if (!invoice?.customerId || !currentUser?.centerId) return;
    getDoc(doc(db, "servicecenters", currentUser.centerId, "customers", invoice.customerId)).then((snap) => {
      if (snap.exists()) {
        const lang = (snap.data() as { smsLanguage?: SmsLang }).smsLanguage;
        if (lang) setCustomerLang(lang);
      }
    });
  }, [invoice?.customerId, currentUser?.centerId]);

  const role = currentUser?.role;
  const canEditInvoice = role === "Owner" || role === "Manager" || role === "Cashier";

  // Technician has no invoice access
  if (!loading && role === "Technician") {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <Lock className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to view Invoices.</p>
        </div>
      </div>
    );
  }

  const isLocked = invoice?.status === "paid";
  const isEditable = !isLocked && canEditInvoice;

  // Computed totals
  const { subtotal, discountAmount, grandTotal } = calcTotals(lineItems, discount, discountType, tax);
  const balanceDue = Math.max(0, grandTotal - paidAmount);

  // ── Line item handlers ────────────────────────────────────────────────────

  function updateItem(idx: number, field: keyof InvoiceLineItem, value: string) {
    setLineItems((prev) => {
      const next = prev.map((item, i) => {
        if (i !== idx) return item;
        const updated = { ...item, [field]: field === "description" ? value : parseFloat(value) || 0 };
        updated.lineTotal = Math.round(updated.qty * updated.unitPrice * 100) / 100;
        return updated;
      });
      return next;
    });
    setDirty(true);
  }

  function addRow() {
    setLineItems((prev) => [...prev, { description: "", qty: 1, unitPrice: 0, lineTotal: 0 }]);
    setDirty(true);
  }

  function deleteRow(idx: number) {
    setLineItems((prev) => prev.filter((_, i) => i !== idx));
    setDirty(true);
  }

  // ── Save invoice ──────────────────────────────────────────────────────────

  async function handleSave() {
    if (!invoice || !currentUser?.centerId) return;
    setSaving(true);
    setActionError("");
    try {
      const updates = {
        lineItems,
        subtotal,
        discount,
        discountType,
        tax,
        grandTotal,
        paidAmount,
        balanceDue,
        updatedAt: serverTimestamp(),
      };
      await updateDoc(doc(db, "servicecenters", currentUser.centerId, "invoices", invoice.id), updates);
      setDirty(false);
    } catch {
      setActionError("Failed to save invoice.");
    }
    setSaving(false);
  }

  // ── Payment status ────────────────────────────────────────────────────────

  async function handleMarkPaid() {
    if (!invoice || !currentUser?.centerId) return;
    setSaving(true);
    setActionError("");
    try {
      await updateDoc(doc(db, "servicecenters", currentUser.centerId, "invoices", invoice.id), {
        status: "paid",
        paidAmount: grandTotal,
        balanceDue: 0,
        updatedAt: serverTimestamp(),
      });
    } catch {
      setActionError("Failed to mark as paid.");
    }
    setSaving(false);
  }

  async function handleSetStatus(status: InvoiceStatus) {
    if (!invoice || !currentUser?.centerId) return;
    setSaving(true);
    setActionError("");
    try {
      const updates: Record<string, unknown> = {
        status,
        updatedAt: serverTimestamp(),
      };
      if (status === "paid") {
        updates.paidAmount = grandTotal;
        updates.balanceDue = 0;
      } else if (status === "pending") {
        updates.paidAmount = 0;
        updates.balanceDue = grandTotal;
      }
      await updateDoc(doc(db, "servicecenters", currentUser.centerId, "invoices", invoice.id), updates);
    } catch {
      setActionError("Failed to update status.");
    }
    setSaving(false);
  }

  async function savePaidAmount() {
    if (!invoice || !currentUser?.centerId) return;
    setSaving(true);
    setActionError("");
    try {
      await updateDoc(doc(db, "servicecenters", currentUser.centerId, "invoices", invoice.id), {
        paidAmount,
        balanceDue: Math.max(0, grandTotal - paidAmount),
        updatedAt: serverTimestamp(),
      });
    } catch {
      setActionError("Failed to update paid amount.");
    }
    setSaving(false);
  }

  // ── Print PDF ─────────────────────────────────────────────────────────────

  const handlePrint = () => window.print();

  // ── SMS preview + send (after invoice finalization) ───────────────────────

  const viewLink = invoice && currentUser?.centerId
    ? buildViewLink(currentUser.centerId, invoice.customerId)
    : "";

  const servicesList = job
    ? [...(job.services ?? []), ...(job.customServices ?? [])].join(", ") || "Service"
    : "Service";

  const completionTemplate = getCompletionTemplate(centerData, customerLang);
  const smsPreview = invoice ? resolveCompletionTemplate(completionTemplate, {
    customerName: invoice.customerName,
    plate: invoice.plateNumber,
    centerName,
    centerPhone,
    servicesList,
    mileageOut: String(job?.mileageOut ?? ""),
    nextServiceMileage: String(job?.nextServiceMileageKm ?? ""),
    invoiceNumber: invoice.invoiceNumber,
    invoiceTotal: invoice.grandTotal.toLocaleString("en-LK", { minimumFractionDigits: 2 }),
    viewLink,
  }) : "";

  const quotaExceeded = smsQuotaUsed >= smsQuotaMax;

  async function handleFinalizeAndSendSms() {
    if (!invoice || !currentUser?.centerId) return;
    setSmsSending(true);
    setActionError("");
    try {
      await addDoc(collection(db, "servicecenters", currentUser.centerId, "smsLogs"), {
        customerId: invoice.customerId,
        customerName: invoice.customerName,
        phone: invoice.customerPhone,
        vehicleId: invoice.vehicleId,
        plateNumber: invoice.plateNumber,
        invoiceId: invoice.id,
        jobId: invoice.serviceId,
        messageType: "Completion",
        status: "sent",
        message: smsPreview,
        sentAt: Timestamp.now(),
      });
      await updateDoc(doc(db, "servicecenters", currentUser.centerId), {
        smsQuotaUsed: increment(1),
      });
      await updateDoc(doc(db, "servicecenters", currentUser.centerId, "invoices", invoice.id), {
        finalized: true,
        finalizedAt: serverTimestamp(),
        smsSent: true,
        updatedAt: serverTimestamp(),
      });
      // Mark linked job as having SMS sent
      if (invoice.serviceId) {
        await updateDoc(doc(db, "servicecenters", currentUser.centerId, "jobs", invoice.serviceId), {
          smsSent: true,
          updatedAt: serverTimestamp(),
        });
      }
      setSmsModal(false);
      setSmsQuotaUsed((q) => q + 1);
    } catch {
      setActionError("Failed to send SMS.");
    }
    setSmsSending(false);
  }

  // ── WhatsApp share ────────────────────────────────────────────────────────

  const handleWhatsApp = () => {
    if (!invoice) return;
    const phone = invoice.customerPhone.replace(/[^0-9]/g, "");
    const number = phone.startsWith("0") ? `94${phone.slice(1)}` : phone;
    const link = buildViewLink(currentUser!.centerId!, invoice.customerId);
    const msg = encodeURIComponent(
      `Dear ${invoice.customerName}, your invoice ${invoice.invoiceNumber} for vehicle ${invoice.plateNumber} is ready. Total: ${formatLKR(invoice.grandTotal)}. View & download: ${link} — ${centerPhone}`,
    );
    window.open(`https://wa.me/${number}?text=${msg}`, "_blank");
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center text-gray-400">Loading…</div>
    );
  }
  if (!invoice) return null;

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #invoice-print, #invoice-print * { visibility: visible !important; }
          #invoice-print {
            position: fixed; inset: 0;
            background: white; color: black;
            padding: 32px; font-family: sans-serif;
          }
        }
      `}</style>

      <div className="min-h-screen bg-[#0B1120] text-white print:hidden">
        {/* Page header */}
        <div className="border-b border-white/10 bg-[#0B1120]/80 backdrop-blur sticky top-0 z-10">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate("/invoices")} className="text-gray-400 hover:text-white">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wider">Invoice</div>
                <div className="text-lg font-bold font-mono">{invoice.invoiceNumber}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg text-sm"
              >
                <Printer className="w-4 h-4" />
                <span className="hidden sm:inline">Print / PDF</span>
              </button>
              <button
                onClick={handleWhatsApp}
                className="flex items-center gap-2 bg-green-600/20 hover:bg-green-600/30 text-green-400 px-3 py-1.5 rounded-lg text-sm"
              >
                <MessageCircle className="w-4 h-4" />
                <span className="hidden sm:inline">WhatsApp</span>
              </button>
            </div>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
          {/* Status + locked notice */}
          <div className="flex items-center gap-3">
            <span className={`text-sm font-semibold px-3 py-1 rounded-full ${STATUS_CHIP[invoice.status]}`}>
              {STATUS_LABEL[invoice.status]}
            </span>
            {isLocked && (
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <Lock className="w-3.5 h-3.5" />
                Invoice locked — payment received in full
              </span>
            )}
          </div>

          {/* Customer + Vehicle */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">Customer</div>
              <div className="font-semibold text-white text-lg">{invoice.customerName}</div>
              <div className="text-sm text-gray-400">{invoice.customerPhone}</div>
              <Link to={`/customers/${invoice.customerId}`} className="text-xs text-orange-400 hover:text-orange-300 mt-1 inline-block">
                View Customer →
              </Link>
            </div>
            <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">Vehicle & Job</div>
              <div className="font-bold text-white text-xl font-mono">{invoice.plateNumber}</div>
              <div className="text-sm text-gray-400 mt-0.5">Service date: {formatDate(invoice.serviceDate)}</div>
              <Link to={`/services/${invoice.serviceId}`} className="text-xs text-orange-400 hover:text-orange-300 mt-1 inline-block">
                View Job Card →
              </Link>
            </div>
          </div>

          {/* Line Items */}
          <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-4">Line Items</div>

            {/* Table header */}
            <div className="hidden sm:grid grid-cols-12 gap-2 text-xs text-gray-500 uppercase tracking-wider mb-2 px-1">
              <div className="col-span-5">Description</div>
              <div className="col-span-2 text-right">Qty</div>
              <div className="col-span-3 text-right">Unit Price</div>
              <div className="col-span-2 text-right">Total</div>
            </div>

            <div className="space-y-2">
              {lineItems.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-12 sm:col-span-5">
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => updateItem(idx, "description", e.target.value)}
                      disabled={!isEditable}
                      placeholder="Description"
                      className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <input
                      type="number"
                      value={item.qty}
                      min="0"
                      step="0.01"
                      onChange={(e) => updateItem(idx, "qty", e.target.value)}
                      disabled={!isEditable}
                      className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:border-orange-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-3">
                    <input
                      type="number"
                      value={item.unitPrice}
                      min="0"
                      step="0.01"
                      onChange={(e) => updateItem(idx, "unitPrice", e.target.value)}
                      disabled={!isEditable}
                      className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:border-orange-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div className="col-span-3 sm:col-span-2 flex items-center justify-end gap-2">
                    <span className="text-sm text-white text-right whitespace-nowrap">
                      {formatLKR(item.lineTotal)}
                    </span>
                    {isEditable && lineItems.length > 1 && (
                      <button
                        onClick={() => deleteRow(idx)}
                        className="text-gray-600 hover:text-red-400 flex-shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {isEditable && (
              <button
                onClick={addRow}
                className="mt-3 flex items-center gap-1.5 text-sm text-orange-400 hover:text-orange-300"
              >
                <Plus className="w-4 h-4" />
                Add Row
              </button>
            )}
          </div>

          {/* Totals */}
          <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-4">Totals</div>
            <div className="space-y-3 max-w-sm ml-auto">
              {/* Subtotal */}
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Subtotal</span>
                <span className="text-white">{formatLKR(subtotal)}</span>
              </div>

              {/* Discount */}
              <div className="flex items-center justify-between text-sm gap-3">
                <div className="flex items-center gap-2 text-gray-400">
                  <span>Discount</span>
                  {isEditable && (
                    <button
                      onClick={() => {
                        setDiscountType((t) => (t === "amount" ? "percent" : "amount"));
                        setDirty(true);
                      }}
                      className="text-xs bg-white/10 hover:bg-white/20 px-2 py-0.5 rounded text-gray-300"
                    >
                      {discountType === "amount" ? "LKR" : "%"}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {isEditable ? (
                    <input
                      type="number"
                      value={discount}
                      min="0"
                      step="0.01"
                      onChange={(e) => { setDiscount(parseFloat(e.target.value) || 0); setDirty(true); }}
                      className="w-28 bg-white/5 border border-white/10 text-white rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:border-orange-500"
                    />
                  ) : (
                    <span className="text-white">
                      {discountType === "percent" ? `${discount}%` : formatLKR(discount)}
                    </span>
                  )}
                  {discountType === "percent" && (
                    <span className="text-gray-500 text-xs">= {formatLKR(discountAmount)}</span>
                  )}
                </div>
              </div>

              {/* Tax */}
              <div className="flex items-center justify-between text-sm gap-3">
                <span className="text-gray-400">Tax (LKR)</span>
                {isEditable ? (
                  <input
                    type="number"
                    value={tax}
                    min="0"
                    step="0.01"
                    onChange={(e) => { setTax(parseFloat(e.target.value) || 0); setDirty(true); }}
                    className="w-28 bg-white/5 border border-white/10 text-white rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:border-orange-500"
                  />
                ) : (
                  <span className="text-white">{formatLKR(tax)}</span>
                )}
              </div>

              <div className="border-t border-white/10 pt-3">
                <div className="flex justify-between text-base font-bold">
                  <span className="text-white">Grand Total</span>
                  <span className="text-white">{formatLKR(grandTotal)}</span>
                </div>
              </div>

              {/* Amount Paid */}
              <div className="flex items-center justify-between text-sm gap-3">
                <span className="text-gray-400">Amount Paid</span>
                {invoice.status === "partial" && isEditable ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={paidAmount}
                      min="0"
                      max={grandTotal}
                      step="0.01"
                      onChange={(e) => setPaidAmount(parseFloat(e.target.value) || 0)}
                      className="w-28 bg-white/5 border border-white/10 text-white rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:border-orange-500"
                    />
                    <button
                      onClick={savePaidAmount}
                      disabled={saving}
                      className="text-xs bg-green-600/20 hover:bg-green-600/30 text-green-400 px-2 py-1 rounded"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <span className="text-green-400">{formatLKR(invoice.paidAmount)}</span>
                )}
              </div>

              {/* Balance Due */}
              <div className="flex justify-between text-sm font-semibold">
                <span className="text-gray-400">Balance Due</span>
                <span className={balanceDue > 0 ? "text-red-400" : "text-green-400"}>
                  {formatLKR(invoice.status === "paid" ? 0 : balanceDue)}
                </span>
              </div>
            </div>
          </div>

          {/* Action error */}
          {actionError && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-3 py-2 text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {actionError}
            </div>
          )}

          {/* Customer share link panel */}
          {viewLink && (
            <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">Customer Self-Service Link</div>
              <p className="text-xs text-gray-400 mb-2">Customer can view vehicle history, next service, oil used, services performed & download invoices without login.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs text-orange-300 bg-black/20 border border-white/10 rounded-lg px-3 py-2 break-all">{viewLink}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(viewLink)}
                  className="bg-white/10 hover:bg-white/20 text-white text-xs px-3 py-2 rounded-lg flex-shrink-0"
                >
                  Copy
                </button>
                <a
                  href={viewLink}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-white/10 hover:bg-white/20 text-white text-xs px-3 py-2 rounded-lg flex-shrink-0 flex items-center gap-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Open
                </a>
              </div>
            </div>
          )}

          {/* Save + payment actions */}
          {isEditable && (
            <div className="flex flex-col sm:flex-row gap-3 pb-4">
              {dirty && (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save Changes"}
                </button>
              )}
              {!invoice.smsSent && (
                <button
                  onClick={() => setSmsModal(true)}
                  disabled={saving || dirty}
                  title={dirty ? "Save changes first" : "Finalize invoice and send SMS with billing details"}
                  className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  Finalize & Send SMS
                </button>
              )}
              {invoice.smsSent && (
                <div className="flex-1 bg-green-600/10 border border-green-500/30 text-green-300 py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  SMS sent to customer
                </div>
              )}
              {invoice.status === "pending" && (
                <button
                  onClick={() => handleSetStatus("partial")}
                  disabled={saving}
                  className="flex-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
                >
                  Mark as Partial
                </button>
              )}
              {invoice.status !== "paid" && (
                <button
                  onClick={handleMarkPaid}
                  disabled={saving}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4 inline mr-2" />
                  {saving ? "Updating…" : t("invoices.markAsPaid")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* SMS Preview Modal */}
      {smsModal && invoice && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-[#162032] border border-white/10 rounded-xl p-6 max-w-md w-full space-y-4">
            <h3 className="font-semibold text-white">Finalize Invoice & Send SMS</h3>
            <p className="text-xs text-gray-400">The customer will receive an SMS with the invoice total, services, and a private link to view & download the invoice.</p>
            <div className="bg-white/5 rounded-lg p-3 text-sm text-gray-300 italic max-h-48 overflow-y-auto">
              "{smsPreview}"
            </div>
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>{smsPreview.length} chars</span>
              <span>{smsQuotaUsed}/{smsQuotaMax} SMS used</span>
            </div>
            {quotaExceeded && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-3 py-2 text-xs">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                Monthly SMS quota reached.
              </div>
            )}
            <div className="flex flex-col gap-2">
              <button
                onClick={handleFinalizeAndSendSms}
                disabled={quotaExceeded || smsSending}
                className="bg-[#F97316] hover:bg-[#ea6c0f] text-white py-2 rounded-lg text-sm font-medium disabled:opacity-40"
              >
                {smsSending ? "Sending…" : "Finalize & Send SMS"}
              </button>
              <button onClick={() => setSmsModal(false)} className="text-gray-400 hover:text-white text-sm py-1">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Print / PDF layout ────────────────────────────────────────────────── */}
      <div id="invoice-print" className="hidden print:block bg-white text-black">
        {/* Header */}
        <div className="flex justify-between items-start mb-8 pb-6 border-b-2 border-gray-200">
          <div className="flex items-start gap-4">
            {centerLogoUrl && (
              <img src={centerLogoUrl} alt="" style={{ width: 64, height: 64, objectFit: "contain", borderRadius: 8, border: "1px solid #e5e7eb" }} />
            )}
            <div>
              <div className="text-2xl font-extrabold text-gray-900">{centerName}</div>
              <div className="text-sm text-gray-500 mt-1">{centerAddress}</div>
              {centerPhone && <div className="text-sm text-gray-500">{centerPhone}</div>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xl font-bold text-gray-800">INVOICE</div>
            <div className="font-mono text-gray-600 mt-1">{invoice.invoiceNumber}</div>
            <div className="text-sm text-gray-500 mt-1">{formatDate(invoice.serviceDate)}</div>
            <div className={`mt-2 inline-block text-xs font-bold px-3 py-1 rounded-full ${
              invoice.status === "paid" ? "bg-green-100 text-green-700" :
              invoice.status === "partial" ? "bg-amber-100 text-amber-700" :
              "bg-gray-100 text-gray-700"
            }`}>
              {STATUS_LABEL[invoice.status]}
            </div>
          </div>
        </div>

        {/* Customer + Vehicle */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 mb-8">
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Bill To</div>
            <div className="font-semibold text-gray-900">{invoice.customerName}</div>
            <div className="text-sm text-gray-600">{invoice.customerPhone}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Vehicle</div>
            <div className="font-bold text-gray-900">{invoice.plateNumber}</div>
          </div>
        </div>

        {/* Line items table */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "24px" }}>
          <thead>
            <tr style={{ backgroundColor: "#f3f4f6", borderBottom: "2px solid #e5e7eb" }}>
              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "12px", color: "#6b7280", textTransform: "uppercase" }}>Description</th>
              <th style={{ textAlign: "right", padding: "10px 12px", fontSize: "12px", color: "#6b7280", textTransform: "uppercase" }}>Qty</th>
              <th style={{ textAlign: "right", padding: "10px 12px", fontSize: "12px", color: "#6b7280", textTransform: "uppercase" }}>Unit Price</th>
              <th style={{ textAlign: "right", padding: "10px 12px", fontSize: "12px", color: "#6b7280", textTransform: "uppercase" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((item, idx) => (
              <tr key={idx} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "10px 12px", fontSize: "14px" }}>{item.description}</td>
                <td style={{ padding: "10px 12px", fontSize: "14px", textAlign: "right" }}>{item.qty}</td>
                <td style={{ padding: "10px 12px", fontSize: "14px", textAlign: "right" }}>{formatLKR(item.unitPrice)}</td>
                <td style={{ padding: "10px 12px", fontSize: "14px", textAlign: "right", fontWeight: "600" }}>{formatLKR(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div style={{ maxWidth: "280px", marginLeft: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "14px", color: "#6b7280" }}>
            <span>Subtotal</span><span>{formatLKR(subtotal)}</span>
          </div>
          {discountAmount > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "14px", color: "#6b7280" }}>
              <span>Discount</span><span>- {formatLKR(discountAmount)}</span>
            </div>
          )}
          {tax > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "14px", color: "#6b7280" }}>
              <span>Tax</span><span>{formatLKR(tax)}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: "18px", fontWeight: "bold", borderTop: "2px solid #e5e7eb", marginTop: "4px" }}>
            <span>Grand Total</span><span>{formatLKR(grandTotal)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "14px", color: "#16a34a" }}>
            <span>Amount Paid</span><span>{formatLKR(invoice.paidAmount)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "14px", fontWeight: "600", color: invoice.status === "paid" ? "#16a34a" : "#dc2626" }}>
            <span>Balance Due</span><span>{formatLKR(invoice.status === "paid" ? 0 : invoice.balanceDue)}</span>
          </div>
        </div>

        {/* Footer */}
        <div style={{ marginTop: "48px", textAlign: "center", borderTop: "1px solid #e5e7eb", paddingTop: "20px", fontSize: "13px", color: "#9ca3af" }}>
          Thank you for your business! · {centerName} · {centerPhone}
        </div>
        <div style={{ marginTop: "12px", textAlign: "center", fontSize: "11px", color: "#cbd5e1", letterSpacing: "0.05em" }}>
          Powered by <span style={{ color: "#F97316", fontWeight: 700 }}>PitStop IQ</span>
          {" "}· A product of <span style={{ fontWeight: 500 }}>Lumora Ventures PVT LTD</span>
        </div>
      </div>
    </>
  );
}
