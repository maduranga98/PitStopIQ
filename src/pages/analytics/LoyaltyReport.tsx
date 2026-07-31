import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, Timestamp, where } from "firebase/firestore";
import { db } from "../../config/firebase";
import { downloadCSV } from "../../lib/csvExport";
import { CHART_TOOLTIP_STYLE, formatDate, formatLKR } from "../../lib/reportFormat";
import { EmptyNote, ReportCard, StatTiles } from "./reportUi";
import {
  Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell,
} from "recharts";

// Marketing lens on the customer base: who keeps coming back, whose vehicle
// is about to need its next service, and whether the reminder SMS we send
// actually brings people in. Loyalty tiers and mileage progress are a
// trailing-12-month snapshot (not tied to the page's date range) since "who
// is loyal" shouldn't reset just because someone picked "this month"; the
// reminder log below is scoped to the selected period like the other reports.

interface Props {
  centerId: string;
  startDate: Date;
  endDate: Date;
  reminderThresholdKm?: number;
}

interface CustomerDoc {
  id: string;
  name: string;
  phone?: string;
  isDeleted?: boolean;
  lastServiceDate?: Timestamp | null;
}

interface VehicleDoc {
  id: string;
  plateNumber: string;
  customerId: string;
  customerName: string;
  currentMileageKm?: number;
  nextServiceMileageKm?: number;
  nextServiceDate?: Timestamp | null;
  isDeleted?: boolean;
}

interface JobDoc {
  id: string;
  customerId: string;
  createdAt: Timestamp;
}

interface InvoiceDoc {
  id: string;
  customerId: string;
  status: "paid" | "pending" | "partial";
  grandTotal: number;
  createdAt: Timestamp;
}

interface SmsLogDoc {
  id: string;
  customerId?: string;
  customerName: string;
  phone: string;
  plateNumber?: string;
  status: "sent" | "delivered" | "failed" | "pending_blackout";
  sentAt: Timestamp;
}

interface Loaded {
  key: string;
  customers: CustomerDoc[];
  vehicles: VehicleDoc[];
  yearJobs: JobDoc[];
  yearInvoices: InvoiceDoc[];
  reminders: SmsLogDoc[];
  error: string;
}

type Tier = "Platinum" | "Gold" | "Silver";

const TIER_STYLE: Record<Tier, string> = {
  Platinum: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  Gold: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Silver: "bg-gray-400/15 text-gray-300 border-gray-400/30",
};

function tierFor(visits: number): Tier | null {
  if (visits >= 6) return "Platinum";
  if (visits >= 3) return "Gold";
  if (visits >= 1) return "Silver";
  return null;
}

function yearAgo(from: Date): Date {
  const d = new Date(from);
  d.setDate(d.getDate() - 365);
  return d;
}

