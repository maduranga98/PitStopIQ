import { useEffect, useMemo, useState } from "react";
import {
  collection, query, where, onSnapshot, orderBy,
  doc, getDoc, serverTimestamp, Timestamp, arrayUnion,
} from "firebase/firestore";
import { safeAddDoc, safeDeleteDoc, safeSetDoc } from "../../lib/firestoreWrite";
import {
  Calculator, TrendingUp, TrendingDown, DollarSign, Plus, X,
  ArrowDownCircle, ArrowUpCircle, Loader2, AlertTriangle, Trash2,
  FileText, Calendar,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { useTranslation } from "react-i18next";

// Default categories; centers can add their own, so a category is any string.
type ExpenseCategory = string;

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "Rent", "Utilities", "Salaries", "Inventory", "Marketing",
  "Tools & Equipment", "Transport", "Maintenance", "Tax", "Other",
];

interface Expense {
  id: string;
  date: Timestamp;
  category: ExpenseCategory;
  description: string;
  amount: number;
  paymentMethod?: string;
  vendor?: string;
  createdAt: Timestamp;
}

interface InvoiceLite {
  id: string;
  grandTotal: number;
  status: "pending" | "partial" | "paid";
  paidAmount?: number;
  createdAt: Timestamp;
  serviceDate?: Timestamp;
  customerName?: string;
}

type RangeKey = "this_month" | "last_month" | "ytd" | "all";

function startOfMonth(d: Date) { const x = new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x; }
function startOfYear(d: Date) { const x = new Date(d); x.setMonth(0, 1); x.setHours(0,0,0,0); return x; }
function endOfMonth(d: Date) { const x = startOfMonth(d); x.setMonth(x.getMonth() + 1); return x; }

