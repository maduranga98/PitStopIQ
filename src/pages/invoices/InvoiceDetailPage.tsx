import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import {
  doc, onSnapshot, serverTimestamp, getDoc,
  collection, Timestamp,
} from "firebase/firestore";
import { safeUpdateDoc, safeAddDoc } from "../../lib/firestoreWrite";
import {
  ArrowLeft, Plus, X, Printer, MessageCircle, Send,
  AlertTriangle, CheckCircle2, Lock, ExternalLink,
  Wallet, Banknote, CreditCard, Landmark, FileText, Clock, Trash2,
} from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import type {
  Invoice, InvoiceLineItem, InvoiceStatus, DiscountType, ServiceCenter,
  InvoicePayment, InvoicePaymentMethod, PaymentClearance,
} from "../../types/auth";
import {
  INVOICE_PAYMENT_METHODS, PAYMENT_METHOD_LABEL, dateInputToTimestamp,
  isConfirmed, isReturned, needsConfirmation, newInvoicePaymentId, recordInvoicePayment,
  removeInvoicePayment, repricedPaymentFields, round2, setInvoicePaymentClearance,
  settleInvoiceInFull, summariseInvoicePayments, todayInputValue,
} from "../../lib/invoicePayments";
import { useTranslation } from "react-i18next";
import {
  resolveCompletionTemplate,
  buildViewLink,
  smsQuotaLimit,
  getCompletionTemplate,
  analyzeSms,
  type SmsLang,
} from "../../lib/smsTemplates";
import { getOrCreateShortLink, smsShortLink, fullShortLink, SAMPLE_SHORT_CODE } from "../../lib/shortLinks";
import { LoadingScreen } from "../../components/LoadingProgress";
import { logAuditEvent } from "../../lib/auditLog";
import { buildInvoicePrintCss, PRINT_CLASS } from "../../lib/printPaper";
import { useInvoicePrintPaper } from "../../hooks/useInvoicePrintPaper";
import PrintPaperPicker from "../../components/invoices/PrintPaperPicker";
import { usePaperOverride } from "../../hooks/usePaperOverride";

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

// ── Payments ──────────────────────────────────────────────────────────────────
// A workshop is rarely paid in one clean transfer: half in cash at the counter,
// a post-dated cheque for the rest, and the regulars run a tab. So an invoice
// carries a ledger of entries, and every total on the page comes off it.

const METHOD_ICON: Record<InvoicePaymentMethod, typeof Banknote> = {
  cash:          Banknote,
  card:          CreditCard,
  bank_transfer: Landmark,
  cheque:        FileText,
  credit:        Clock,
};

const METHOD_TONE: Record<InvoicePaymentMethod, string> = {
  cash:          "text-green-400",
  card:          "text-cyan-400",
  bank_transfer: "text-violet-400",
  cheque:        "text-blue-400",
  credit:        "text-amber-400",
};