export default function LoyaltyReport({ centerId, startDate, endDate, reminderThresholdKm }: Props) {
  const threshold = reminderThresholdKm && reminderThresholdKm > 0 ? reminderThresholdKm : 500;

  // Held together with the range it was fetched for, so a slow reply for an
  // old range can never overwrite a newer one.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const rangeKey = `${centerId}:${startDate.getTime()}:${endDate.getTime()}`;

  useEffect(() => {
    if (!centerId) return;
    const trailingStart = yearAgo(new Date());
    Promise.all([
      getDocs(collection(db, "servicecenters", centerId, "customers")),
      getDocs(collection(db, "servicecenters", centerId, "vehicles")),
      getDocs(query(
        collection(db, "servicecenters", centerId, "jobs"),
        where("createdAt", ">=", Timestamp.fromDate(trailingStart)),
      )),
      getDocs(query(
        collection(db, "servicecenters", centerId, "invoices"),
        where("createdAt", ">=", Timestamp.fromDate(trailingStart)),
        where("status", "==", "paid"),
      )),
      // Filtered by messageType alone (single-field, auto-indexed) and bounded
      // to the selected period on the client — a messageType + sentAt-range
      // compound query needs a composite index that isn't guaranteed to exist
      // yet in every deployment.
      getDocs(query(
        collection(db, "servicecenters", centerId, "smsLogs"),
        where("messageType", "==", "Reminder"),
      )),
    ]).then(([custSnap, vehSnap, jobSnap, invSnap, smsSnap]) => {
      const startMs = startDate.getTime();
      const endMs = endDate.getTime();
      setLoaded({
        key: rangeKey,
        customers: custSnap.docs.map(d => ({ id: d.id, ...d.data() } as CustomerDoc)).filter(c => !c.isDeleted),
        vehicles: vehSnap.docs.map(d => ({ id: d.id, ...d.data() } as VehicleDoc)).filter(v => !v.isDeleted),
        yearJobs: jobSnap.docs.map(d => ({ id: d.id, ...d.data() } as JobDoc)),
        yearInvoices: invSnap.docs.map(d => ({ id: d.id, ...d.data() } as InvoiceDoc)),
        reminders: smsSnap.docs
          .map(d => ({ id: d.id, ...d.data() } as SmsLogDoc))
          .filter(r => { const t = r.sentAt?.toMillis?.() ?? 0; return t >= startMs && t <= endMs; }),
        error: "",
      });
    }).catch((err) => {
      setLoaded({ key: rangeKey, customers: [], vehicles: [], yearJobs: [], yearInvoices: [], reminders: [], error: `Could not load loyalty data: ${err?.message ?? err}` });
    });
    // startDate/endDate are folded into rangeKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, centerId]);

  const fresh = loaded?.key === rangeKey ? loaded : null;
  const loading = fresh === null;
  const error = fresh?.error ?? "";
  const customers = useMemo(() => fresh?.customers ?? [], [fresh]);
  const vehicles = useMemo(() => fresh?.vehicles ?? [], [fresh]);
  const yearJobs = useMemo(() => fresh?.yearJobs ?? [], [fresh]);
  const yearInvoices = useMemo(() => fresh?.yearInvoices ?? [], [fresh]);
  const reminders = useMemo(() => fresh?.reminders ?? [], [fresh]);

  // ── Loyalty tiers, trailing 12 months ──
  const visitsByCustomer = useMemo(() => {
    const map = new Map<string, number>();
    yearJobs.forEach(j => map.set(j.customerId, (map.get(j.customerId) ?? 0) + 1));
    return map;
  }, [yearJobs]);

  const spendByCustomer = useMemo(() => {
    const map = new Map<string, number>();
    yearInvoices.forEach(inv => map.set(inv.customerId, (map.get(inv.customerId) ?? 0) + inv.grandTotal));
    return map;
  }, [yearInvoices]);

  const loyalCustomers = useMemo(() => {
    return customers
      .map(c => {
        const visits = visitsByCustomer.get(c.id) ?? 0;
        return {
          customer: c,
          visits,
          spend: spendByCustomer.get(c.id) ?? 0,
          tier: tierFor(visits),
        };
      })
      .filter(r => r.tier !== null)
      .sort((a, b) => b.visits - a.visits || b.spend - a.spend) as {
        customer: CustomerDoc; visits: number; spend: number; tier: Tier;
      }[];
  }, [customers, visitsByCustomer, spendByCustomer]);

  const tierCounts = useMemo(() => {
    const counts: Record<Tier, number> = { Platinum: 0, Gold: 0, Silver: 0 };
    loyalCustomers.forEach(r => { counts[r.tier] += 1; });
    return counts;
  }, [loyalCustomers]);

  function exportLoyalCustomers() {
    downloadCSV(
      "loyal-customers.csv",
      ["Name", "Phone", "Tier", "Visits (12mo)", "Spend (12mo, LKR)", "Last Service"],
      loyalCustomers.map(r => [
        r.customer.name, r.customer.phone ?? "", r.tier, String(r.visits), r.spend.toFixed(2),
        r.customer.lastServiceDate ? r.customer.lastServiceDate.toDate().toLocaleDateString("en-GB") : "",
      ]),
    );
  }

  // ── Mileage progress toward next service ──
  const now = Date.now();
  const mileageRows = useMemo(() => {
    return vehicles
      .filter(v => (v.nextServiceMileageKm ?? 0) > 0)
      .map(v => {
        const current = v.currentMileageKm ?? 0;
        const target = v.nextServiceMileageKm ?? 0;
        const remainingKm = target - current;
        const progressPct = target > 0 ? Math.min(100, Math.max(0, (current / target) * 100)) : 0;
        const dateSoon = v.nextServiceDate ? v.nextServiceDate.toMillis() - now <= 14 * 86400000 : false;
        const status: "Overdue" | "Due Soon" | "On Track" =
          remainingKm <= 0 ? "Overdue" : (remainingKm <= threshold || dateSoon) ? "Due Soon" : "On Track";
        return { vehicle: v, current, target, remainingKm, progressPct, status };
      })
      .filter(r => r.status !== "On Track")
      .sort((a, b) => a.remainingKm - b.remainingKm);
  }, [vehicles, threshold, now]);

  const overdueCount = useMemo(() => mileageRows.filter(r => r.status === "Overdue").length, [mileageRows]);

  function exportDueVehicles() {
    downloadCSV(
      "vehicles-due-for-service.csv",
      ["Plate", "Customer", "Current KM", "Next Service KM", "Remaining KM", "Next Service Date", "Status"],
      mileageRows.map(r => [
        r.vehicle.plateNumber, r.vehicle.customerName, String(r.current), String(r.target), String(r.remainingKm),
        r.vehicle.nextServiceDate ? r.vehicle.nextServiceDate.toDate().toLocaleDateString("en-GB") : "",
        r.status,
      ]),
    );
  }

  // ── Reminder campaign performance, scoped to the selected period ──
  const reminderRows = useMemo(() => {
    return reminders
      .map(r => {
        const returned = r.customerId
          ? yearJobs.some(j => j.customerId === r.customerId && j.createdAt.toMillis() > r.sentAt.toMillis())
          : false;
        return { reminder: r, returned };
      })
      .sort((a, b) => b.reminder.sentAt.toMillis() - a.reminder.sentAt.toMillis());
  }, [reminders, yearJobs]);

  const remindersDelivered = useMemo(
    () => reminders.filter(r => r.status === "delivered" || r.status === "sent").length,
    [reminders],
  );
  const remindersReturned = useMemo(() => reminderRows.filter(r => r.returned).length, [reminderRows]);
  const returnRate = remindersDelivered > 0 ? (remindersReturned / remindersDelivered) * 100 : null;

  function exportReminders() {
    downloadCSV(
      `reminder-performance-${startDate.toISOString().slice(0, 10)}.csv`,
      ["Sent", "Customer", "Phone", "Vehicle", "Status", "Returned After Reminder"],
      reminderRows.map(({ reminder: r, returned }) => [
        r.sentAt.toDate().toLocaleDateString("en-GB"), r.customerName, r.phone, r.plateNumber ?? "",
        r.status, returned ? "Yes" : "No",
      ]),
    );
  }

  const tierChartData = useMemo(() => ([
    { name: "Platinum", value: tierCounts.Platinum, fill: "#c084fc" },
    { name: "Gold", value: tierCounts.Gold, fill: "#fbbf24" },
    { name: "Silver", value: tierCounts.Silver, fill: "#9ca3af" },
  ]), [tierCounts]);

  if (loading) {
    return <div className="text-center text-gray-400 py-16">Loading loyalty data…</div>;
  }
  if (error) {
    return <div className="text-center text-red-400 py-16 text-sm">{error}</div>;
  }

  return (
    <div className="space-y-6">
      <StatTiles
        tiles={[
          { label: "Loyal Customers", value: String(loyalCustomers.length), sub: "3+ visits in last 12 months" },
          { label: "Vehicles Due Soon", value: String(mileageRows.length), sub: `${overdueCount} already overdue` },
          { label: "Reminders Sent", value: String(reminders.length), sub: "In selected period" },
          {
            label: "Reminder Return Rate",
            value: returnRate !== null ? `${returnRate.toFixed(0)}%` : "—",
            sub: returnRate !== null ? `${remindersReturned} of ${remindersDelivered} came back` : "No reminders delivered yet",
          },
        ]}
      />

      <ReportCard title="Loyal Customers" onExport={loyalCustomers.length > 0 ? exportLoyalCustomers : undefined}>
        {loyalCustomers.length === 0 ? (
          <EmptyNote>No customers with 3+ visits in the last 12 months yet</EmptyNote>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={tierChartData} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: "#9ca3af", fontSize: 12 }} axisLine={false} tickLine={false} width={70} />
                <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={{ color: "#fff" }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {tierChartData.map(d => <Cell key={d.name} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Customer</th>
                    <th className="text-left text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Tier</th>
                    <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Visits</th>
                    <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Spend</th>
                    <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2">Last Service</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {loyalCustomers.slice(0, 25).map(r => (
                    <tr key={r.customer.id}>
                      <td className="py-2.5 pr-4">
                        <div className="text-white">{r.customer.name}</div>
                        <div className="text-xs text-gray-500 font-mono">{r.customer.phone ?? "—"}</div>
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className={`text-xs font-medium border rounded-full px-2 py-0.5 ${TIER_STYLE[r.tier]}`}>
                          {r.tier}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-right text-white font-medium">{r.visits}</td>
                      <td className="py-2.5 pr-4 text-right text-[#F97316] font-medium">{formatLKR(r.spend)}</td>
                      <td className="py-2.5 text-right text-gray-400 text-xs">{formatDate(r.customer.lastServiceDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {loyalCustomers.length > 25 && (
                <p className="text-xs text-gray-600 mt-3">
                  Showing the top 25 of {loyalCustomers.length} loyal customers — export the CSV for the full list.
                </p>
              )}
            </div>
          </>
        )}
      </ReportCard>

      <ReportCard title="Approaching Next Service" onExport={mileageRows.length > 0 ? exportDueVehicles : undefined}>
        {mileageRows.length === 0 ? (
          <EmptyNote>No vehicles are due or approaching their next service</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Vehicle</th>
                  <th className="text-left text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Customer</th>
                  <th className="text-left text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4 w-40">Progress</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Remaining</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Next Service Date</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {mileageRows.slice(0, 30).map(r => (
                  <tr key={r.vehicle.id}>
                    <td className="py-2.5 pr-4 text-white font-mono text-xs">{r.vehicle.plateNumber}</td>
                    <td className="py-2.5 pr-4 text-gray-300">{r.vehicle.customerName}</td>
                    <td className="py-2.5 pr-4">
                      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${r.status === "Overdue" ? "bg-red-500" : "bg-amber-400"}`}
                          style={{ width: `${r.progressPct}%` }}
                        />
                      </div>
                    </td>
                    <td className={`py-2.5 pr-4 text-right font-medium ${r.remainingKm <= 0 ? "text-red-400" : "text-amber-400"}`}>
                      {r.remainingKm <= 0 ? `${Math.abs(r.remainingKm).toLocaleString()} km over` : `${r.remainingKm.toLocaleString()} km`}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-gray-400 text-xs">{formatDate(r.vehicle.nextServiceDate)}</td>
                    <td className="py-2.5 text-right">
                      <span className={`text-xs font-medium border rounded-full px-2 py-0.5 ${
                        r.status === "Overdue"
                          ? "bg-red-500/15 text-red-300 border-red-500/30"
                          : "bg-amber-500/15 text-amber-300 border-amber-500/30"
                      }`}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {mileageRows.length > 30 && (
              <p className="text-xs text-gray-600 mt-3">
                Showing the top 30 of {mileageRows.length} vehicles due — export the CSV for the full list.
              </p>
            )}
          </div>
        )}
      </ReportCard>

      <ReportCard title="Reminder Campaign Performance" onExport={reminderRows.length > 0 ? exportReminders : undefined}>
        {reminderRows.length === 0 ? (
          <EmptyNote>No reminder SMS were sent in this period</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Sent</th>
                  <th className="text-left text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Customer</th>
                  <th className="text-left text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Vehicle</th>
                  <th className="text-left text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Status</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2">Came Back?</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {reminderRows.slice(0, 50).map(({ reminder: r, returned }) => (
                  <tr key={r.id}>
                    <td className="py-2.5 pr-4 text-gray-400 text-xs">{r.sentAt.toDate().toLocaleDateString("en-GB")}</td>
                    <td className="py-2.5 pr-4 text-white">{r.customerName}</td>
                    <td className="py-2.5 pr-4 text-gray-400 font-mono text-xs">{r.plateNumber ?? "—"}</td>
                    <td className="py-2.5 pr-4">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        r.status === "failed" ? "bg-red-500/15 text-red-300" : "bg-white/5 text-gray-300"
                      }`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2.5 text-right">
                      {returned
                        ? <span className="text-xs font-medium text-green-400">Yes</span>
                        : <span className="text-xs text-gray-600">Not yet</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {reminderRows.length > 50 && (
              <p className="text-xs text-gray-600 mt-3">
                Showing the latest 50 of {reminderRows.length} reminders — export the CSV for the full list.
              </p>
            )}
          </div>
        )}
      </ReportCard>
    </div>
  );
}
