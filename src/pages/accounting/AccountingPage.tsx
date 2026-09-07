import { useEffect, useMemo, useState } from "react";
import { collection, query, onSnapshot, orderBy, doc, Timestamp, where } from "firebase/firestore";
import { safeDeleteDoc } from "../../lib/firestoreWrite";
import {
  Calculator, TrendingUp, TrendingDown, DollarSign, Plus,
  ArrowDownCircle, ArrowUpCircle, Trash2, FileText,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { useTranslation } from "react-i18next";
import { LoadingBlock } from "../../components/LoadingProgress";
import ExpenseFormModal from "../../components/finance/ExpenseFormModal";
import {
  loadCustomCategories, mergeCategories, totalsByCategory, type Expense,
} from "../../lib/expenses";

interface InvoiceLite {
  id: string;
  grandTotal: number;
  status: "pending" | "partial" | "paid";
  paidAmount?: number;
  createdAt: Timestamp;
  serviceDate?: Timestamp;
  customerName?: string;
  isDeleted?: boolean;
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

  // Custom categories are only needed to spot ones a center added but has not
  // spent against yet; the modal loads its own copy for the picker.
  useEffect(() => {
    if (!centerId) return;
    let active = true;
    loadCustomCategories(centerId)
      .then((c) => { if (active) setCustomCategories(c); })
      .catch(() => { /* defaults still cover the breakdown */ });
    return () => { active = false; };
  }, [centerId]);

  const usedCategories = useMemo(
    () => Array.from(new Set(expenses.map((e) => e.category).filter(Boolean))),
    [expenses],
  );

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
      setInvoices(snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as InvoiceLite))
        .filter((inv) => !inv.isDeleted));
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
  const byCategory = totalsByCategory(filteredExpenses);

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
              <LoadingBlock className="py-10" />
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
        <ExpenseFormModal
          centerId={centerId}
          usedCategories={mergeCategories(customCategories, usedCategories)}
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
