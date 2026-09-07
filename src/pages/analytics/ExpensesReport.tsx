import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection, getDocs, query, Timestamp, where,
} from "firebase/firestore";
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Plus } from "lucide-react";
import { db } from "../../config/firebase";
import { downloadCSV } from "../../lib/csvExport";
import {
  CHART_TOOLTIP_STYLE, formatDate, formatLKR, monthLabel,
} from "../../lib/reportFormat";
import { fetchExpensesInRange, totalsByCategory, type Expense } from "../../lib/expenses";
import {
  fetchPayrollOutgoings, type AdvanceRow, type PayslipRow,
} from "../../lib/payrollRecords";
import ExpenseFormModal from "../../components/finance/ExpenseFormModal";
import { EmptyNote, ReportCard, StatTiles } from "./reportUi";
import type { PurchaseOrderPlan, SupplierSupply } from "../../types/auth";

// Everything that leaves the till, in one report: recorded expenses, what
// payroll cost and how much of it was commission, advances handed to staff,
// goods received from suppliers, and the purchase orders still outstanding.
// Expenses can also be recorded straight from here, so an owner reading the
// month's numbers doesn't have to go somewhere else to enter the one they
// just spotted is missing.

interface Props {
  centerId: string;
  startDate: Date;
  endDate: Date;
  /** Owner/Manager — the roles the rules let record an expense. */
  canRecord: boolean;
}

const ADVANCE_LABEL: Record<AdvanceRow["type"], string> = {
  advance: "Advance",
  loan: "Loan",
  fine: "Fine",
  other: "Other",
};

interface Loaded {
  key: string;
  expenses: Expense[];
  payslips: PayslipRow[];
  advances: AdvanceRow[];
  supplies: SupplierSupply[];
  openOrders: PurchaseOrderPlan[];
  error: string;
}

const EMPTY: Omit<Loaded, "key" | "error"> = {
  expenses: [], payslips: [], advances: [], supplies: [], openOrders: [],
};

