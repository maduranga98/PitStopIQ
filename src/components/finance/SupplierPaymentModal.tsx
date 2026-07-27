import { useState } from "react";
import { Timestamp } from "firebase/firestore";
import { AlertTriangle, Wallet, X } from "lucide-react";
import type { SupplierPayment, SupplierPaymentMethod, SupplierSupply } from "../../types/auth";
import { SUPPLIER_METHOD_ICON } from "./supplierPaymentMeta";
import { formatLKR } from "../../lib/inventoryPricing";
import {
  needsConfirmation, newSupplierPaymentId, recordSupplierPayment, round2,
  summariseSupplierPayments, SUPPLIER_METHOD_LABEL, SUPPLIER_PAYMENT_METHODS,
} from "../../lib/supplierPayments";

// Paying for a delivery, recorded the same way the counter records a customer
// paying: one entry per payment, so half cash now and a post-dated cheque for
// the rest is simply two entries. A cheque written here is what turns up on the
// cheque calendar as money that has to be in the account by its date.

/** Local date input (yyyy-mm-dd) → Timestamp, read as local midnight. */
function dateInputToTimestamp(value: string): Timestamp {
  const [y, m, d] = value.split("-").map(Number);
  return Timestamp.fromDate(new Date(y, (m || 1) - 1, d || 1));
}

function todayInputValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const fieldClass =
  "w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition";

export default function SupplierPaymentModal({
  supply, centerId, actorUid, actorName, onClose,
}: {
  supply: SupplierSupply;
  centerId: string;
  actorUid: string;
  actorName: string;
  onClose: () => void;
}) {
  const summary = summariseSupplierPayments(supply.payments, supply.total);

  const [method, setMethod] = useState<SupplierPaymentMethod>("cash");
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
    if (!amount || isNaN(value) || value <= 0) { setError("Enter a positive amount."); return; }
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
      const payment: SupplierPayment = {
        id: newSupplierPaymentId(),
        method,
        amount: round2(value),
        date: dateInputToTimestamp(date),
        recordedBy: actorUid,
        recordedByName: actorName,
        recordedAt: Timestamp.now(),
        // A cheque still has to be presented and a credit still has to be
        // settled, so both start pending and wait to be confirmed from the
        // cheque & credit register.
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
      await recordSupplierPayment(centerId, supply, payment);
      onClose();
    } catch {
      setError("Could not save the payment. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Record Payment to Supplier</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="bg-[#0B1120] rounded-xl p-4 mb-5 border border-white/5">
          <p className="text-sm font-semibold text-white font-mono">{supply.supplyNumber}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {supply.supplierCompany}
            {supply.invoiceRef ? ` · bill ${supply.invoiceRef}` : ""}
          </p>
          <div className="flex items-center justify-between text-xs mt-2">
            <span className="text-gray-500">Delivery total</span>
            <span className="text-white">{formatLKR(supply.total)}</span>
          </div>
          <div className="flex items-center justify-between text-xs mt-1">
            <span className="text-gray-500">Still owed</span>
            <span className={summary.balanceDue > 0 ? "text-amber-400 font-medium" : "text-green-400 font-medium"}>
              {formatLKR(summary.balanceDue)}
            </span>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Payment type</label>
            <div className="grid grid-cols-4 gap-2">
              {SUPPLIER_PAYMENT_METHODS.map(m => {
                const Icon = SUPPLIER_METHOD_ICON[m];
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
                    {SUPPLIER_METHOD_LABEL[m]}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-600 mt-1.5">
              {method === "credit"
                ? "Records what's still on the supplier's book. It stays owed until you mark it settled."
                : method === "cheque"
                  ? "The cheque's date is the day your account has to cover it — it shows up on the cheque calendar."
                  : "Add one entry per payment — mix cash, transfers, cheques and credit freely."}
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
              {method === "credit" ? "Date agreed" : "Date paid"} <span className="text-red-400">*</span>
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
              placeholder="e.g. Balance on 30 days"
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