function RecordPaymentModal({
  invoice,
  centerId,
  actorName,
  actorUid,
  onClose,
}: {
  invoice: Invoice;
  centerId: string;
  actorName: string;
  actorUid: string;
  onClose: () => void;
}) {
  const summary = summariseInvoicePayments(invoice.payments, invoice.grandTotal);

  const [method, setMethod] = useState<InvoicePaymentMethod>("cash");
  const [amount, setAmount] = useState(summary.balanceDue > 0 ? String(summary.balanceDue) : "");
  const [date, setDate] = useState(todayInputValue());
  const [note, setNote] = useState("");
  const [chequeNumber, setChequeNumber] = useState("");
  const [bank, setBank] = useState("");
  const [branch, setBranch] = useState("");
  const [chequeDate, setChequeDate] = useState(todayInputValue());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    const value = parseFloat(amount);
    if (!amount || isNaN(value) || value <= 0) {
      setError("Enter a positive amount.");
      return;
    }
    if (method === "cheque") {
      if (!chequeNumber.trim()) { setError("Cheque number is required."); return; }
      if (!bank.trim()) { setError("Bank is required."); return; }
      if (!branch.trim()) { setError("Branch is required."); return; }
      if (!chequeDate) { setError("Cheque date is required."); return; }
    }
    if (!date) { setError("Date is required."); return; }

    setSaving(true);
    setError("");
    try {
      const payment: InvoicePayment = {
        id: newInvoicePaymentId(),
        method,
        amount: round2(value),
        date: dateInputToTimestamp(date),
        recordedBy: actorUid,
        recordedByName: actorName,
        recordedAt: Timestamp.now(),
        // A cheque still has to clear and a credit still has to be collected,
        // so both start pending and wait for an Owner or Manager to confirm.
        ...(needsConfirmation(method) ? { clearance: "pending" as const } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(method === "cheque"
          ? {
              chequeNumber: chequeNumber.trim(),
              bank: bank.trim(),
              branch: branch.trim(),
              chequeDate: dateInputToTimestamp(chequeDate),
            }
          : {}),
      };
      await recordInvoicePayment(centerId, invoice, payment);
      onClose();
    } catch {
      setError("Could not save the payment. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const fieldClass =
    "w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:hidden">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Record Payment</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="bg-[#0B1120] rounded-xl p-4 mb-5 border border-white/5">
          <p className="text-sm font-semibold text-white">{invoice.invoiceNumber}</p>
          <p className="text-xs text-gray-400 mt-0.5">{invoice.customerName} · {invoice.plateNumber}</p>
          <div className="flex items-center justify-between text-xs mt-2">
            <span className="text-gray-500">Invoice total</span>
            <span className="text-white">{formatLKR(invoice.grandTotal)}</span>
          </div>
          <div className="flex items-center justify-between text-xs mt-1">
            <span className="text-gray-500">Balance due</span>
            <span className={summary.balanceDue > 0 ? "text-amber-400 font-medium" : "text-green-400 font-medium"}>
              {formatLKR(summary.balanceDue)}
            </span>
          </div>
        </div>

        <div className="space-y-4">
          {/* Payment type — one entry per type, so a customer paying half cash
              and half by cheque is simply two entries. */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Payment type</label>
            <div className="grid grid-cols-3 gap-2">
              {INVOICE_PAYMENT_METHODS.map(m => {
                const Icon = METHOD_ICON[m];
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { setMethod(m); setError(""); }}
                    className={`flex flex-col items-center gap-1 py-2.5 rounded-lg border text-xs font-medium transition ${
                      method === m
                        ? "bg-[#F97316]/20 text-[#F97316] border-[#F97316]/40"
                        : "bg-[#0B1120] text-gray-400 border-white/10 hover:border-white/20"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {PAYMENT_METHOD_LABEL[m]}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-600 mt-1.5">
              {method === "credit"
                ? "Records what the customer is taking on credit. It stays in the balance due until it's settled."
                : "Add one entry per payment — mix cash, cards, cheques and credit freely."}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              {method === "cheque" ? "Cheque value (LKR)" : "Amount (LKR)"} <span className="text-red-400">*</span>
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={e => { setAmount(e.target.value); setError(""); }}
              placeholder="0.00"
              className={fieldClass}
            />
          </div>

          {method === "cheque" && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Cheque number <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={chequeNumber}
                  onChange={e => { setChequeNumber(e.target.value); setError(""); }}
                  placeholder="e.g. 004215"
                  className={fieldClass}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    Bank <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={bank}
                    onChange={e => { setBank(e.target.value); setError(""); }}
                    placeholder="e.g. Commercial Bank"
                    className={fieldClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    Branch <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={branch}
                    onChange={e => { setBranch(e.target.value); setError(""); }}
                    placeholder="e.g. Kandy"
                    className={fieldClass}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Cheque date <span className="text-red-400">*</span>
                </label>
                <input
                  type="date"
                  value={chequeDate}
                  onChange={e => { setChequeDate(e.target.value); setError(""); }}
                  className={fieldClass}
                />
                <p className="text-xs text-gray-600 mt-1">The date written on the cheque.</p>
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              {method === "credit" ? "Date agreed" : "Date received"} <span className="text-red-400">*</span>
            </label>
            <input
              type="date"
              value={date}
              onChange={e => { setDate(e.target.value); setError(""); }}
              className={fieldClass}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Note <span className="text-gray-600 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Balance to be settled on delivery"
              className={fieldClass}
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
            </p>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm flex items-center justify-center gap-2"
          >
            <Wallet className="h-4 w-4" />
            {saving ? "Saving…" : "Record Payment"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function InvoiceDetailPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const canEditInvoice    = usePermission("invoices.edit");
  const canApplyDiscount  = usePermission("invoices.applyDiscount");
  const canMarkPayment    = usePermission("invoices.markPayment");
  const canDownloadPdf    = usePermission("invoices.downloadPdf");
  const canShareWhatsapp  = usePermission("invoices.shareWhatsapp");
  // A cashier takes the cheque; confirming that it cleared — or that a tab was
  // finally collected — is the office's call, so it stays with Owner/Manager.
  const canConfirmPayment = currentUser?.role === "Owner" || currentUser?.role === "Manager";

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [centerName, setCenterName] = useState("");
  const [centerAddress, setCenterAddress] = useState("");
  const [centerPhone, setCenterPhone] = useState("");
  const [centerLogoUrl, setCenterLogoUrl] = useState("");
  const [centerData, setCenterData] = useState<Record<string, unknown> | null>(null);
  const [center, setCenter] = useState<ServiceCenter | null>(null);
  const [customerLang, setCustomerLang] = useState<SmsLang>("english");
  const [smsQuotaUsed, setSmsQuotaUsed] = useState(0);
  const [smsQuotaMax, setSmsQuotaMax] = useState(200);
  const [smsModal, setSmsModal] = useState(false);
  const [smsSending, setSmsSending] = useState(false);
  const [shortCode, setShortCode] = useState<string | null>(null);
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
  const [paymentModal, setPaymentModal] = useState(false);
  const [removingPayment, setRemovingPayment] = useState<string | null>(null);
  const [confirmingPayment, setConfirmingPayment] = useState<string | null>(null);

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

  // Mint (or reuse) a short link for this customer so the SMS carries a tiny URL
  // instead of the ~70-char /c/{id}/{id} link. Falls back to the long link if
  // minting fails. Reused thereafter via the code cached on the customer doc.
  useEffect(() => {
    if (!currentUser?.centerId || !invoice?.customerId) return;
    getOrCreateShortLink(currentUser.centerId, invoice.customerId)
      .then(setShortCode)
      .catch(() => setShortCode(null));
  }, [currentUser?.centerId, invoice?.customerId]);

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
        setCenter(d);
        const used = d.smsQuotaUsed ?? 0;
        const limit = d.smsQuotaLimit ?? smsQuotaLimit(d.plan ?? "basic");
        setSmsQuotaUsed(used);
        setSmsQuotaMax(limit);
      }
    });
  }, [currentUser?.centerId]);

  // Paper the center prints invoices on (A4 sheet, 76mm roll, …), unless this
  // print was pointed at another size with the picker. The hook also owns the
  // @page rule, remeasuring a roll's length before each print.
  const [paperOverride, setPaperOverride] = usePaperOverride();
  const paper = useInvoicePrintPaper(center, "invoice-print", paperOverride);

  // Load linked job for service details (used in SMS body)
  useEffect(() => {
    if (!invoice?.serviceId || !currentUser?.centerId) return;
    getDoc(doc(db, "servicecenters", currentUser.centerId, "jobs", invoice.serviceId!)).then((snap) => {
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

  const canViewDetail = usePermission("invoices.viewDetail");

  if (!loading && !canViewDetail) {
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
  // Discounts are their own permission — a role may edit an invoice's lines
  // without being allowed to discount it.
  const canEditDiscount = isEditable && canApplyDiscount;

  // Computed totals
  const { subtotal, discountAmount, grandTotal } = calcTotals(lineItems, discount, discountType, tax);

  // Once anything is on the payment ledger it decides what's been paid; the
  // manual "amount paid" box only applies to invoices settled before the ledger
  // existed (or ones nobody has recorded a payment against yet).
  const payments = invoice?.payments ?? [];
  const hasPayments = payments.length > 0;
  const paymentSummary = summariseInvoicePayments(payments, grandTotal);
  const effectivePaid = hasPayments ? paymentSummary.received : paidAmount;
  const balanceDue = Math.max(0, grandTotal - effectivePaid);

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
        // Editing the lines changes what's owed, so the ledger's totals are
        // re-derived against the new grand total in the same write.
        ...(hasPayments
          ? repricedPaymentFields(invoice, grandTotal)
          : { paidAmount, balanceDue }),
        updatedAt: serverTimestamp(),
      };
      await safeUpdateDoc(doc(db, "servicecenters", currentUser.centerId, "invoices", invoice.id), updates);
      if (grandTotal !== invoice.grandTotal) {
        void logAuditEvent({
          centerId: currentUser.centerId,
          action: "invoice_change",
          entityType: "invoice",
          entityId: invoice.id,
          entityLabel: invoice.invoiceNumber,
          changes: [{ field: "grandTotal", before: invoice.grandTotal, after: grandTotal }],
          performedBy: currentUser.uid,
          performedByName: currentUser.displayName || currentUser.email || "Unknown",
        });
      }
      setDirty(false);
    } catch {
      setActionError("Failed to save invoice.");
    }
    setSaving(false);
  }

  // ── Payment status ────────────────────────────────────────────────────────

  // Settling the invoice in one go. Once the ledger is in use this can't just
  // flip the status — that would leave "paid" sitting above entries adding up
  // to less — so it books the outstanding balance as a cash payment instead.
  async function handleMarkPaid() {
    if (!invoice || !currentUser?.centerId) return;
    setSaving(true);
    setActionError("");
    try {
      if (hasPayments) {
        await settleInvoiceInFull(currentUser.centerId, invoice, {
          uid: currentUser.uid,
          name: currentUser.displayName ?? currentUser.email ?? "Staff",
        });
      } else {
        await safeUpdateDoc(doc(db, "servicecenters", currentUser.centerId, "invoices", invoice.id), {
          status: "paid",
          paidAmount: grandTotal,
          balanceDue: 0,
          paidAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch {
      setActionError("Failed to mark as paid.");
    }
    setSaving(false);
  }

  // Confirming a cheque records that it cleared; confirming a credit records
  // that the customer settled the tab, which is the moment it becomes money.
  // Returning one is the opposite — a bounced cheque stops counting and the
  // balance reopens.
  async function handleConfirmPayment(paymentId: string, state: PaymentClearance) {
    if (!invoice || !currentUser?.centerId) return;
    setConfirmingPayment(paymentId);
    setActionError("");
    try {
      await setInvoicePaymentClearance(currentUser.centerId, invoice, paymentId, state, {
        uid: currentUser.uid,
        name: currentUser.displayName ?? currentUser.email ?? "Staff",
      });
    } catch {
      setActionError("Failed to update the payment.");
    }
    setConfirmingPayment(null);
  }

  async function handleRemovePayment(paymentId: string) {
    if (!invoice || !currentUser?.centerId) return;
    setRemovingPayment(paymentId);
    setActionError("");
    try {
      await removeInvoicePayment(currentUser.centerId, invoice, paymentId);
      void logAuditEvent({
        centerId: currentUser.centerId,
        action: "delete",
        entityType: "invoice",
        entityId: invoice.id,
        entityLabel: invoice.invoiceNumber,
        note: "Removed a payment entry",
        performedBy: currentUser.uid,
        performedByName: currentUser.displayName || currentUser.email || "Unknown",
      });
    } catch {
      setActionError("Failed to remove the payment.");
    }
    setRemovingPayment(null);
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
        updates.paidAt = serverTimestamp();
      } else if (status === "pending") {
        updates.paidAmount = 0;
        updates.balanceDue = grandTotal;
      }
      await safeUpdateDoc(doc(db, "servicecenters", currentUser.centerId, "invoices", invoice.id), updates);
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
      await safeUpdateDoc(doc(db, "servicecenters", currentUser.centerId, "invoices", invoice.id), {
        paidAmount,
        balanceDue: Math.max(0, grandTotal - paidAmount),
        ...(paidAmount > 0 ? { paidAt: serverTimestamp() } : {}),
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

  // Clickable link (with scheme) for the share panel / WhatsApp / browser.
  const viewLink = invoice && currentUser?.centerId
    ? (shortCode ? fullShortLink(shortCode) : buildViewLink(currentUser.centerId, invoice.customerId))
    : "";

  const servicesList = job
    ? [...(job.services ?? []), ...(job.customServices ?? [])].join(", ") || "Service"
    : "Service";

  const completionTemplate = getCompletionTemplate(centerData, customerLang);

  // Fields shared by preview and the actually-sent message; only the link differs.
  const completionFields = invoice ? {
    customerName: invoice.customerName,
    plate: invoice.plateNumber,
    centerName,
    centerPhone,
    servicesList,
    mileageOut: String(job?.mileageOut ?? ""),
    nextServiceMileage: String(job?.nextServiceMileageKm ?? ""),
    invoiceNumber: invoice.invoiceNumber,
    invoiceTotal: invoice.grandTotal.toLocaleString("en-LK", { minimumFractionDigits: 2 }),
  } : null;

  // Scheme-less short link goes in the SMS body. Before a code is minted we use a
  // same-length placeholder so the segment/credit estimate stays accurate.
  const smsBodyLink = smsShortLink(shortCode ?? SAMPLE_SHORT_CODE);
  const smsPreview = completionFields
    ? resolveCompletionTemplate(completionTemplate, { ...completionFields, viewLink: smsBodyLink })
    : "";

  const quotaExceeded = smsQuotaUsed >= smsQuotaMax;
  const smsInfo = analyzeSms(smsPreview);

  async function handleFinalizeAndSendSms() {
    if (!invoice || !currentUser?.centerId) return;
    setSmsSending(true);
    setActionError("");
    try {
      // Make sure the sent SMS carries a real short code, not the preview
      // placeholder. If minting fails, fall back to the full long link.
      let code = shortCode;
      if (!code) {
        code = await getOrCreateShortLink(currentUser.centerId, invoice.customerId).catch(() => null);
        if (code) setShortCode(code);
      }
      const bodyLink = code ? smsShortLink(code) : buildViewLink(currentUser.centerId, invoice.customerId);
      const message = completionFields
        ? resolveCompletionTemplate(completionTemplate, { ...completionFields, viewLink: bodyLink })
        : smsPreview;

      await safeAddDoc(collection(db, "servicecenters", currentUser.centerId, "smsLogs"), {
        customerId: invoice.customerId,
        customerName: invoice.customerName,
        phone: invoice.customerPhone,
        vehicleId: invoice.vehicleId,
        plateNumber: invoice.plateNumber,
        invoiceId: invoice.id,
        jobId: invoice.serviceId,
        messageType: "Completion",
        status: "sent",
        message,
        sentAt: Timestamp.now(),
      });
      // Quota is incremented by the Cloud Function on successful delivery — do not double-count here.
      await safeUpdateDoc(doc(db, "servicecenters", currentUser.centerId, "invoices", invoice.id), {
        finalized: true,
        finalizedAt: serverTimestamp(),
        smsSent: true,
        updatedAt: serverTimestamp(),
      });
      // Mark linked job as having SMS sent
      if (invoice.serviceId) {
        await safeUpdateDoc(doc(db, "servicecenters", currentUser.centerId, "jobs", invoice.serviceId), {
          smsSent: true,
          updatedAt: serverTimestamp(),
        });
      }
      setSmsModal(false);
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
    const link = viewLink || buildViewLink(currentUser!.centerId!, invoice.customerId);
    const msg = encodeURIComponent(
      `Dear ${invoice.customerName}, your invoice ${invoice.invoiceNumber} for vehicle ${invoice.plateNumber} is ready. Total: ${formatLKR(invoice.grandTotal)}. View & download: ${link} — ${centerPhone}`,
    );
    window.open(`https://wa.me/${number}?text=${msg}`, "_blank");
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <LoadingScreen />
    );
  }
  if (!invoice) return null;

  return (
    <>
      {/* Print styles — driven by the paper configured in Settings → Invoice Printing */}
      <style>{buildInvoicePrintCss(paper)}</style>

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
            <div className="flex items-start gap-2">
              {canDownloadPdf && (
                <PrintPaperPicker
                  center={center}
                  value={paperOverride}
                  onChange={setPaperOverride}
                  paper={paper}
                />
              )}
              {canDownloadPdf && (
                <button
                  onClick={handlePrint}
                  className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg text-sm"
                >
                  <Printer className="w-4 h-4" />
                  <span className="hidden sm:inline">Print / PDF</span>
                </button>
              )}
              {canShareWhatsapp && (
                <button
                  onClick={handleWhatsApp}
                  className="flex items-center gap-2 bg-green-600/20 hover:bg-green-600/30 text-green-400 px-3 py-1.5 rounded-lg text-sm"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span className="hidden sm:inline">WhatsApp</span>
                </button>
              )}
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
              {invoice.serviceId && (
                <Link to={`/services/${invoice.serviceId}`} className="text-xs text-orange-400 hover:text-orange-300 mt-1 inline-block">
                  View Job Card →
                </Link>
              )}
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
                  {canEditDiscount && (
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
                  {canEditDiscount ? (
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
                {hasPayments ? (
                  <span className="text-green-400">
                    {formatLKR(paymentSummary.received)}
                    <span className="text-gray-600 text-xs ml-1.5">from recorded payments</span>
                  </span>
                ) : invoice.status === "partial" && isEditable ? (
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
                  {formatLKR(invoice.status === "paid" && !hasPayments ? 0 : balanceDue)}
                </span>
              </div>
            </div>
          </div>

          {/* Payments — how the customer settled: cash at the counter, a card,
              a transfer, a cheque (with its number, bank, branch and date), or
              the part they're taking on credit. */}
          <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Payments</div>
              {canMarkPayment && (
                <button
                  onClick={() => setPaymentModal(true)}
                  disabled={dirty}
                  // Unsaved line edits would make the balance in the modal a lie.
                  title={dirty ? "Save your changes first" : "Record how the customer paid"}
                  className="flex items-center gap-1.5 text-xs font-medium bg-[#F97316]/10 hover:bg-[#F97316]/20 disabled:opacity-40 text-[#F97316] border border-[#F97316]/20 px-3 py-1.5 rounded-lg transition"
                >
                  <Plus className="h-3.5 w-3.5" /> Record Payment
                </button>
              )}
            </div>

            {/* Mixed settlements are the norm, so every bucket is always shown. */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              {([
                ["Cash", paymentSummary.byMethod.cash, "text-green-400"],
                ["Card & transfers", round2(paymentSummary.byMethod.card + paymentSummary.byMethod.bank_transfer), "text-cyan-400"],
                ["Cheques", paymentSummary.byMethod.cheque, "text-blue-400"],
                ["Credit outstanding", paymentSummary.credit, "text-amber-400"],
              ] as const).map(([label, value, tone]) => (
                <div key={label} className="bg-[#0B1120] border border-white/5 rounded-lg px-3 py-2">
                  <div className="text-xs text-gray-500">{label}</div>
                  <div className={`text-sm font-semibold mt-0.5 ${tone}`}>{formatLKR(value)}</div>
                </div>
              ))}
            </div>

            {!hasPayments ? (
              <p className="text-xs text-gray-600">
                {canMarkPayment
                  ? "Nothing recorded yet. Record cash, a card payment, a cheque, or the part taken on credit as it comes in."
                  : "No payments recorded against this invoice yet."}
              </p>
            ) : (
              <div className="space-y-1.5">
                {payments.map((p) => {
                  const Icon = METHOD_ICON[p.method];
                  const returned = isReturned(p);
                  const awaiting = needsConfirmation(p.method) && !isConfirmed(p) && !returned;
                  const confirmed = needsConfirmation(p.method) && isConfirmed(p);
                  return (
                    <div
                      key={p.id}
                      className={`bg-[#0B1120] border rounded-lg px-3 py-2 flex items-start justify-between gap-3 ${
                        returned ? "border-red-500/25" : awaiting ? "border-amber-500/25" : "border-white/5"
                      }`}
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <Icon className={`h-4 w-4 flex-shrink-0 mt-0.5 ${METHOD_TONE[p.method]}`} />
                        <div className="min-w-0">
                          <div className="text-sm text-white flex items-center gap-2 flex-wrap">
                            <span>
                              {PAYMENT_METHOD_LABEL[p.method]}
                              <span className="text-gray-500 font-normal"> · {formatDate(p.date)}</span>
                            </span>
                            {awaiting && (
                              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
                                {p.method === "cheque" ? "Not yet cleared" : "Not yet collected"}
                              </span>
                            )}
                            {confirmed && (
                              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/30">
                                {p.method === "cheque" ? "Cleared" : "Collected"}
                              </span>
                            )}
                            {returned && (
                              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30">
                                {p.method === "cheque" ? "Returned" : "Written back"}
                              </span>
                            )}
                          </div>
                          {p.method === "cheque" && (
                            <div className="text-xs text-gray-500 mt-0.5">
                              No. {p.chequeNumber} · {p.bank}
                              {p.branch ? `, ${p.branch}` : ""}
                              {p.chequeDate ? ` · dated ${formatDate(p.chequeDate)}` : ""}
                            </div>
                          )}
                          {p.note && <div className="text-xs text-gray-400 mt-0.5">{p.note}</div>}
                          <div className="text-xs text-gray-600 mt-0.5">
                            Recorded by {p.recordedByName}
                            {confirmed && p.clearedByName ? ` · confirmed by ${p.clearedByName}` : ""}
                            {returned && p.returnedByName ? ` · returned by ${p.returnedByName}` : ""}
                            {returned && p.returnReason ? ` · ${p.returnReason}` : ""}
                          </div>
                          {/* Confirming a credit is the moment it becomes money,
                              so say so before it's clicked. */}
                          <div className="flex items-center gap-3 flex-wrap">
                            {canConfirmPayment && awaiting && (
                              <button
                                onClick={() => handleConfirmPayment(p.id, "cleared")}
                                disabled={confirmingPayment === p.id}
                                className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium bg-green-600/15 hover:bg-green-600/25 text-green-300 border border-green-500/30 px-2.5 py-1 rounded-lg transition disabled:opacity-40"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                {p.method === "cheque" ? "Confirm cleared" : "Confirm collected"}
                              </button>
                            )}
                            {/* A bounced cheque isn't deleted — it stays on the
                                ledger as a returned entry, and the balance it
                                had covered reopens. */}
                            {canConfirmPayment && !returned && needsConfirmation(p.method) && (
                              <button
                                onClick={() => handleConfirmPayment(p.id, "returned")}
                                disabled={confirmingPayment === p.id}
                                className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-red-400/90 hover:text-red-300 transition disabled:opacity-40"
                              >
                                {p.method === "cheque" ? "Mark returned" : "Write back"}
                              </button>
                            )}
                            {canConfirmPayment && (confirmed || returned) && (
                              <button
                                onClick={() => handleConfirmPayment(p.id, "pending")}
                                disabled={confirmingPayment === p.id}
                                className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition disabled:opacity-40"
                              >
                                {returned ? "Reopen as pending" : "Undo confirmation"}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-sm font-medium text-white">{formatLKR(p.amount)}</span>
                        {canMarkPayment && (
                          <button
                            onClick={() => handleRemovePayment(p.id)}
                            disabled={removingPayment === p.id}
                            title="Remove this entry"
                            className="p-1 text-gray-600 hover:text-red-400 transition disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {paymentSummary.credit > 0 && (
                  <p className="text-xs text-amber-400/80 pt-1">
                    {formatLKR(paymentSummary.credit)} on credit — still in the balance due until an Owner or Manager
                    confirms it was collected.
                  </p>
                )}
                {paymentSummary.unclearedCheques > 0 && (
                  <p className="text-xs text-blue-400/80 pt-1">
                    {formatLKR(paymentSummary.unclearedCheques)} in cheques waiting to clear. They already count as
                    paid — remove the entry if one bounces.
                  </p>
                )}
              </div>
            )}
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
              {canMarkPayment && invoice.status === "pending" && !hasPayments && (
                <button
                  onClick={() => handleSetStatus("partial")}
                  disabled={saving}
                  className="flex-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
                >
                  Mark as Partial
                </button>
              )}
              {canMarkPayment && invoice.status !== "paid" && (
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

      {/* Record Payment Modal */}
      {paymentModal && invoice && currentUser?.centerId && (
        <RecordPaymentModal
          invoice={invoice}
          centerId={currentUser.centerId}
          actorName={currentUser.displayName ?? currentUser.email ?? "Staff"}
          actorUid={currentUser.uid}
          onClose={() => setPaymentModal(false)}
        />
      )}

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
              <span className={smsInfo.segments >= 3 ? "text-red-400" : smsInfo.segments > 1 ? "text-amber-400" : ""}>
                {smsInfo.units}/{smsInfo.singleMax} chars · {smsInfo.encoding === "unicode" ? "Unicode" : "GSM-7"} ·{" "}
                {smsInfo.segments} SMS credit{smsInfo.segments !== 1 ? "s" : ""}
              </span>
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
        <div className={`${PRINT_CLASS.header} flex justify-between items-start mb-8 pb-6 border-b-2 border-gray-200`}>
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
        <div className={`${PRINT_CLASS.parties} grid grid-cols-1 sm:grid-cols-2 gap-8 mb-8`}>
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
        <div className={PRINT_CLASS.totals} style={{ maxWidth: "280px", marginLeft: "auto" }}>
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

        {/* How it was settled. A cheque's details belong on the customer's copy
            as much as on ours — it's the receipt for a payment that hasn't
            cleared yet. */}
        {hasPayments && (
          <div style={{ marginTop: "24px" }}>
            <div style={{ fontSize: "12px", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
              Payments
            </div>
            {payments.map((p) => (
              <div
                key={p.id}
                style={{ display: "flex", justifyContent: "space-between", gap: "16px", padding: "4px 0", fontSize: "13px", color: "#374151" }}
              >
                <span>
                  {PAYMENT_METHOD_LABEL[p.method]} · {formatDate(p.date)}
                  {p.method === "cheque" && (
                    <> — No. {p.chequeNumber}, {p.bank}{p.branch ? `, ${p.branch}` : ""}
                      {p.chequeDate ? `, dated ${formatDate(p.chequeDate)}` : ""}</>
                  )}
                  {needsConfirmation(p.method) && (
                    <> · {isConfirmed(p)
                      ? (p.method === "cheque" ? "cleared" : "collected")
                      : (p.method === "cheque" ? "not yet cleared" : "not yet collected")}</>
                  )}
                </span>
                <span style={{ whiteSpace: "nowrap" }}>{formatLKR(p.amount)}</span>
              </div>
            ))}
            {paymentSummary.credit > 0 && (
              <div style={{ fontSize: "12px", color: "#b45309", marginTop: "6px" }}>
                {formatLKR(paymentSummary.credit)} on credit — outstanding.
              </div>
            )}
            {paymentSummary.unclearedCheques > 0 && (
              <div style={{ fontSize: "12px", color: "#1d4ed8", marginTop: "4px" }}>
                {formatLKR(paymentSummary.unclearedCheques)} in cheques awaiting clearance.
              </div>
            )}
          </div>
        )}

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
