import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection, getDocs, query, where, Timestamp,
} from "firebase/firestore";
import {
  CalendarDays, ChevronLeft, ChevronRight, Download, ClipboardList, Lock,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { LoadingBlock } from "../../components/LoadingProgress";
import { StatTiles, ReportCard, EmptyNote } from "../analytics/reportUi";
import { downloadCSV } from "../../lib/csvExport";
import {
  PAYMENT_METHOD_LABEL, isReturned, summariseInvoicePayments, todayInputValue,
} from "../../lib/invoicePayments";
import type {
  Invoice, InvoicePayment, InvoicePaymentMethod, ServiceJob,
} from "../../types/auth";

// The day's takings, in one page: what was billed, what actually came in and
// how, what work opened and closed. It is the sheet a workshop closes up with,
// so everything on it is scoped to a single day and nothing needs a date range.

interface ExpenseRow {
  id: string;
  date: Timestamp;
  category?: string;
  description?: string;
  amount: number;
}

function formatLKR(n: number): string {
  return `LKR ${n.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dayBounds(value: string): { start: Date; end: Date } {
  const [y, m, d] = value.split("-").map(Number);
  return {
    start: new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0),
    end: new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999),
  };
}

function shiftDay(value: string, days: number): string {
  const { start } = dayBounds(value);
  start.setDate(start.getDate() + days);
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
}

function longDate(value: string): string {
  return dayBounds(value).start.toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

function inDay(ts: Timestamp | undefined, start: Date, end: Date): boolean {
  const t = ts?.toMillis?.();
  return t !== undefined && t >= start.getTime() && t <= end.getTime();
}

export default function DailyReportPage() {
  const { currentUser } = useAuth();
  const centerId = currentUser?.centerId ?? "";
  const canViewInvoices = usePermission("invoices.view");
  const canViewRevenue = usePermission("analytics.viewRevenue");
  // Expenses are Owner/Manager-only in the security rules, so the query is
  // only ever made by a role that is allowed to read them.
  const canViewExpenses = currentUser?.role === "Owner" || currentUser?.role === "Manager";

  const [date, setDate] = useState(todayInputValue());
  // One state for the whole fetch, keyed by the day it belongs to: the page is
  // loading exactly while the key it holds isn't the day being shown, so
  // switching days can't leave yesterday's figures on screen.
  const [loaded, setLoaded] = useState<{
    key: string;
    invoices: Invoice[];
    jobs: ServiceJob[];
    expenses: ExpenseRow[];
    error: string;
  }>({ key: "", invoices: [], jobs: [], expenses: [], error: "" });

  const { start, end } = useMemo(() => dayBounds(date), [date]);
  const loading = loaded.key !== date;
  const error = loaded.key === date ? loaded.error : "";
  const fresh = loaded.key === date;
  const invoices = useMemo(() => (fresh ? loaded.invoices : []), [fresh, loaded.invoices]);
  const jobs = useMemo(() => (fresh ? loaded.jobs : []), [fresh, loaded.jobs]);
  const expenses = fresh ? loaded.expenses : [];

  useEffect(() => {
    if (!centerId || !canViewInvoices) return;
    let active = true;
    const from = Timestamp.fromDate(start);
    const to = Timestamp.fromDate(end);
    const invoiceCol = collection(db, "servicecenters", centerId, "invoices");
    const jobCol = collection(db, "servicecenters", centerId, "jobs");

    Promise.all([
      // Billed on the day…
      getDocs(query(invoiceCol, where("createdAt", ">=", from), where("createdAt", "<=", to))),
      // …and touched on the day, which is how a payment taken against an
      // older bill reaches this report.
      getDocs(query(invoiceCol, where("updatedAt", ">=", from), where("updatedAt", "<=", to))),
      getDocs(query(jobCol, where("createdAt", ">=", from), where("createdAt", "<=", to))),
      getDocs(query(jobCol, where("completedAt", ">=", from), where("completedAt", "<=", to))),
      canViewExpenses
        ? getDocs(query(
            collection(db, "servicecenters", centerId, "expenses"),
            where("date", ">=", from), where("date", "<=", to),
          ))
        : Promise.resolve(null),
    ]).then(([raised, touched, opened, closed, spent]) => {
      if (!active) return;
      const invById = new Map<string, Invoice>();
      [...raised.docs, ...touched.docs].forEach((d) => {
        const inv = { id: d.id, ...d.data() } as Invoice;
        if (!inv.isDeleted) invById.set(d.id, inv);
      });
      const jobById = new Map<string, ServiceJob>();
      [...opened.docs, ...closed.docs].forEach((d) => {
        const job = { id: d.id, ...d.data() } as ServiceJob;
        if (!job.isDeleted) jobById.set(d.id, job);
      });
      setLoaded({
        key: date,
        invoices: Array.from(invById.values()),
        jobs: Array.from(jobById.values()),
        expenses: spent ? spent.docs.map((d) => ({ id: d.id, ...d.data() } as ExpenseRow)) : [],
        error: "",
      });
    }).catch(() => {
      if (!active) return;
      setLoaded({
        key: date,
        invoices: [],
        jobs: [],
        expenses: [],
        error: "Could not load the day's figures. Please try again.",
      });
    });

    return () => { active = false; };
    // start/end are derived from `date`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerId, canViewInvoices, canViewExpenses, date]);

  // Bills written on this day.
  const raisedToday = useMemo(
    () => invoices
      .filter((inv) => inDay(inv.createdAt, start, end))
      .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0)),
    [invoices, start, end],
  );

  // Money that changed hands on this day, whichever bill it was against. A
  // bounced cheque is left out — it never became money.
  const paymentsToday = useMemo(() => {
    const rows: { invoice: Invoice; payment: InvoicePayment }[] = [];
    invoices.forEach((inv) => {
      (inv.payments ?? []).forEach((p) => {
        if (!isReturned(p) && inDay(p.date, start, end)) rows.push({ invoice: inv, payment: p });
      });
    });
    return rows.sort((a, b) => (a.payment.date?.toMillis?.() ?? 0) - (b.payment.date?.toMillis?.() ?? 0));
  }, [invoices, start, end]);

  const billedTotal = raisedToday.reduce((s, i) => s + (i.grandTotal ?? 0), 0);
  const outstandingOnToday = raisedToday.reduce((s, i) => {
    const summary = summariseInvoicePayments(i.payments, i.grandTotal ?? 0);
    return s + (i.payments?.length ? summary.balanceDue : Math.max(0, (i.grandTotal ?? 0) - (i.paidAmount ?? 0)));
  }, 0);

  // Credit is a promise, not takings, so it is counted apart from the cash.
  const receivedTotal = paymentsToday
    .filter(({ payment }) => payment.method !== "credit")
    .reduce((s, { payment }) => s + (payment.amount ?? 0), 0);
  const creditTotal = paymentsToday
    .filter(({ payment }) => payment.method === "credit")
    .reduce((s, { payment }) => s + (payment.amount ?? 0), 0);

  const byMethod = useMemo(() => {
    const map = new Map<InvoicePaymentMethod, number>();
    paymentsToday.forEach(({ payment }) => {
      map.set(payment.method, (map.get(payment.method) ?? 0) + (payment.amount ?? 0));
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [paymentsToday]);

  const jobsOpened = jobs.filter((j) => inDay(j.createdAt, start, end));
  const jobsCompleted = jobs.filter((j) => inDay(j.completedAt, start, end));
  const expenseTotal = expenses.reduce((s, e) => s + (e.amount ?? 0), 0);

  if (!canViewInvoices && !canViewRevenue) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <Lock className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to view the daily report.</p>
        </div>
      </div>
    );
  }

  function exportCsv() {
    const rows: string[][] = [
      ["Invoices raised", String(raisedToday.length), formatLKR(billedTotal)],
      ["Money received", String(paymentsToday.filter((p) => p.payment.method !== "credit").length), formatLKR(receivedTotal)],
      ["Credit given", "", formatLKR(creditTotal)],
      ["Outstanding on today's bills", "", formatLKR(outstandingOnToday)],
      ["Jobs opened", String(jobsOpened.length), ""],
      ["Jobs completed", String(jobsCompleted.length), ""],
      ...(canViewExpenses ? [["Expenses", String(expenses.length), formatLKR(expenseTotal)]] : []),
      [],
      ["Invoice", "Customer", "Vehicle", "Total", "Status"],
      ...raisedToday.map((i) => [
        i.invoiceNumber, i.customerName, i.plateNumber, String(i.grandTotal ?? 0), i.status,
      ]),
      [],
      ["Payment", "Invoice", "Method", "Amount"],
      ...paymentsToday.map(({ invoice, payment }) => [
        payment.date?.toDate?.().toLocaleTimeString("en-GB") ?? "",
        invoice.invoiceNumber,
        PAYMENT_METHOD_LABEL[payment.method],
        String(payment.amount ?? 0),
      ]),
    ];
    downloadCSV(`daily-report-${date}.csv`, ["Daily report", longDate(date), ""], rows);
  }

  return (
    <div className="min-h-screen bg-[#0B1120]">
      <PageHeader
        icon={<ClipboardList className="w-5 h-5" />}
        title="Daily Report"
        actions={
          <button
            onClick={exportCsv}
            className="flex items-center gap-1.5 text-xs font-medium bg-[#F97316]/10 hover:bg-[#F97316]/20 text-[#F97316] border border-[#F97316]/20 px-3 py-1.5 rounded-lg transition"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        }
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Day picker */}
        <div className="bg-[#162032] rounded-xl p-4 border border-white/5 flex flex-wrap items-center gap-3">
          <button
            onClick={() => setDate((d) => shiftDay(d, -1))}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300"
            aria-label="Previous day"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="relative">
            <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value || todayInputValue())}
              className="pl-9 pr-3 py-2 bg-white/5 border border-white/10 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
            />
          </div>
          <button
            onClick={() => setDate((d) => shiftDay(d, 1))}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300"
            aria-label="Next day"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => setDate(todayInputValue())}
            className="text-xs text-gray-400 hover:text-white px-2 py-1"
          >
            Today
          </button>
          <span className="text-sm text-gray-400 ml-auto">{longDate(date)}</span>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <LoadingBlock className="py-20" />
        ) : (
          <>
            <StatTiles
              tiles={[
                { label: "Invoices Raised", value: String(raisedToday.length), sub: formatLKR(billedTotal) },
                { label: "Money Received", value: formatLKR(receivedTotal), sub: `${paymentsToday.length} entries`, tone: "text-green-400" },
                { label: "Credit Given", value: formatLKR(creditTotal), tone: creditTotal > 0 ? "text-amber-400" : undefined },
                { label: "Still Due Today", value: formatLKR(outstandingOnToday), tone: outstandingOnToday > 0 ? "text-amber-400" : undefined },
              ]}
            />
            <StatTiles
              tiles={[
                { label: "Jobs Opened", value: String(jobsOpened.length) },
                { label: "Jobs Completed", value: String(jobsCompleted.length) },
                ...(canViewExpenses
                  ? [
                      { label: "Expenses", value: formatLKR(expenseTotal), sub: `${expenses.length} entries`, tone: "text-red-400" },
                      { label: "Net Cash", value: formatLKR(receivedTotal - expenseTotal), tone: receivedTotal - expenseTotal >= 0 ? "text-green-400" : "text-red-400" },
                    ]
                  : []),
              ]}
            />

            <ReportCard title="Money In, by Method">
              {byMethod.length === 0 ? (
                <EmptyNote>Nothing was taken on this day.</EmptyNote>
              ) : (
                <div className="space-y-2">
                  {byMethod.map(([method, amount]) => (
                    <div key={method} className="flex items-center justify-between text-sm border-b border-white/5 pb-2 last:border-0">
                      <span className="text-gray-300">{PAYMENT_METHOD_LABEL[method]}</span>
                      <span className={method === "credit" ? "text-amber-400" : "text-white"}>{formatLKR(amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </ReportCard>

            <ReportCard title={`Invoices Raised (${raisedToday.length})`}>
              {raisedToday.length === 0 ? (
                <EmptyNote>No invoices were raised on this day.</EmptyNote>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 uppercase tracking-wider text-left">
                        <th className="pb-2 pr-3">Invoice</th>
                        <th className="pb-2 pr-3">Customer</th>
                        <th className="pb-2 pr-3 hidden sm:table-cell">Vehicle</th>
                        <th className="pb-2 pr-3 text-right">Total</th>
                        <th className="pb-2 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {raisedToday.map((inv) => (
                        <tr key={inv.id}>
                          <td className="py-2 pr-3">
                            <Link to={`/invoices/${inv.id}`} className="font-mono text-orange-400 hover:text-orange-300">
                              {inv.invoiceNumber}
                            </Link>
                          </td>
                          <td className="py-2 pr-3 text-gray-300">{inv.customerName}</td>
                          <td className="py-2 pr-3 font-mono text-gray-400 hidden sm:table-cell">{inv.plateNumber}</td>
                          <td className="py-2 pr-3 text-right text-white">{formatLKR(inv.grandTotal ?? 0)}</td>
                          <td className="py-2 text-right text-gray-400 capitalize">{inv.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ReportCard>

            <ReportCard title={`Payments Taken (${paymentsToday.length})`}>
              {paymentsToday.length === 0 ? (
                <EmptyNote>No payments were recorded on this day.</EmptyNote>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 uppercase tracking-wider text-left">
                        <th className="pb-2 pr-3">Invoice</th>
                        <th className="pb-2 pr-3">Customer</th>
                        <th className="pb-2 pr-3">Method</th>
                        <th className="pb-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {paymentsToday.map(({ invoice, payment }) => (
                        <tr key={payment.id}>
                          <td className="py-2 pr-3">
                            <Link to={`/invoices/${invoice.id}`} className="font-mono text-orange-400 hover:text-orange-300">
                              {invoice.invoiceNumber}
                            </Link>
                          </td>
                          <td className="py-2 pr-3 text-gray-300">{invoice.customerName}</td>
                          <td className="py-2 pr-3 text-gray-400">{PAYMENT_METHOD_LABEL[payment.method]}</td>
                          <td className={`py-2 text-right ${payment.method === "credit" ? "text-amber-400" : "text-white"}`}>
                            {formatLKR(payment.amount ?? 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ReportCard>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ReportCard title={`Jobs Opened (${jobsOpened.length})`}>
                {jobsOpened.length === 0 ? (
                  <EmptyNote>No jobs were opened on this day.</EmptyNote>
                ) : (
                  <div className="space-y-2">
                    {jobsOpened.map((job) => (
                      <Link
                        key={job.id}
                        to={`/services/${job.id}`}
                        className="flex items-center justify-between text-sm border-b border-white/5 pb-2 last:border-0 hover:text-white"
                      >
                        <span className="font-mono text-orange-400">{job.plateNumber}</span>
                        <span className="text-gray-400 truncate ml-3">{job.customerName}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </ReportCard>

              <ReportCard title={`Jobs Completed (${jobsCompleted.length})`}>
                {jobsCompleted.length === 0 ? (
                  <EmptyNote>No jobs were completed on this day.</EmptyNote>
                ) : (
                  <div className="space-y-2">
                    {jobsCompleted.map((job) => (
                      <Link
                        key={job.id}
                        to={`/services/${job.id}`}
                        className="flex items-center justify-between text-sm border-b border-white/5 pb-2 last:border-0 hover:text-white"
                      >
                        <span className="font-mono text-orange-400">{job.plateNumber}</span>
                        <span className="text-gray-400 truncate ml-3">{job.customerName}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </ReportCard>
            </div>

            {canViewExpenses && (
              <ReportCard title={`Expenses (${expenses.length})`}>
                {expenses.length === 0 ? (
                  <EmptyNote>Nothing was spent on this day.</EmptyNote>
                ) : (
                  <div className="space-y-2">
                    {expenses.map((e) => (
                      <div key={e.id} className="flex items-center justify-between text-sm border-b border-white/5 pb-2 last:border-0">
                        <div className="min-w-0">
                          <div className="text-gray-300 truncate">{e.description || e.category || "Expense"}</div>
                          {e.category && <div className="text-xs text-gray-600">{e.category}</div>}
                        </div>
                        <span className="text-red-400 whitespace-nowrap ml-3">{formatLKR(e.amount ?? 0)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </ReportCard>
            )}
          </>
        )}
      </div>
    </div>
  );
}
