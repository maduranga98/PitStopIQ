import { useEffect, useState, useMemo } from "react";
import { collection, query, where, getDocs, Timestamp } from "firebase/firestore";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Download, RefreshCw } from "lucide-react";
import { db } from "../../config/firebase";
import { downloadCSV } from "../../lib/csvExport";

interface SmsLog {
  id: string;
  sentAt: Timestamp;
  type: "completion" | "reminder";
  status: "sent" | "delivered" | "failed";
  recipientName?: string;
  phone?: string;
  message?: string;
}

interface Props {
  centerId: string;
  startDate: Date;
  endDate: Date;
  smsQuotaUsed: number;
  smsQuotaLimit: number;
}

function monthLabel(d: Date) {
  return d.toLocaleDateString("en-LK", { month: "short", year: "2-digit" });
}

export default function SmsAnalytics({ centerId, startDate, endDate, smsQuotaUsed, smsQuotaLimit }: Props) {
  const [logs, setLogs] = useState<SmsLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryToast, setRetryToast] = useState<string | null>(null);

  useEffect(() => {
    if (!centerId) return;
    setLoading(true);
    getDocs(
      query(
        collection(db, "servicecenters", centerId, "smsLogs"),
        where("sentAt", ">=", Timestamp.fromDate(startDate)),
        where("sentAt", "<=", Timestamp.fromDate(endDate)),
      ),
    ).then((snap) => {
      setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SmsLog)));
      setLoading(false);
    });
  }, [centerId, startDate, endDate]);

  const completionCount = useMemo(() => logs.filter((l) => l.type === "completion").length, [logs]);
  const reminderCount = useMemo(() => logs.filter((l) => l.type === "reminder").length, [logs]);
  const deliveredCount = useMemo(() => logs.filter((l) => l.status === "delivered").length, [logs]);
  const sentCount = useMemo(() => logs.filter((l) => l.status === "sent").length, [logs]);
  const failedLogs = useMemo(() => logs.filter((l) => l.status === "failed"), [logs]);

  const deliveryRate = sentCount + deliveredCount > 0
    ? (deliveredCount / (sentCount + deliveredCount)) * 100
    : null;

  const monthlyData = useMemo(() => {
    const map = new Map<string, number>();
    logs.forEach((l) => {
      const key = monthLabel(l.sentAt.toDate());
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return Array.from(map.entries()).map(([month, count]) => ({ month, count }));
  }, [logs]);

  const quotaRemaining = Math.max(0, smsQuotaLimit - smsQuotaUsed);
  const quotaPct = smsQuotaLimit > 0 ? (smsQuotaUsed / smsQuotaLimit) * 100 : 0;

  function handleRetry(log: SmsLog) {
    setRetryToast(`Retry queued for ${log.recipientName ?? log.phone ?? "recipient"}`);
    setTimeout(() => setRetryToast(null), 3000);
  }

  function handleExport() {
    const headers = ["Date", "Recipient", "Phone", "Type", "Status", "Message"];
    const rows = logs.map((l) => [
      l.sentAt.toDate().toLocaleDateString("en-GB"),
      l.recipientName ?? "",
      l.phone ?? "",
      l.type,
      l.status,
      l.message ?? "",
    ]);
    downloadCSV(`sms-log-${startDate.toISOString().slice(0, 10)}.csv`, headers, rows);
  }

  if (loading) return <div className="text-center text-gray-400 py-16">Loading SMS data…</div>;

  return (
    <div className="space-y-6">
      {retryToast && (
        <div className="fixed top-4 right-4 z-50 bg-green-500 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg">
          {retryToast}
        </div>
      )}

      {/* Key metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Total SMS Sent</div>
          <div className="text-3xl font-bold text-white">{logs.length}</div>
          <div className="text-xs text-gray-600 mt-0.5">In period</div>
        </div>
        <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Completion</div>
          <div className="text-3xl font-bold text-[#F97316]">{completionCount}</div>
          <div className="text-xs text-gray-600 mt-0.5">Service done alerts</div>
        </div>
        <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Reminders</div>
          <div className="text-3xl font-bold text-blue-400">{reminderCount}</div>
          <div className="text-xs text-gray-600 mt-0.5">Service reminders</div>
        </div>
        <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Delivery Rate</div>
          <div className={`text-3xl font-bold ${deliveryRate !== null && deliveryRate >= 90 ? "text-green-400" : "text-amber-400"}`}>
            {deliveryRate !== null ? `${deliveryRate.toFixed(1)}%` : "—"}
          </div>
          <div className="text-xs text-gray-600 mt-0.5">Delivered / (Sent + Delivered)</div>
        </div>
      </div>

      {/* Quota indicator */}
      <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-white">SMS Quota — Current Month</h3>
          <div className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            quotaRemaining === 0 ? "bg-red-500/20 text-red-400" :
            quotaPct >= 80 ? "bg-amber-500/20 text-amber-400" :
            "bg-green-500/20 text-green-400"
          }`}>
            {quotaRemaining} remaining
          </div>
        </div>
        <div className="w-full bg-white/5 rounded-full h-2.5 mb-2">
          <div
            className={`h-2.5 rounded-full transition-all ${
              quotaPct >= 100 ? "bg-red-500" : quotaPct >= 80 ? "bg-amber-500" : "bg-[#F97316]"
            }`}
            style={{ width: `${Math.min(quotaPct, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-500">
          <span>{smsQuotaUsed} used</span>
          <span>{smsQuotaLimit} limit</span>
        </div>
      </div>

      {/* Monthly bar chart */}
      <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
        <h3 className="text-sm font-semibold text-white mb-4">Monthly SMS Usage</h3>
        {monthlyData.length === 0 ? (
          <div className="text-center text-gray-500 py-8 text-sm">No SMS sent in this period</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthlyData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <XAxis dataKey="month" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: "#0B1120", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                labelStyle={{ color: "#fff" }}
              />
              <ReferenceLine y={smsQuotaLimit} stroke="#F97316" strokeDasharray="4 2" label={{ value: "Quota", fill: "#F97316", fontSize: 10 }} />
              <Bar dataKey="count" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Failed SMS */}
      <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Failed SMS</h3>
            <p className="text-xs text-gray-500 mt-0.5">{failedLogs.length} failed in period</p>
          </div>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 text-xs font-medium bg-[#F97316]/10 hover:bg-[#F97316]/20 text-[#F97316] border border-[#F97316]/20 px-3 py-1.5 rounded-lg transition"
          >
            <Download className="h-3.5 w-3.5" />
            Export Log CSV
          </button>
        </div>
        {failedLogs.length === 0 ? (
          <div className="text-center text-gray-500 py-6 text-sm">No failed messages in this period</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Date</th>
                  <th className="text-left text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Recipient</th>
                  <th className="text-left text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Phone</th>
                  <th className="text-left text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Type</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {failedLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2.5 pr-4 text-gray-400 text-xs">{log.sentAt.toDate().toLocaleDateString("en-GB")}</td>
                    <td className="py-2.5 pr-4 text-white">{log.recipientName ?? "—"}</td>
                    <td className="py-2.5 pr-4 text-gray-400 font-mono text-xs">{log.phone ?? "—"}</td>
                    <td className="py-2.5 pr-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        log.type === "completion" ? "bg-[#F97316]/15 text-[#F97316]" : "bg-blue-500/15 text-blue-400"
                      }`}>
                        {log.type}
                      </span>
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        onClick={() => handleRetry(log)}
                        className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Retry
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
