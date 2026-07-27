import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc, onSnapshot, orderBy, query, Timestamp } from "firebase/firestore";
import {
  ClipboardList, Truck, AlertTriangle, Check, X, Package, Phone, ChevronDown, ChevronUp,
  Wallet, Banknote, FileText, Clock, Plus, Trash2,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { safeUpdateDoc } from "../../lib/firestoreWrite";
import { LoadingBlock } from "../../components/LoadingProgress";
import type {
  DistributorOrder, DistributorOrderItem, DistributorOrderStatus, DistributorPayment,
  DistributorPaymentMethod, InventoryItem,
} from "../../types/auth";
import {
  checkStock, newPaymentId, orderTotal, recordPayment, releasableItems, releaseOrder,
  isPaymentConfirmed, isPaymentReturned, needsConfirmation,
  removePayment, round2, summarisePayments,
} from "../../lib/distributors";

const STATUS_CHIP: Record<DistributorOrderStatus, string> = {
  submitted: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  finalized: "bg-green-500/15 text-green-400 border-green-500/30",
  rejected:  "bg-red-500/15 text-red-400 border-red-500/30",
  cancelled: "bg-gray-500/15 text-gray-400 border-gray-500/30",
};

const STATUS_LABEL: Record<DistributorOrderStatus, string> = {
  submitted: "Awaiting review",
  finalized: "Released",
  rejected:  "Rejected",
  cancelled: "Cancelled",
};

function formatLKR(n: number): string {
  return `LKR ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(ts?: Timestamp | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(ts?: Timestamp | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ── Payments ──────────────────────────────────────────────────────────────────

const METHOD_LABEL: Record<DistributorPaymentMethod, string> = {
  cash:   "Cash",
  cheque: "Cheque",
  credit: "Credit",
};

const METHOD_ICON: Record<DistributorPaymentMethod, typeof Banknote> = {
  cash:   Banknote,
  cheque: FileText,
  credit: Clock,
};

const METHOD_TONE: Record<DistributorPaymentMethod, string> = {
  cash:   "text-green-400",
  cheque: "text-blue-400",
  credit: "text-amber-400",
};

/** Local date input (yyyy-mm-dd) → Timestamp, read as local midnight. */
function dateInputToTimestamp(value: string): Timestamp {
  const [y, m, d] = value.split("-").map(Number);
  return Timestamp.fromDate(new Date(y, (m || 1) - 1, d || 1));
}

function todayInputValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function RecordPaymentModal({
  order,
  centerId,
  actorName,
  actorUid,
  onClose,
}: {
  order: DistributorOrder;
  centerId: string;
  actorName: string;
  actorUid: string;
  onClose: () => void;
}) {
  const summary = summarisePayments(order.payments, order.total);

  const [method, setMethod] = useState<DistributorPaymentMethod>("cash");
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
      const payment: DistributorPayment = {
        id: newPaymentId(),
        method,
        amount: round2(value),
        date: dateInputToTimestamp(date),
        recordedBy: actorUid,
        recordedByName: actorName,
        recordedAt: Timestamp.now(),
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
      await recordPayment(centerId, order, payment);
      onClose();
    } catch {
      setError("Could not save the payment. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Record Payment</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="bg-[#0B1120] rounded-xl p-4 mb-5 border border-white/5">
          <p className="text-sm font-semibold text-white">{order.orderNumber}</p>
          <p className="text-xs text-gray-400 mt-0.5">{order.distributorName}</p>
          <div className="flex items-center justify-between text-xs mt-2">
            <span className="text-gray-500">Order total</span>
            <span className="text-white">{formatLKR(order.total)}</span>
          </div>
          <div className="flex items-center justify-between text-xs mt-1">
            <span className="text-gray-500">Balance due</span>
            <span className={summary.balanceDue > 0 ? "text-amber-400 font-medium" : "text-green-400 font-medium"}>
              {formatLKR(summary.balanceDue)}
            </span>
          </div>
        </div>

        <div className="space-y-4">
          {/* Method — one entry per method, so a mixed settlement is just
              several entries against the same order. */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Payment type</label>
            <div className="grid grid-cols-3 gap-2">
              {(["cash", "cheque", "credit"] as DistributorPaymentMethod[]).map(m => {
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
                    {METHOD_LABEL[m]}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-600 mt-1.5">
              {method === "credit"
                ? "Records the part taken on credit. It stays in the balance due until it's paid."
                : "Add one entry per payment — mix cash, cheques and credit freely."}
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
              className={inputClass}
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
                  className={inputClass}
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
                    className={inputClass}
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
                    className={inputClass}
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
                  className={inputClass}
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
              className={inputClass}
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
              placeholder="e.g. Settled at the counter"
              className={inputClass}
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

// ── Review card ───────────────────────────────────────────────────────────────
// A submitted order is editable: the owner trims quantities to what they can
// actually spare (0 drops the line), then finalizes — which is the moment stock
// actually leaves the store room.

function OrderCard({
  order,
  stock,
  centerId,
  canFinalize,
  canRecordPayments,
  actorName,
  actorUid,
}: {
  order: DistributorOrder;
  stock: Map<string, InventoryItem>;
  centerId: string;
  canFinalize: boolean;
  canRecordPayments: boolean;
  actorName: string;
  actorUid: string;
}) {
  const editable = order.status === "submitted" && canFinalize;

  // Quantity edits live alongside the document rather than replacing it: null
  // means "no local edits yet". When the order document itself changes (another
  // device finalizing it, or the distributor amending before review), the edits
  // are dropped so the card never shows stale numbers.
  const [edited, setEdited] = useState<DistributorOrderItem[] | null>(null);
  const [baseline, setBaseline] = useState(order.items);
  if (baseline !== order.items) {
    setBaseline(order.items);
    setEdited(null);
  }
  const lines = edited ?? order.items;

  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(order.status === "submitted");
  const [confirmReject, setConfirmReject] = useState(false);
  const [paymentModal, setPaymentModal] = useState(false);
  const [removingPayment, setRemovingPayment] = useState<string | null>(null);

  const payments = useMemo(() => order.payments ?? [], [order.payments]);
  const paymentSummary = useMemo(
    () => summarisePayments(payments, order.total),
    [payments, order.total],
  );
  // A rejected or cancelled order never gets settled, and money can arrive
  // any time after the order exists — including before it's finalized.
  const payable = order.status === "submitted" || order.status === "finalized";

  async function handleRemovePayment(paymentId: string) {
    setRemovingPayment(paymentId);
    setError("");
    try {
      await removePayment(centerId, order, paymentId);
    } catch {
      setError("Could not remove the payment. Please try again.");
    } finally {
      setRemovingPayment(null);
    }
  }

  const total = useMemo(() => orderTotal(releasableItems(lines)), [lines]);
  const requestedTotal = useMemo(
    () => round2(order.items.reduce((sum, i) => sum + i.requestedQty * i.unitPrice, 0)),
    [order.items],
  );

  function setApproved(itemId: string, value: string) {
    const parsed = value === "" ? 0 : parseFloat(value);
    setEdited(lines.map(l => {
      if (l.itemId !== itemId) return l;
      const qty = isNaN(parsed) || parsed < 0 ? 0 : round2(parsed);
      return { ...l, approvedQty: qty, lineTotal: round2(qty * l.unitPrice) };
    }));
    setError("");
  }

  async function handleFinalize() {
    const releasing = releasableItems(lines);
    if (releasing.length === 0) {
      setError("Nothing to release — set at least one quantity above zero, or reject the order.");
      return;
    }
    const blocked = checkStock(lines, stock);
    if (blocked) { setError(blocked); return; }

    setBusy(true);
    setError("");
    try {
      await releaseOrder({ ...order, items: lines }, stock, { centerId, userName: actorName, uid: actorUid }, reviewNote);
    } catch {
      setError("Could not finalize the order. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    setBusy(true);
    setError("");
    try {
      await safeUpdateDoc(doc(db, "servicecenters", centerId, "distributorOrders", order.id), {
        status: "rejected",
        reviewNote: reviewNote.trim() || null,
        reviewedAt: Timestamp.now(),
        reviewedBy: actorUid,
        reviewedByName: actorName,
      });
      setConfirmReject(false);
    } catch {
      setError("Could not reject the order. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-[#162032] border border-white/10 rounded-2xl overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-start justify-between gap-3 p-4 text-left hover:bg-white/[0.02] transition"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold text-white">{order.orderNumber}</span>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_CHIP[order.status]}`}>
              {STATUS_LABEL[order.status]}
            </span>
            {order.createdVia === "staff" && (
              <span className="text-xs px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-gray-400">
                Direct release
              </span>
            )}
            {payable && (
              <span className={`text-xs px-2 py-0.5 rounded-full border ${
                paymentSummary.status === "paid"
                  ? "bg-green-500/15 text-green-400 border-green-500/30"
                  : paymentSummary.status === "partial"
                    ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                    : "bg-white/5 text-gray-400 border-white/10"
              }`}>
                {paymentSummary.status === "paid"
                  ? "Settled"
                  : paymentSummary.status === "partial"
                    ? `${formatLKR(paymentSummary.balanceDue)} due`
                    : "Unpaid"}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-300 mt-1">{order.distributorName}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {order.items.length === 1 ? "1 line" : `${order.items.length} lines`} · {formatDateTime(order.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right">
            <p className="text-sm font-semibold text-white">
              {formatLKR(order.status === "submitted" ? total : order.total)}
            </p>
            {order.status === "submitted" && total !== requestedTotal && (
              <p className="text-xs text-gray-500">requested {formatLKR(requestedTotal)}</p>
            )}
          </div>
          {expanded
            ? <ChevronUp className="h-4 w-4 text-gray-500" />
            : <ChevronDown className="h-4 w-4 text-gray-500" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/10 p-4 space-y-4">
          {order.distributorPhone && (
            <a
              href={`tel:${order.distributorPhone}`}
              className="inline-flex items-center gap-1.5 text-xs text-[#F97316] hover:text-[#fb923c]"
            >
              <Phone className="h-3.5 w-3.5" /> {order.distributorPhone}
            </a>
          )}

          {order.note && (
            <div className="bg-[#0B1120] border border-white/5 rounded-lg px-3 py-2">
              <p className="text-xs text-gray-500 mb-0.5">Note from the distributor</p>
              <p className="text-sm text-gray-300">{order.note}</p>
            </div>
          )}

          {/* Lines */}
          <div className="space-y-2">
            {lines.map(line => {
              const item = stock.get(line.itemId);
              const short = item != null && item.currentQty < line.approvedQty;
              return (
                <div
                  key={line.itemId}
                  className="bg-[#0B1120] border border-white/5 rounded-lg px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">{line.itemName}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Requested {line.requestedQty} {line.unit} · {formatLKR(line.unitPrice)} each
                      {item
                        ? <> · <span className={short ? "text-red-400" : "text-gray-500"}>{item.currentQty} {item.unit} in stock</span></>
                        : <> · <span className="text-red-400">no longer in inventory</span></>}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {editable ? (
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-500">Release</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.approvedQty}
                          onChange={e => setApproved(line.itemId, e.target.value)}
                          className={`w-24 bg-[#162032] border rounded-lg px-2.5 py-1.5 text-white text-sm focus:outline-none transition ${
                            short ? "border-red-500/50 focus:border-red-500" : "border-white/10 focus:border-[#F97316]"
                          }`}
                        />
                        <span className="text-xs text-gray-500">{line.unit}</span>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-300">
                        {line.approvedQty} {line.unit}
                      </p>
                    )}
                    <p className="text-sm font-medium text-white w-28 text-right">{formatLKR(line.lineTotal)}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between border-t border-white/10 pt-3">
            <span className="text-sm text-gray-400">
              {order.status === "submitted" ? "Total to release" : "Total"}
            </span>
            <span className="text-base font-semibold text-white">
              {formatLKR(order.status === "submitted" ? total : order.total)}
            </span>
          </div>

          {/* Payments */}
          {payable && (
            <div className="border-t border-white/10 pt-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Payments</h4>
                {canRecordPayments && (
                  <button
                    onClick={() => setPaymentModal(true)}
                    className="flex items-center gap-1.5 text-xs font-medium bg-[#F97316]/10 hover:bg-[#F97316]/20 text-[#F97316] border border-[#F97316]/20 px-3 py-1.5 rounded-lg transition"
                  >
                    <Plus className="h-3.5 w-3.5" /> Record Payment
                  </button>
                )}
              </div>

              {/* Breakdown — mixed settlements are the norm, so cash, cheques
                  and credit are always shown side by side. */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {([
                  ["Cash", paymentSummary.cash, "text-green-400"],
                  ["Cheques", paymentSummary.cheque, "text-blue-400"],
                  ["Credit", paymentSummary.credit, "text-amber-400"],
                  ["Balance due", paymentSummary.balanceDue, paymentSummary.balanceDue > 0 ? "text-amber-400" : "text-green-400"],
                ] as const).map(([label, value, tone]) => (
                  <div key={label} className="bg-[#0B1120] border border-white/5 rounded-lg px-3 py-2">
                    <p className="text-xs text-gray-500">{label}</p>
                    <p className={`text-sm font-semibold mt-0.5 ${tone}`}>{formatLKR(value)}</p>
                  </div>
                ))}
              </div>

              {payments.length === 0 ? (
                <p className="text-xs text-gray-600">
                  Nothing recorded yet. {canRecordPayments
                    ? "Record cash, a cheque, or the part taken on credit as it comes in."
                    : "The owner records payments as they come in."}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {payments.map(p => {
                    const Icon = METHOD_ICON[p.method];
                    // A cheque or a credit isn't money yet. It's confirmed (or
                    // marked returned) from the Cheques & Credits register, so
                    // here it only says where it stands.
                    const returned = isPaymentReturned(p);
                    const awaiting = needsConfirmation(p.method) && !isPaymentConfirmed(p) && !returned;
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
                            <p className="text-sm text-white">
                              {METHOD_LABEL[p.method]}
                              <span className="text-gray-500 font-normal"> · {formatDate(p.date)}</span>
                            </p>
                            {p.method === "cheque" && (
                              <p className="text-xs text-gray-500 mt-0.5">
                                No. {p.chequeNumber} · {p.bank}
                                {p.branch ? `, ${p.branch}` : ""}
                                {p.chequeDate ? ` · dated ${formatDate(p.chequeDate)}` : ""}
                              </p>
                            )}
                            {p.note && <p className="text-xs text-gray-400 mt-0.5">{p.note}</p>}
                            <p className="text-xs text-gray-600 mt-0.5">
                              {returned ? (p.method === "cheque" ? "Returned" : "Written back")
                                : awaiting ? (p.method === "cheque" ? "Not yet cleared" : "Not yet collected")
                                : null}
                              {(returned || awaiting) && " · "}
                              Recorded by {p.recordedByName}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <p className="text-sm font-medium text-white">{formatLKR(p.amount)}</p>
                          {canRecordPayments && (
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
                </div>
              )}
            </div>
          )}

          {order.status !== "submitted" && order.reviewedByName && (
            <p className="text-xs text-gray-500">
              {order.status === "finalized" ? "Released" : "Rejected"} by {order.reviewedByName} ·{" "}
              {formatDateTime(order.finalizedAt ?? order.reviewedAt)}
            </p>
          )}
          {order.status !== "submitted" && order.reviewNote && (
            <p className="text-xs text-gray-400">Note: {order.reviewNote}</p>
          )}

          {error && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          {editable && (
            <>
              <input
                type="text"
                value={reviewNote}
                onChange={e => setReviewNote(e.target.value)}
                placeholder="Note for the record (optional)"
                className="w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition"
              />

              {confirmReject ? (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-400 flex-1">Reject this order without releasing anything?</span>
                  <button
                    onClick={() => setConfirmReject(false)}
                    className="px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-white/10 rounded-lg transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={busy}
                    className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 border border-red-500/30 rounded-lg transition disabled:opacity-60"
                  >
                    {busy ? "Rejecting…" : "Reject order"}
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={handleFinalize}
                    disabled={busy}
                    className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold bg-[#F97316] hover:bg-[#ea6c0f] text-white px-3 py-2.5 rounded-lg transition disabled:opacity-60"
                  >
                    <Truck className="h-4 w-4" />
                    {busy ? "Releasing…" : "Finalize & Release"}
                  </button>
                  <button
                    onClick={() => setConfirmReject(true)}
                    disabled={busy}
                    className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-3 py-2.5 rounded-lg transition disabled:opacity-60"
                  >
                    <X className="h-4 w-4" /> Reject
                  </button>
                </div>
              )}
              <p className="text-xs text-gray-600">
                Finalizing deducts the released quantities from stock and records the movement against{" "}
                {order.distributorName}.
              </p>
            </>
          )}

          {order.status === "finalized" && (
            <p className="text-xs text-green-400/80 flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5" /> Stock has been deducted and handed over.
            </p>
          )}
        </div>
      )}

      {paymentModal && (
        <RecordPaymentModal
          order={order}
          centerId={centerId}
          actorName={actorName}
          actorUid={actorUid}
          onClose={() => setPaymentModal(false)}
        />
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = "pending" | "history";

export default function DistributorOrdersPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const centerId = currentUser?.centerId ?? "";
  const actorName = currentUser?.displayName ?? currentUser?.email ?? "Staff";
  const actorUid = currentUser?.uid ?? "";

  const canView           = usePermission("distributors.viewOrders");
  const canFinalize       = usePermission("distributors.finalizeOrders");
  const canRecordPayments = usePermission("distributors.recordPayments");

  const [orders, setOrders] = useState<DistributorOrder[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("pending");

  useEffect(() => {
    if (!centerId) return;
    const q = query(
      collection(db, "servicecenters", centerId, "distributorOrders"),
      orderBy("createdAt", "desc"),
    );
    return onSnapshot(q, snap => {
      setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as DistributorOrder)));
      setLoading(false);
    }, () => setLoading(false));
  }, [centerId]);

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(collection(db, "servicecenters", centerId, "inventory"), snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryItem)));
    }, () => setItems([]));
  }, [centerId]);

  const stock = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);

  const visible = useMemo(
    () => orders.filter(o => (tab === "pending" ? o.status === "submitted" : o.status !== "submitted")),
    [orders, tab],
  );
  const pendingCount = orders.filter(o => o.status === "submitted").length;

  // What distributors owe overall, across every order that can still be settled.
  const outstanding = useMemo(() => {
    const settleable = orders.filter(o => o.status === "submitted" || o.status === "finalized");
    return settleable.reduce((acc, o) => {
      const s = summarisePayments(o.payments, o.total);
      return {
        billed: round2(acc.billed + o.total),
        received: round2(acc.received + s.received),
        balance: round2(acc.balance + s.balanceDue),
      };
    }, { billed: 0, received: 0, balance: 0 });
  }, [orders]);

  if (!canView) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <ClipboardList className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to view distributor orders.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<ClipboardList className="w-5 h-5" />}
        title="Distributor Orders"
        actions={
          <button
            onClick={() => navigate("/distributors")}
            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium px-4 py-2.5 rounded-xl transition text-sm"
          >
            <Truck className="h-4 w-4" />
            Distributors
          </button>
        }
        below={
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-3">
            <div className="flex bg-white/5 rounded-lg p-0.5 gap-0.5 w-fit">
              {(["pending", "history"] as Tab[]).map(key => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                    tab === key ? "bg-orange-500 text-white" : "text-gray-400 hover:text-white"
                  }`}
                >
                  {key === "pending" ? `To review (${pendingCount})` : "History"}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {!loading && orders.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            {([
              ["Billed", outstanding.billed, "text-white"],
              ["Received", outstanding.received, "text-green-400"],
              ["Outstanding", outstanding.balance, outstanding.balance > 0 ? "text-amber-400" : "text-green-400"],
            ] as const).map(([label, value, tone]) => (
              <div key={label} className="bg-[#162032] border border-white/10 rounded-2xl px-4 py-3">
                <p className="text-xs text-gray-500">{label}</p>
                <p className={`text-lg font-semibold mt-0.5 ${tone}`}>{formatLKR(value)}</p>
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <LoadingBlock className="py-20" />
        ) : visible.length === 0 ? (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3 text-center">
            <Package className="h-12 w-12 text-gray-700" />
            <p className="text-gray-400 font-medium">
              {tab === "pending" ? "No orders waiting for review" : "Nothing in the history yet"}
            </p>
            {tab === "pending" && orders.length === 0 && (
              <p className="text-sm text-gray-500 max-w-sm">
                Orders show up here as soon as a distributor sends one from their catalog link.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map(order => (
              <OrderCard
                key={order.id}
                order={order}
                stock={stock}
                centerId={centerId}
                canFinalize={canFinalize}
                canRecordPayments={canRecordPayments}
                actorName={actorName}
                actorUid={actorUid}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