function fmtLKR(n: number) {
  return `LKR ${n.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(ts?: Timestamp) {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function AccountingPage() {
  const { currentUser } = useAuth();
  const { t } = useTranslation();
  const centerId = currentUser?.centerId;
  const canManage = currentUser?.role === "Owner" || currentUser?.role === "Manager";

  const [range, setRange] = useState<RangeKey>("this_month");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [invoices, setInvoices] = useState<InvoiceLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [customCategories, setCustomCategories] = useState<string[]>([]);

  // Load custom expense categories saved at the service-center level
  useEffect(() => {
    if (!centerId) return;
    getDoc(doc(db, "servicecenters", centerId)).then((snap) => {
      const c = snap.data() as { customExpenseCategories?: string[] } | undefined;
      setCustomCategories(c?.customExpenseCategories ?? []);
    });
  }, [centerId]);

  // Defaults + center customs + anything already used on an expense record
  const allCategories = useMemo(() => {
    const set = new Set<string>(EXPENSE_CATEGORIES);
    customCategories.forEach((c) => set.add(c));
    expenses.forEach((e) => { if (e.category) set.add(e.category); });
    return Array.from(set);
  }, [customCategories, expenses]);

  async function addCustomCategory(name: string) {
    if (!centerId) return;
    setCustomCategories((prev) => (prev.includes(name) ? prev : [...prev, name]));
    try {
      await safeSetDoc(doc(db, "servicecenters", centerId), { customExpenseCategories: arrayUnion(name) }, { merge: true });
    } catch {
      /* non-fatal — the expense itself still saves with the typed category */
    }
  }

  // Expenses subscription
  useEffect(() => {
    if (!centerId) return;
    const q = query(
      collection(db, "servicecenters", centerId, "expenses"),
      orderBy("date", "desc"),
    );
    return onSnapshot(q, (snap) => {
      setExpenses(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Expense)));
      setLoading(false);
    }, () => setLoading(false));
  }, [centerId]);

  // Invoices subscription (for revenue)
  useEffect(() => {
    if (!centerId) return;
    const q = query(
      collection(db, "servicecenters", centerId, "invoices"),
      where("status", "in", ["paid", "partial"]),
    );
    return onSnapshot(q, (snap) => {
      setInvoices(snap.docs.map((d) => ({ id: d.id, ...d.data() } as InvoiceLite)));
    });
  }, [centerId]);

  // Date filter
  const { fromDate, toDate, label } = useMemo(() => {
    const now = new Date();
    if (range === "this_month") return { fromDate: startOfMonth(now), toDate: endOfMonth(now), label: "This Month" };
    if (range === "last_month") {
      const last = new Date(now); last.setMonth(last.getMonth() - 1);
      return { fromDate: startOfMonth(last), toDate: startOfMonth(now), label: "Last Month" };
    }
    if (range === "ytd") return { fromDate: startOfYear(now), toDate: new Date(now.getTime() + 86400000), label: "Year to Date" };
    return { fromDate: new Date(0), toDate: new Date(now.getTime() + 86400000), label: "All Time" };
  }, [range]);

  const filteredExpenses = expenses.filter((e) => {
    const t = e.date?.toDate?.() ?? new Date(0);
    return t >= fromDate && t < toDate;
  });

  const filteredInvoices = invoices.filter((inv) => {
    const t = (inv.serviceDate ?? inv.createdAt)?.toDate?.() ?? new Date(0);
    return t >= fromDate && t < toDate;
  });

  const totalRevenue = filteredInvoices.reduce((s, i) => s + (i.paidAmount ?? i.grandTotal ?? 0), 0);
  const totalExpenses = filteredExpenses.reduce((s, e) => s + (e.amount ?? 0), 0);
  const netProfit = totalRevenue - totalExpenses;
  const margin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

  // Expense breakdown by category
  const byCategory = allCategories.map((cat) => ({
    category: cat,
    total: filteredExpenses.filter((e) => e.category === cat).reduce((s, e) => s + (e.amount ?? 0), 0),
  })).filter((c) => c.total > 0).sort((a, b) => b.total - a.total);

  async function handleDeleteExpense(id: string) {
    if (!centerId) return;
    if (!confirm("Delete this expense?")) return;
    await safeDeleteDoc(doc(db, "servicecenters", centerId, "expenses", id));
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<Calculator className="w-5 h-5" />}
        title={t("accounting.title")}
        actions={
          <>
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg p-1">
              {(["this_month", "last_month", "ytd", "all"] as RangeKey[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`px-3 py-1.5 text-xs rounded-md transition ${
                    range === r ? "bg-[#F97316] text-white font-semibold" : "text-gray-400 hover:text-white"
                  }`}
                >
                  {r === "this_month" ? "This Month" : r === "last_month" ? "Last Month" : r === "ytd" ? "YTD" : "All"}
                </button>
              ))}
            </div>
            {canManage && (
              <button
                onClick={() => setAddOpen(true)}
                className="flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white px-3 py-1.5 rounded-lg text-sm font-semibold"
              >
                <Plus className="w-4 h-4" />
                Add Expense
              </button>
            )}
          </>
        }
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard
            icon={<ArrowUpCircle className="h-5 w-5 text-emerald-400" />}
            label="Revenue"
            value={fmtLKR(totalRevenue)}
            sub={`${filteredInvoices.length} invoice${filteredInvoices.length === 1 ? "" : "s"} · ${label}`}
            accent="bg-emerald-500/10"
          />
          <SummaryCard
            icon={<ArrowDownCircle className="h-5 w-5 text-red-400" />}
            label="Expenses"
            value={fmtLKR(totalExpenses)}
            sub={`${filteredExpenses.length} entr${filteredExpenses.length === 1 ? "y" : "ies"} · ${label}`}
            accent="bg-red-500/10"
          />
          <SummaryCard
            icon={netProfit >= 0
              ? <TrendingUp className="h-5 w-5 text-green-400" />
              : <TrendingDown className="h-5 w-5 text-red-400" />}
            label="Net Profit"
            value={fmtLKR(netProfit)}
            sub={`${netProfit >= 0 ? "+" : ""}${margin.toFixed(1)}% margin`}
            accent={netProfit >= 0 ? "bg-green-500/10" : "bg-red-500/10"}
          />
          <SummaryCard
            icon={<DollarSign className="h-5 w-5 text-[#F97316]" />}
            label="Avg. Ticket"
            value={fmtLKR(filteredInvoices.length ? totalRevenue / filteredInvoices.length : 0)}
            sub="Revenue per invoice"
            accent="bg-[#F97316]/10"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Expense breakdown */}
          <div className="lg:col-span-1 bg-[#162032] border border-white/10 rounded-2xl p-6">
            <h2 className="text-base font-semibold text-white mb-4">Expense Breakdown</h2>
            {byCategory.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">No expenses recorded in this period.</p>
            ) : (
              <div className="space-y-3">
                {byCategory.map((c) => {
                  const pct = totalExpenses > 0 ? (c.total / totalExpenses) * 100 : 0;
                  return (
                    <div key={c.category}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-gray-300">{c.category}</span>
                        <span className="text-white font-medium">{fmtLKR(c.total)}</span>
                      </div>
                      <div className="w-full bg-white/5 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full bg-[#F97316]" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{pct.toFixed(1)}% of expenses</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Expense ledger */}
          <div className="lg:col-span-2 bg-[#162032] border border-white/10 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white">Expense Ledger</h2>
              <span className="text-xs text-gray-500">{filteredExpenses.length} entries</span>
            </div>

            {loading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="w-6 h-6 text-[#F97316] animate-spin" />
              </div>
            ) : filteredExpenses.length === 0 ? (
              <div className="flex flex-col items-center py-10 gap-2">
                <FileText className="w-10 h-10 text-gray-600" />
                <p className="text-sm text-gray-500">No expenses logged for {label.toLowerCase()}.</p>
                {canManage && (
                  <button onClick={() => setAddOpen(true)} className="text-xs text-[#F97316] hover:text-orange-300 mt-2">
                    Add your first expense →
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5 text-xs text-gray-500 uppercase tracking-wider">
                      <th className="text-left py-2 pr-2">Date</th>
                      <th className="text-left py-2 pr-2">Category</th>
                      <th className="text-left py-2 pr-2">Description</th>
                      <th className="text-right py-2 pr-2">Amount</th>
                      {canManage && <th className="py-2 w-8"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredExpenses.map((e) => (
                      <tr key={e.id} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                        <td className="py-3 pr-2 text-gray-300 whitespace-nowrap">{fmtDate(e.date)}</td>
                        <td className="py-3 pr-2">
                          <span className="text-xs bg-white/5 border border-white/10 text-gray-300 px-2 py-0.5 rounded-full">
                            {e.category}
                          </span>
                        </td>
                        <td className="py-3 pr-2 text-white">
                          {e.description}
                          {e.vendor && <div className="text-xs text-gray-500">{e.vendor}</div>}
                        </td>
                        <td className="py-3 pr-2 text-right text-red-300 font-medium whitespace-nowrap">
                          -{fmtLKR(e.amount)}
                        </td>
                        {canManage && (
                          <td className="py-3 text-right">
                            <button
                              onClick={() => handleDeleteExpense(e.id)}
                              className="text-gray-500 hover:text-red-400"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-white/10">
                      <td colSpan={3} className="py-3 text-right text-sm text-gray-400 font-medium">
                        Total Expenses
                      </td>
                      <td className="py-3 text-right text-red-400 font-bold">
                        -{fmtLKR(totalExpenses)}
                      </td>
                      {canManage && <td></td>}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* P&L bar */}
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-6">
          <h2 className="text-base font-semibold text-white mb-4">Profit & Loss · {label}</h2>
          <div className="space-y-3">
            <PLRow label="Revenue" amount={totalRevenue} color="text-emerald-400" />
            <PLRow label="Expenses" amount={-totalExpenses} color="text-red-400" />
            <div className="border-t border-white/10 pt-3">
              <PLRow label="Net Profit" amount={netProfit} color={netProfit >= 0 ? "text-green-400" : "text-red-400"} bold />
            </div>
          </div>
        </div>
      </div>

      {addOpen && centerId && (
        <AddExpenseModal
          centerId={centerId}
          categories={allCategories}
          onAddCategory={addCustomCategory}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}

function SummaryCard({ icon, label, value, sub, accent }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; accent: string;
}) {
  return (
    <div className="bg-[#162032] border border-white/10 rounded-2xl p-5">
      <div className={`p-2.5 rounded-xl inline-flex mb-3 ${accent}`}>{icon}</div>
      <div className="text-xl font-bold text-white">{value}</div>
      <div className="text-sm text-gray-400">{label}</div>
      {sub && <div className="text-xs text-gray-600 mt-0.5">{sub}</div>}
    </div>
  );
}

function PLRow({ label, amount, color, bold }: { label: string; amount: number; color: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "text-lg" : "text-sm"}`}>
      <span className={bold ? "text-white font-semibold" : "text-gray-300"}>{label}</span>
      <span className={`${color} ${bold ? "font-bold" : "font-medium"}`}>
        {amount < 0 ? "-" : ""}{fmtLKR(Math.abs(amount))}
      </span>
    </div>
  );
}