export default function ExpensesReport({ centerId, startDate, endDate, canRecord }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const rangeKey = `${centerId}:${startDate.getTime()}:${endDate.getTime()}:${reloadToken}`;

  const load = useCallback(async (): Promise<Omit<Loaded, "key" | "error">> => {
    const from = Timestamp.fromDate(startDate);
    const to = Timestamp.fromDate(endDate);
    const [expenses, payroll, supplySnap, orderSnap] = await Promise.all([
      fetchExpensesInRange(centerId, startDate, endDate),
      fetchPayrollOutgoings(centerId, startDate, endDate),
      getDocs(query(
        collection(db, "servicecenters", centerId, "supplierSupplies"),
        where("createdAt", ">=", from), where("createdAt", "<=", to),
      )),
      // Plans are live drafts, not history — they are shown whole, whatever
      // range is on screen, because an order still waiting on a supplier is
      // money committed today.
      getDocs(collection(db, "servicecenters", centerId, "purchaseOrderPlans")),
    ]);
    return {
      expenses,
      payslips: payroll.payslips,
      advances: payroll.advances,
      supplies: supplySnap.docs.map((d) => ({ id: d.id, ...d.data() } as SupplierSupply)),
      openOrders: orderSnap.docs
        .map((d) => ({ id: d.id, ...d.data() } as PurchaseOrderPlan))
        .sort((a, b) =>
          ((b.updatedAt ?? b.createdAt)?.toMillis?.() ?? 0)
          - ((a.updatedAt ?? a.createdAt)?.toMillis?.() ?? 0)),
    };
  }, [centerId, startDate, endDate]);

  useEffect(() => {
    if (!centerId) return;
    let active = true;
    load()
      .then((data) => { if (active) setLoaded({ key: rangeKey, ...data, error: "" }); })
      .catch(() => {
        if (active) {
          setLoaded({
            key: rangeKey, ...EMPTY,
            error: "Could not load outgoings. Expenses and payroll are Owner/Manager only.",
          });
        }
      });
    return () => { active = false; };
    // startDate/endDate are folded into rangeKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  const fresh = loaded?.key === rangeKey ? loaded : null;
  const loading = fresh === null;
  const error = fresh?.error ?? "";
  const expenses = useMemo(() => fresh?.expenses ?? [], [fresh]);
  const payslips = useMemo(() => fresh?.payslips ?? [], [fresh]);
  const advances = useMemo(() => fresh?.advances ?? [], [fresh]);
  const supplies = useMemo(() => fresh?.supplies ?? [], [fresh]);
  const openOrders = useMemo(() => fresh?.openOrders ?? [], [fresh]);

  const expenseTotal = useMemo(
    () => expenses.reduce((s, e) => s + (e.amount || 0), 0), [expenses]);
  const commissionTotal = useMemo(
    () => payslips.reduce((s, p) => s + (p.commissionAmount || 0), 0), [payslips]);
  const payrollTotal = useMemo(
    () => payslips.reduce((s, p) => s + (p.netPay || 0), 0), [payslips]);
  const advanceTotal = useMemo(
    () => advances.reduce((s, a) => s + (a.amount || 0), 0), [advances]);
  const advanceOutstanding = useMemo(
    () => advances.filter((a) => !a.appliedPayslipId).reduce((s, a) => s + (a.amount || 0), 0),
    [advances]);
  const purchaseTotal = useMemo(
    () => supplies.reduce((s, x) => s + (x.total || 0), 0), [supplies]);
  const purchaseCredit = useMemo(
    () => supplies.reduce((s, x) => s + (x.balanceDue ?? 0), 0), [supplies]);

  // An advance is money already handed over, and the payslip that recovers it
  // shows it as a deduction — counting both would double it, so the headline
  // total takes payroll's net pay plus advances still outstanding.
  const totalOutgoings = expenseTotal + payrollTotal + advanceOutstanding + purchaseTotal;

  const byCategory = useMemo(() => totalsByCategory(expenses), [expenses]);

  // Month-by-month, split by where the money went.
  const monthly = useMemo(() => {
    const map = new Map<string, {
      sort: number; month: string; expenses: number; payroll: number;
      advances: number; purchases: number;
    }>();
    const bucket = (d: Date) => {
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
      const entry = map.get(key) ?? {
        sort: d.getFullYear() * 12 + d.getMonth(), month: monthLabel(d),
        expenses: 0, payroll: 0, advances: 0, purchases: 0,
      };
      map.set(key, entry);
      return entry;
    };
    expenses.forEach((e) => {
      const d = e.date?.toDate?.(); if (d) bucket(d).expenses += e.amount || 0;
    });
    advances.forEach((a) => {
      const d = a.date?.toDate?.(); if (d) bucket(d).advances += a.amount || 0;
    });
    supplies.forEach((s) => {
      const d = s.createdAt?.toDate?.(); if (d) bucket(d).purchases += s.total || 0;
    });
    payslips.forEach((p) => {
      const [y, m] = p.month.split("-").map(Number);
      if (!y || !m) return;
      bucket(new Date(y, m - 1, 1)).payroll += p.netPay || 0;
    });
    return Array.from(map.values()).sort((a, b) => a.sort - b.sort);
  }, [expenses, advances, supplies, payslips]);

  if (loading) return <EmptyNote>Loading outgoings…</EmptyNote>;
  if (error) return <EmptyNote>{error}</EmptyNote>;

  return (
    <div className="space-y-6">
      <StatTiles tiles={[
        { label: "Total Outgoings", value: formatLKR(totalOutgoings), sub: "Expenses + payroll + purchases", tone: "text-red-300" },
        { label: "Expenses", value: formatLKR(expenseTotal), sub: `${expenses.length} recorded` },
        { label: "Payroll (net)", value: formatLKR(payrollTotal), sub: `${payslips.length} payslip${payslips.length === 1 ? "" : "s"}` },
        { label: "Commissions", value: formatLKR(commissionTotal), sub: "Paid through payslips", tone: "text-[#F97316]" },
        { label: "Advances Paid", value: formatLKR(advanceTotal), sub: `${formatLKR(advanceOutstanding)} not yet recovered` },
        { label: "Purchases (GRN)", value: formatLKR(purchaseTotal), sub: `${formatLKR(purchaseCredit)} still owed` },
        { label: "Open Purchase Orders", value: String(openOrders.length), sub: "Drafted, not yet received" },
        { label: "Avg. Expense", value: formatLKR(expenses.length ? expenseTotal / expenses.length : 0), sub: "Per recorded entry" },
      ]} />

      {canRecord && (
        <div className="flex justify-end">
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white px-3 py-2 rounded-lg text-sm font-semibold"
          >
            <Plus className="h-4 w-4" />
            Record Expense
          </button>
        </div>
      )}

      <ReportCard title="Outgoings by month">
        {monthly.length === 0 ? (
          <EmptyNote>Nothing went out in this period.</EmptyNote>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="month" stroke="#64748B" fontSize={12} />
              <YAxis stroke="#64748B" fontSize={12} />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                formatter={(v, name) => [formatLKR(v as number), name as string]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="expenses" name="Expenses" stackId="out" fill="#F97316" />
              <Bar dataKey="payroll" name="Payroll" stackId="out" fill="#38BDF8" />
              <Bar dataKey="advances" name="Advances" stackId="out" fill="#FBBF24" />
              <Bar dataKey="purchases" name="Purchases" stackId="out" fill="#A78BFA" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ReportCard>

      <ReportCard
        title="Expenses by category"
        onExport={byCategory.length ? () => downloadCSV(
          "expenses-by-category.csv",
          ["Category", "Total (LKR)", "Share %"],
          byCategory.map((c) => [
            c.category,
            String(c.total),
            expenseTotal ? ((c.total / expenseTotal) * 100).toFixed(1) : "0",
          ]),
        ) : undefined}
      >
        {byCategory.length === 0 ? (
          <EmptyNote>No expenses recorded in this period.</EmptyNote>
        ) : (
          <div className="space-y-3">
            {byCategory.map((c) => {
              const pct = expenseTotal > 0 ? (c.total / expenseTotal) * 100 : 0;
              return (
                <div key={c.category}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-gray-300">{c.category}</span>
                    <span className="text-white font-medium">{formatLKR(c.total)}</span>
                  </div>
                  <div className="w-full bg-white/5 rounded-full h-1.5">
                    <div className="h-1.5 rounded-full bg-[#F97316]" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs text-gray-600 mt-0.5">{pct.toFixed(1)}% of expenses</p>
                </div>
              );
            })}
          </div>
        )}
      </ReportCard>

      <ReportCard
        title="Expense ledger"
        onExport={expenses.length ? () => downloadCSV(
          "expenses.csv",
          ["Date", "Category", "Description", "Vendor", "Method", "Amount (LKR)"],
          expenses.map((e) => [
            formatDate(e.date), e.category, e.description ?? "",
            e.vendor ?? "", e.paymentMethod ?? "", String(e.amount ?? 0),
          ]),
        ) : undefined}
      >
        {expenses.length === 0 ? (
          <EmptyNote>
            No expenses recorded.{canRecord ? " Use Record Expense above to add one." : ""}
          </EmptyNote>
        ) : (
          <Table
            headers={["Date", "Category", "Description", "Vendor", "Method", "Amount"]}
            alignRight={[5]}
            rows={expenses.map((e) => [
              formatDate(e.date),
              e.category,
              e.description ?? "—",
              e.vendor || "—",
              e.paymentMethod || "—",
              formatLKR(e.amount ?? 0),
            ])}
            footer={["", "", "", "", "Total", formatLKR(expenseTotal)]}
          />
        )}
      </ReportCard>

      <ReportCard
        title="Payroll & commissions"
        onExport={payslips.length ? () => downloadCSV(
          "payroll-commissions.csv",
          ["Month", "Employee", "Role", "Basic", "Commission", "Overtime", "Deductions", "Net Pay", "Status"],
          payslips.map((p) => [
            p.month, p.staffName, p.role ?? "", String(p.basicSalary),
            String(p.commissionAmount), String(p.otAmount), String(p.totalDeductions),
            String(p.netPay), p.status ?? "",
          ]),
        ) : undefined}
      >
        {payslips.length === 0 ? (
          <EmptyNote>No payslips generated for these months.</EmptyNote>
        ) : (
          <Table
            headers={["Month", "Employee", "Basic", "Commission", "Overtime", "Deductions", "Net Pay"]}
            alignRight={[2, 3, 4, 5, 6]}
            rows={[...payslips]
              .sort((a, b) => b.month.localeCompare(a.month) || a.staffName.localeCompare(b.staffName))
              .map((p) => [
                p.month,
                p.staffName,
                formatLKR(p.basicSalary),
                p.commissionAmount
                  ? `${formatLKR(p.commissionAmount)}${p.commissionRate ? ` (${p.commissionRate}%)` : ""}`
                  : "—",
                formatLKR(p.otAmount),
                formatLKR(p.totalDeductions),
                formatLKR(p.netPay),
              ])}
            footer={[
              "", "Total", "",
              formatLKR(commissionTotal), "", "", formatLKR(payrollTotal),
            ]}
          />
        )}
      </ReportCard>

      <ReportCard
        title="Advances, loans & fines"
        onExport={advances.length ? () => downloadCSV(
          "staff-advances.csv",
          ["Date", "Employee", "Type", "Details", "Amount (LKR)", "Recovered", "Recorded By"],
          advances.map((a) => [
            formatDate(a.date), a.staffName, ADVANCE_LABEL[a.type] ?? "Other",
            a.label, String(a.amount), a.appliedPayslipId ? "Yes" : "No",
            a.recordedByName ?? "",
          ]),
        ) : undefined}
      >
        {advances.length === 0 ? (
          <EmptyNote>
            No advances or other staff deductions in this period. Record one from an
            employee's profile — the payslip for that month picks it up.
          </EmptyNote>
        ) : (
          <Table
            headers={["Date", "Employee", "Type", "Details", "Amount", "Recovered"]}
            alignRight={[4]}
            rows={[...advances]
              .sort((a, b) => (b.date?.toMillis?.() ?? 0) - (a.date?.toMillis?.() ?? 0))
              .map((a) => [
                formatDate(a.date),
                a.staffName,
                ADVANCE_LABEL[a.type] ?? "Other",
                a.label,
                formatLKR(a.amount),
                a.appliedPayslipId ? "On a payslip" : "Outstanding",
              ])}
            footer={["", "", "", "Total", formatLKR(advanceTotal), ""]}
          />
        )}
      </ReportCard>

      <ReportCard
        title="Purchases received"
        onExport={supplies.length ? () => downloadCSV(
          "purchases.csv",
          ["Date", "GRN", "Supplier", "Items", "Total (LKR)", "Paid (LKR)", "Balance (LKR)", "Status"],
          supplies.map((s) => [
            formatDate(s.createdAt), s.supplyNumber ?? "", s.supplierName ?? "",
            String(s.items?.length ?? 0), String(s.total ?? 0), String(s.paidTotal ?? 0),
            String(s.balanceDue ?? 0), s.paymentStatus ?? "",
          ]),
        ) : undefined}
      >
        {supplies.length === 0 ? (
          <EmptyNote>No goods received in this period.</EmptyNote>
        ) : (
          <Table
            headers={["Date", "GRN", "Supplier", "Items", "Total", "Balance Due"]}
            alignRight={[3, 4, 5]}
            rows={[...supplies]
              .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
              .map((s) => [
                formatDate(s.createdAt),
                s.supplyNumber ?? "—",
                s.supplierCompany || s.supplierName || "—",
                String(s.items?.length ?? 0),
                formatLKR(s.total ?? 0),
                formatLKR(s.balanceDue ?? 0),
              ])}
            footer={["", "", "", "Total", formatLKR(purchaseTotal), formatLKR(purchaseCredit)]}
          />
        )}
      </ReportCard>

      <ReportCard
        title="Open purchase orders"
        onExport={openOrders.length ? () => downloadCSV(
          "open-purchase-orders.csv",
          ["Supplier", "Lines", "Units", "Status", "Updated"],
          openOrders.map((o) => [
            o.supplierCompany || o.supplierName,
            String(o.lines?.length ?? 0),
            String((o.lines ?? []).reduce((s, l) => s + (l.requestedQty || 0), 0)),
            o.status ?? "draft",
            formatDate(o.updatedAt ?? o.createdAt),
          ]),
        ) : undefined}
      >
        {openOrders.length === 0 ? (
          <EmptyNote>No purchase orders waiting on a supplier.</EmptyNote>
        ) : (
          <Table
            headers={["Supplier", "Lines", "Units", "Status", "Last Updated"]}
            alignRight={[1, 2]}
            rows={openOrders.map((o) => [
              o.supplierCompany || o.supplierName || "—",
              String(o.lines?.length ?? 0),
              String((o.lines ?? []).reduce((s, l) => s + (l.requestedQty || 0), 0)),
              o.status === "sent" ? "Sent to supplier" : "Draft",
              formatDate(o.updatedAt ?? o.createdAt),
            ])}
          />
        )}
      </ReportCard>

      {addOpen && (
        <ExpenseFormModal
          centerId={centerId}
          usedCategories={byCategory.map((c) => c.category)}
          defaultDate={endDate > new Date() ? new Date() : endDate}
          onClose={() => setAddOpen(false)}
          onSaved={() => setReloadToken((n) => n + 1)}
        />
      )}
    </div>
  );
}

/** The one table shape every section on this report uses. */
function Table({
  headers, rows, alignRight = [], footer,
}: {
  headers: string[];
  rows: string[][];
  /** Column indexes whose cells are numbers and sit right. */
  alignRight?: number[];
  footer?: string[];
}) {
  const right = new Set(alignRight);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/5 text-xs text-gray-500 uppercase tracking-wider">
            {headers.map((h, i) => (
              <th key={h} className={`py-2 pr-3 ${right.has(i) ? "text-right" : "text-left"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-white/5 last:border-0 hover:bg-white/5">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={`py-2.5 pr-3 whitespace-nowrap ${
                    right.has(ci) ? "text-right text-white font-medium" : "text-gray-300"
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot>
            <tr className="border-t border-white/10">
              {footer.map((cell, i) => (
                <td
                  key={i}
                  className={`py-3 pr-3 text-sm font-semibold ${
                    right.has(i) ? "text-right text-white" : "text-gray-400"
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
