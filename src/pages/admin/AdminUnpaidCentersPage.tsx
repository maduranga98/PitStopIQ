import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../../config/firebase";
import { AlertTriangle, BellRing, ChevronRight, Clock, Send } from "lucide-react";
import type { ServiceCenter } from "../../types/auth";
import type { Timestamp } from "firebase/firestore";
import { sendPaymentReminderSms } from "../../lib/adminSms";

/** "Owner — Branch Name" when the center is a multi-branch owner's
 * additional branch, otherwise just the center's own name. */
function centerLabel(c: ServiceCenter): string {
  const branchLabel = c.branchName ?? c.name;
  return c.isBranch && c.ownerName ? `${c.ownerName} — ${branchLabel}` : branchLabel;
}

function daysOverdue(c: ServiceCenter): number | null {
  if (!c.currentPeriodEnd) return null;
  const end = (c.currentPeriodEnd as Timestamp).seconds * 1000;
  const diff = Date.now() - end;
  return diff > 0 ? Math.floor(diff / (24 * 60 * 60 * 1000)) : 0;
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  grace_period: { label: "Grace Period", className: "bg-amber-500/15 text-amber-400" },
  pending_payment: { label: "Pending Verification", className: "bg-blue-500/15 text-blue-400" },
  blocked: { label: "Blocked", className: "bg-red-500/15 text-red-400" },
};

export default function AdminUnpaidCentersPage() {
  const [centers, setCenters] = useState<ServiceCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [bulkSending, setBulkSending] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    getDocs(query(collection(db, "servicecenters"), orderBy("createdAt", "desc"))).then((snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ServiceCenter));
      setCenters(all.filter((c) => c.status !== "active" && !c.isDeleted));
      setLoading(false);
    });
  }, []);

  const sorted = useMemo(() => {
    return [...centers].sort((a, b) => (daysOverdue(b) ?? 0) - (daysOverdue(a) ?? 0));
  }, [centers]);

  const totalOwed = sorted.reduce((s, c) => s + (c.monthlyRate ?? 0), 0);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) =>
      prev.size === sorted.length ? new Set() : new Set(sorted.map((c) => c.id))
    );
  }

  async function handleSendOne(center: ServiceCenter) {
    setSendingId(center.id);
    try {
      await sendPaymentReminderSms(center);
      setSentIds((prev) => new Set(prev).add(center.id));
    } catch (err) {
      console.error("Failed to send reminder:", err);
      window.alert((err as Error)?.message ?? `Failed to send reminder to ${center.name}.`);
    } finally {
      setSendingId(null);
    }
  }

  async function handleSendSelected() {
    const targets = sorted.filter((c) => selected.has(c.id));
    if (targets.length === 0) return;
    if (!window.confirm(`Send payment reminder SMS to ${targets.length} owner(s)?`)) return;
    setBulkSending(true);
    const sent = new Set(sentIds);
    for (const center of targets) {
      try {
        await sendPaymentReminderSms(center);
        sent.add(center.id);
      } catch (err) {
        console.error(`Failed to send reminder to ${center.name}:`, err);
      }
    }
    setSentIds(sent);
    setBulkSending(false);
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Unpaid Customers</h1>
          <p className="text-sm text-gray-400 mt-1">Service centers with overdue, pending, or blocked billing status</p>
        </div>
        <button
          onClick={handleSendSelected}
          disabled={bulkSending || selected.size === 0}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Send className="w-4 h-4" />
          {bulkSending ? "Sending…" : `Send Reminder (${selected.size})`}
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <div className="inline-flex p-2 rounded-lg text-red-400 bg-red-400/10 mb-3">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="text-2xl font-bold text-white">{sorted.length}</div>
          <div className="text-sm text-gray-400 mt-1">Unpaid Centers</div>
        </div>
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <div className="inline-flex p-2 rounded-lg text-amber-400 bg-amber-400/10 mb-3">
            <Clock className="w-5 h-5" />
          </div>
          <div className="text-2xl font-bold text-white">
            LKR {totalOwed.toLocaleString()}
          </div>
          <div className="text-sm text-gray-400 mt-1">Monthly Value at Risk</div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-gray-900 rounded-xl border border-gray-800 animate-pulse" />)}
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-20 text-gray-500 bg-gray-900 border border-gray-800 rounded-xl">
          <AlertTriangle className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>All service centers are up to date on payments.</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="px-5 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={selected.size === sorted.length && sorted.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-700 bg-gray-800"
                  />
                </th>
                <th className="text-left px-2 py-3 text-xs text-gray-500 font-medium uppercase">Center</th>
                <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase">Status</th>
                <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase">Overdue</th>
                <th className="text-right px-5 py-3 text-xs text-gray-500 font-medium uppercase">Amount</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const meta = STATUS_META[c.status] ?? { label: c.status, className: "bg-gray-800 text-gray-400" };
                const overdue = daysOverdue(c);
                return (
                  <tr key={c.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-5 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleSelect(c.id)}
                        className="rounded border-gray-700 bg-gray-800"
                      />
                    </td>
                    <td className="px-2 py-3">
                      <Link to={`/admin/service-centers/${c.id}`} className="flex items-center gap-1 group">
                        <div>
                          <p className="text-white font-medium">{centerLabel(c)}</p>
                          <p className="text-xs text-gray-500">{c.ownerPhone ?? c.phone}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" />
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.className}`}>{meta.label}</span>
                    </td>
                    <td className="px-5 py-3 text-gray-400">
                      {overdue === null ? "—" : overdue === 0 ? "Due today" : `${overdue} day${overdue > 1 ? "s" : ""}`}
                    </td>
                    <td className="px-5 py-3 text-right text-white font-semibold">
                      LKR {(c.monthlyRate ?? 0).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => handleSendOne(c)}
                        disabled={sendingId === c.id || !c.ownerPhone}
                        className="flex items-center gap-1.5 text-xs font-medium text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50 ml-auto"
                      >
                        <BellRing className="w-3.5 h-3.5" />
                        {sendingId === c.id ? "Sending…" : sentIds.has(c.id) ? "Sent ✓" : "Remind"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
