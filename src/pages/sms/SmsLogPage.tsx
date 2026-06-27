import { useEffect, useState } from "react";
import {
  collection, query, orderBy, onSnapshot, updateDoc, doc, Timestamp,
} from "firebase/firestore";
import {
  MessageSquare, Filter, Download, RefreshCw,
  CheckCircle2, Clock, AlertTriangle, ChevronDown,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import type { SmsLog } from "../../types/auth";

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: typeof Clock }> = {
  sent:              { label: "Sent",       color: "text-blue-400",   bg: "bg-blue-500/15",   icon: Clock },
  delivered:         { label: "Delivered",  color: "text-green-400",  bg: "bg-green-500/15",  icon: CheckCircle2 },
  failed:            { label: "Failed",     color: "text-red-400",    bg: "bg-red-500/15",    icon: AlertTriangle },
  pending_blackout:  { label: "Queued (blackout)", color: "text-amber-400", bg: "bg-amber-500/15", icon: Clock },
};
const UNKNOWN_STATUS = { label: "Unknown", color: "text-gray-400", bg: "bg-gray-500/15", icon: AlertTriangle };

function formatTs(ts: Timestamp): string {
  return ts.toDate().toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function SmsLogPage() {
  const { currentUser } = useAuth();
  const canViewLog    = usePermission("sms.viewLog");
  const canSendManual = usePermission("sms.sendManual");
  const canExportCsv  = usePermission("analytics.exportCsv");

  const [logs, setLogs] = useState<SmsLog[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [typeFilter, setTypeFilter] = useState<"All" | "Completion" | "Reminder">("All");
  const [statusFilter, setStatusFilter] = useState<"All" | "sent" | "delivered" | "failed" | "pending_blackout">("All");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // Retry state
  const [retrying, setRetrying] = useState<string | null>(null);

  const centerId = currentUser?.centerId;

  useEffect(() => {
    if (!centerId) return;
    const q = query(
      collection(db, "servicecenters", centerId, "smsLogs"),
      orderBy("sentAt", "desc"),
    );
    const unsub = onSnapshot(q, (snap) => {
      setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SmsLog)));
      setLoading(false);
    });
    return unsub;
  }, [centerId]);

  // Filtered logs
  const filtered = logs.filter((l) => {
    if (typeFilter !== "All" && l.messageType !== typeFilter) return false;
    if (statusFilter !== "All" && l.status !== statusFilter) return false;
    if (fromDate) {
      const from = new Date(fromDate);
      from.setHours(0, 0, 0, 0);
      if (l.sentAt.toDate() < from) return false;
    }
    if (toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      if (l.sentAt.toDate() > to) return false;
    }
    return true;
  });

  const handleRetry = async (log: SmsLog) => {
    if (!centerId) return;
    setRetrying(log.id);
    try {
      // In production: call a Firebase callable function to re-send.
      // For now, reset status to "sent" and update sentAt.
      await updateDoc(doc(db, "servicecenters", centerId, "smsLogs", log.id), {
        status: "sent",
        sentAt: Timestamp.now(),
        errorCode: null,
      });
    } catch {
      // silently ignore
    }
    setRetrying(null);
  };

  const handleExportCsv = () => {
    const header = ["Date/Time", "Customer Name", "Phone", "Plate", "Type", "Status", "Sender", "Txn ID", "Campaign ID", "Message"];
    const rows = filtered.map((l) => [
      formatTs(l.sentAt),
      l.customerName ?? "",
      l.phone,
      l.plateNumber ?? "",
      l.messageType,
      l.status,
      l.senderMask ?? "",
      l.esmsTransactionId ?? "",
      l.esmsCampaignId ?? "",
      `"${l.message.replace(/"/g, '""')}"`,
    ]);
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sms-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasActiveFilters = typeFilter !== "All" || statusFilter !== "All" || fromDate || toDate;

  if (!canViewLog) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <MessageSquare className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to view SMS logs.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<MessageSquare className="w-5 h-5" />}
        title="SMS Log"
        actions={
          <>
            {canExportCsv && filtered.length > 0 && (
              <button
                onClick={handleExportCsv}
                className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg text-sm"
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
            )}
            <button
              onClick={() => setShowFilters((p) => !p)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition ${hasActiveFilters ? "bg-orange-500/20 text-orange-400 border border-orange-500/30" : "bg-white/10 hover:bg-white/20 text-white"}`}
            >
              <Filter className="w-4 h-4" />
              Filters
              {hasActiveFilters && <span className="ml-1 bg-orange-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">!</span>}
              <ChevronDown className={`w-3.5 h-3.5 transition ${showFilters ? "rotate-180" : ""}`} />
            </button>
          </>
        }
        below={
          showFilters ? (
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Type</label>
                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
                    className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-orange-500"
                  >
                    <option value="All">All Types</option>
                    <option value="Completion">Completion</option>
                    <option value="Reminder">Reminder</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Status</label>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                    className="w-full bg-white/5 border border-white/10 text-sm text-white rounded-lg px-3 py-1.5 focus:outline-none focus:border-orange-500"
                  >
                    <option value="All">All Statuses</option>
                    <option value="sent">Sent</option>
                    <option value="delivered">Delivered</option>
                    <option value="failed">Failed</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">From</label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">To</label>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-orange-500"
                  />
                </div>
                {hasActiveFilters && (
                  <button
                    onClick={() => { setTypeFilter("All"); setStatusFilter("All"); setFromDate(""); setToDate(""); }}
                    className="col-span-2 sm:col-span-4 text-xs text-gray-400 hover:text-white underline text-left"
                  >
                    Clear all filters
                  </button>
                )}
              </div>
            </div>
          ) : undefined
        }
      />

      <div className="max-w-5xl mx-auto px-4 py-6">
        {loading ? (
          <div className="text-center text-gray-500 py-16">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <MessageSquare className="w-12 h-12 text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">{hasActiveFilters ? "No SMS logs match your filters." : "No SMS messages sent yet."}</p>
          </div>
        ) : (
          <>
            <div className="text-xs text-gray-500 mb-3">{filtered.length} message{filtered.length !== 1 ? "s" : ""}</div>

            {/* Desktop table */}
            <div className="hidden md:block bg-[#162032] border border-white/10 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-xs text-gray-500 uppercase tracking-wider">
                    <th className="text-left px-4 py-3">Date / Time</th>
                    <th className="text-left px-4 py-3">Customer</th>
                    <th className="text-left px-4 py-3">Phone</th>
                    <th className="text-left px-4 py-3">Plate</th>
                    <th className="text-left px-4 py-3">Type</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="text-left px-4 py-3">Message</th>
                    {canSendManual && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((log, i) => {
                    const sc = STATUS_CONFIG[log.status] ?? UNKNOWN_STATUS;
                    const Icon = sc.icon;
                    return (
                      <tr key={log.id} className={`border-b border-white/5 hover:bg-white/5 transition ${i % 2 === 0 ? "" : "bg-white/[0.02]"}`}>
                        <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{formatTs(log.sentAt)}</td>
                        <td className="px-4 py-3 text-white font-medium">{log.customerName ?? "—"}</td>
                        <td className="px-4 py-3 text-gray-300">{log.phone}</td>
                        <td className="px-4 py-3 text-gray-300 font-mono">{log.plateNumber ?? "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${log.messageType === "Completion" ? "bg-green-500/15 text-green-400" : "bg-blue-500/15 text-blue-400"}`}>
                            {log.messageType}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`flex items-center gap-1.5 text-xs ${sc.color}`}>
                            <Icon className="w-3.5 h-3.5" />
                            {sc.label}
                          </span>
                          {log.status === "failed" && log.errorCode && (
                            <span
                              title={typeof log.providerResponse === "string"
                                ? log.providerResponse
                                : log.providerResponse
                                  ? JSON.stringify(log.providerResponse)
                                  : log.errorCode}
                              className="block text-[10px] text-red-300 mt-0.5"
                            >
                              {log.errorCode}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-400 max-w-[240px]" title={log.message}>
                          <div className="truncate">{log.message}</div>
                          <div className="mt-1 text-[10px] text-gray-500 space-y-0.5">
                            <div>Sender: <span className="text-gray-300 font-mono">{log.senderMask ?? "—"}</span></div>
                            {log.esmsTransactionId && (
                              <div>Txn: <span className="text-gray-400 font-mono">{log.esmsTransactionId}</span></div>
                            )}
                            {log.esmsCampaignId && (
                              <div>Campaign: <span className="text-gray-400 font-mono">{log.esmsCampaignId}</span></div>
                            )}
                          </div>
                        </td>
                        {canSendManual && (
                          <td className="px-4 py-3">
                            {log.status === "failed" && (
                              <button
                                onClick={() => handleRetry(log)}
                                disabled={retrying === log.id}
                                className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 disabled:opacity-50"
                              >
                                <RefreshCw className={`w-3.5 h-3.5 ${retrying === log.id ? "animate-spin" : ""}`} />
                                Retry
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {filtered.map((log) => {
                const sc = STATUS_CONFIG[log.status] ?? UNKNOWN_STATUS;
                const Icon = sc.icon;
                return (
                  <div key={log.id} className="bg-[#162032] border border-white/10 rounded-xl p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium text-white text-sm">{log.customerName ?? log.phone}</div>
                        <div className="text-xs text-gray-500">{log.phone} {log.plateNumber ? `· ${log.plateNumber}` : ""}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={`flex items-center gap-1 text-xs ${sc.color}`}>
                          <Icon className="w-3 h-3" />
                          {sc.label}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${log.messageType === "Completion" ? "bg-green-500/15 text-green-400" : "bg-blue-500/15 text-blue-400"}`}>
                          {log.messageType}
                        </span>
                      </div>
                    </div>
                    <div className="text-xs text-gray-400 line-clamp-2">{log.message}</div>
                    <div className="text-[10px] text-gray-500 space-y-0.5">
                      <div>Sender: <span className="text-gray-300 font-mono">{log.senderMask ?? "—"}</span></div>
                      {log.esmsTransactionId && (
                        <div>Txn: <span className="text-gray-400 font-mono">{log.esmsTransactionId}</span></div>
                      )}
                      {log.esmsCampaignId && (
                        <div>Campaign: <span className="text-gray-400 font-mono">{log.esmsCampaignId}</span></div>
                      )}
                    </div>
                    {log.status === "failed" && log.errorCode && (
                      <div className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/20 rounded px-2 py-1">
                        {log.errorCode}
                        {typeof log.providerResponse === "string" && log.providerResponse && (
                          <span className="block text-gray-400 mt-0.5">{log.providerResponse}</span>
                        )}
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-600">{formatTs(log.sentAt)}</span>
                      {canSendManual && log.status === "failed" && (
                        <button
                          onClick={() => handleRetry(log)}
                          disabled={retrying === log.id}
                          className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${retrying === log.id ? "animate-spin" : ""}`} />
                          Retry
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