const NEW_CATEGORY = "__new__";

function AddExpenseModal({ centerId, categories, onAddCategory, onClose }: {
  centerId: string;
  categories: string[];
  onAddCategory: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [category, setCategory] = useState<ExpenseCategory>("Other");
  const [newCategory, setNewCategory] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setError("");
    const amt = parseFloat(amount);
    if (!date) return setError("Date is required");
    if (!description.trim()) return setError("Description is required");
    if (isNaN(amt) || amt <= 0) return setError("Enter a valid amount");

    let finalCategory = category;
    if (category === NEW_CATEGORY) {
      finalCategory = newCategory.trim();
      if (!finalCategory) return setError("Enter a name for the new category");
    }

    setSaving(true);
    try {
      if (category === NEW_CATEGORY) {
        await onAddCategory(finalCategory);
      }
      await safeAddDoc(collection(db, "servicecenters", centerId, "expenses"), {
        date: Timestamp.fromDate(new Date(date)),
        category: finalCategory,
        description: description.trim(),
        amount: amt,
        vendor: vendor.trim(),
        paymentMethod,
        createdAt: serverTimestamp(),
      });
      onClose();
    } catch {
      setError("Failed to save expense.");
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">Add Expense</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X className="w-5 h-5" /></button>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-3 py-2 text-xs">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />{error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-white/5 border border-white/10 text-white rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
              />
            </div>
          </Field>
          <Field label="Amount (LKR)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
            />
          </Field>
        </div>

        <Field label="Category">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
            className="w-full bg-[#0B1120] border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
          >
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value={NEW_CATEGORY}>+ Add new category…</option>
          </select>
          {category === NEW_CATEGORY && (
            <input
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="New category name"
              autoFocus
              className="mt-2 w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
            />
          )}
        </Field>

        <Field label="Description">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Office rent — November"
            className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Vendor (optional)">
            <input
              type="text"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="Vendor name"
              className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
            />
          </Field>
          <Field label="Payment Method">
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full bg-[#0B1120] border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
            >
              <option>Cash</option>
              <option>Bank Transfer</option>
              <option>Card</option>
              <option>Cheque</option>
              <option>Other</option>
            </select>
          </Field>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white py-2.5 rounded-lg text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? "Saving…" : "Save Expense"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-gray-400 block mb-1">{label}</label>
      {children}
    </div>
  );
}
