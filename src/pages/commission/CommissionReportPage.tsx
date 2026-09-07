// Commission Report — what the workshop has paid out per service, per person.
//
// Reads servicecenters/{centerId}/commissionLogs, the append-only ledger the
// `onJobCompleted` Cloud Function writes. Reversed entries (superseded by a
// correction after a job was reopened) are excluded from the totals but can be
// shown, so a figure that changed can be explained rather than just differing.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection, getDocs, limit, orderBy, query, Timestamp, where,
} from "firebase/firestore";
import { Wallet, Download, AlertTriangle } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { LoadingBlock } from "../../components/LoadingProgress";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { useWorkshopModules } from "../../hooks/useWorkshopModules";
import { downloadCSV } from "../../lib/csvExport";
import { staffDisplayName } from "../../lib/jobTechnicians";
import { COMMISSION_ROLE_LABELS } from "../../lib/commission";
import type { CommissionLog, StaffMember } from "../../types/auth";

/** Most recent entries pulled per query — a report, not an archive dump. */
const PAGE_SIZE = 500;

function startOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(ts: Timestamp | undefined): string {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function CommissionReportPage() {
  const { currentUser } = useAuth();
  const centerId = currentUser?.centerId ?? "";
  const { commissionEnabled, loading: modulesLoading } = useWorkshopModules(centerId);

  const [staff, setStaff] = useState<StaffMember[]>([]);

  const [staffFilter, setStaffFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [from, setFrom] = useState(startOfMonth);
  const [to, setTo] = useState(todayIso);
  const [showReversed, setShowReversed] = useState(false);

  // Owner/Manager read the whole ledger; a supervisor is limited by
  // firestore.rules to their own entries and their reports', which the
  // per-staff query below satisfies.
  const isManagerial = currentUser?.role === "Owner" || currentUser?.role === "Manager";

  // The filter combination a stored result belongs to. Keeping it alongside
  // the result is what lets "loading" and "stale" be derived rather than
  // cleared from inside the effect — and stops an in-flight read for the old
  // filters from painting over the new ones.
  const queryKey = `${centerId}|${staffFilter}|${from}|${to}`;
  const [result, setResult] = useState<
    { key: string; logs: CommissionLog[]; error: string } | null
  >(null);
  const fresh = result?.key === queryKey ? result : null;
  const logs = useMemo(() => fresh?.logs ?? [], [fresh]);
  const error = fresh?.error ?? "";
  const loading = Boolean(centerId) && commissionEnabled && fresh === null;

  useEffect(() => {
    if (!centerId) return;
    getDocs(query(collection(db, "servicecenters", centerId, "staff"), where("active", "==", true)))
      .then((snap) => setStaff(snap.docs.map((d) => ({ id: d.id, ...d.data() } as StaffMember))))
      .catch(() => { /* non-fatal — entries still carry the name they were written with */ });
  }, [centerId]);

  useEffect(() => {
    if (!centerId || !commissionEnabled) return;
    let active = true;

    const fromTs = Timestamp.fromDate(new Date(`${from}T00:00:00`));
    const toTs = Timestamp.fromDate(new Date(`${to}T23:59:59`));
    const base = collection(db, "servicecenters", centerId, "commissionLogs");
    // A supervisor may only read their own entries and those of the people
    // reporting to them, so their view is always narrowed to one person at a
    // time — the whole-center query would be refused by the rules.
    const q = staffFilter
      ? query(base,
          where("staffId", "==", staffFilter),
          where("createdAt", ">=", fromTs), where("createdAt", "<=", toTs),
          orderBy("createdAt", "desc"), limit(PAGE_SIZE))
      : query(base,
          where("createdAt", ">=", fromTs), where("createdAt", "<=", toTs),
          orderBy("createdAt", "desc"), limit(PAGE_SIZE));

    getDocs(q)
      .then((snap) => {
        if (!active) return;
        setResult({
          key: queryKey,
          logs: snap.docs.map((d) => ({ id: d.id, ...d.data() } as CommissionLog)),
          error: "",
        });
      })
      .catch(() => {
        if (!active) return;
        setResult({
          key: queryKey,
          logs: [],
          error: isManagerial
            ? "Couldn't load the ledger. If this is the first run, the Firestore indexes may still be building."
            : "Pick a staff member — supervisors can only see their own entries and their team's.",
        });
      });

    return () => { active = false; };
  }, [centerId, commissionEnabled, staffFilter, from, to, isManagerial, queryKey]);

  const serviceNames = useMemo(
    () => Array.from(new Set(logs.map((l) => l.serviceName))).sort(),
    [logs],
  );

  const rows = useMemo(
    () => logs
      .filter((l) => showReversed || !l.reversed)
      .filter((l) => !serviceFilter || l.serviceName === serviceFilter),
    [logs, showReversed, serviceFilter],
  );

  // Totals never count a reversed entry, whether or not it is on screen.
  const liveRows = useMemo(() => rows.filter((l) => !l.reversed), [rows]);
  const total = liveRows.reduce((sum, l) => sum + (l.commissionAmount ?? 0), 0);
  const overrideTotal = liveRows
    .filter((l) => l.isOverride)
    .reduce((sum, l) => sum + (l.commissionAmount ?? 0), 0);

  const perStaff = useMemo(() => {
    const map = new Map<string, { name: string; amount: number; entries: number }>();
    liveRows.forEach((l) => {
      const prev = map.get(l.staffId) ?? { name: l.staffName, amount: 0, entries: 0 };
      map.set(l.staffId, {
        name: l.staffName,
        amount: prev.amount + (l.commissionAmount ?? 0),
        entries: prev.entries + 1,
      });
    });
    return Array.from(map.entries())
      .map(([staffId, v]) => ({ staffId, ...v }))
      .sort((a, b) => b.amount - a.amount);
  }, [liveRows]);

  function exportCsv() {
    downloadCSV(
      `commission-${from}-to-${to}.csv`,
      ["Date", "Job", "Service", "Vehicle Type", "Service Price", "Staff", "Role",
       "Type", "Rate", "Commission", "Kind", "Reversed"],
      rows.map((l) => [
        fmtDate(l.createdAt),
        l.jobNumber ?? "",
        l.serviceName,
        l.vehicleType ?? "",
        String(l.baseAmount ?? 0),
        l.staffName,
        l.role,
        l.commissionType,
        String(l.commissionRate ?? 0),
        String(l.commissionAmount ?? 0),
        l.isOverride ? "override" : "own work",
        l.reversed ? "yes" : "no",
      ]),
    );
  }

  if (modulesLoading) {
    return <div className="min-h-screen bg-[#0B1120]"><LoadingBlock className="pt-24" /></div>;
  }

  if (!commissionEnabled) {
    return (
      <div className="min-h-screen bg-[#0B1120] text-white">
        <PageHeader icon={<Wallet className="w-5 h-5" />} title="Commission Report" />
        <div className="max-w-3xl mx-auto px-4 py-12 text-center">
          <p className="text-sm text-gray-400">
            Staff commission is switched off for this center.
          </p>
          <Link to="/settings?tab=services" className="text-sm text-orange-400 hover:text-orange-300 mt-2 inline-block">
            Turn it on in Settings → Services &amp; Modules →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<Wallet className="w-5 h-5" />}
        title="Commission Report"
        actions={
          rows.length > 0 && (
            <button
              onClick={exportCsv}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg text-sm"
            >
              <Download className="w-4 h-4" /> Export
            </button>
          )
        }
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Filters */}
        <div className="bg-[#162032] border border-white/10 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="block">
            <span className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1">Staff</span>
            <select
              value={staffFilter}
              onChange={(e) => setStaffFilter(e.target.value)}
              className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
            >
              <option value="">{isManagerial ? "Everyone" : "Select a person…"}</option>
              {staff.map((st) => (
                <option key={st.id} value={st.id}>{staffDisplayName(st)}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1">Service</span>
            <select
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
            >
              <option value="">All services</option>
              {serviceNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
            />
          </label>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-3 py-2 text-sm">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {loading ? (
          <LoadingBlock className="py-12" />
        ) : (
          <>
            {/* Totals */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { label: "Total commission", value: `LKR ${total.toLocaleString()}` },
                { label: "Of which overrides", value: `LKR ${overrideTotal.toLocaleString()}` },
                { label: "Entries", value: String(liveRows.length) },
              ].map((card) => (
                <div key={card.label} className="bg-[#162032] border border-white/10 rounded-xl p-4">
                  <div className="text-[11px] text-gray-500 uppercase tracking-wider">{card.label}</div>
                  <div className="text-xl font-bold text-white mt-1">{card.value}</div>
                </div>
              ))}
            </div>

            {/* Per person */}
            {perStaff.length > 0 && (
              <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
                <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">By person</div>
                <div className="space-y-2">
                  {perStaff.map((p) => (
                    <div key={p.staffId} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-white truncate">{p.name}</span>
                      <span className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-gray-500 text-xs">{p.entries} entries</span>
                        <span className="text-orange-300 font-medium">LKR {p.amount.toLocaleString()}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Per entry */}
            <div className="bg-[#162032] border border-white/10 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/5">
                <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Breakdown</div>
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showReversed}
                    onChange={(e) => setShowReversed(e.target.checked)}
                    className="accent-orange-500"
                  />
                  Show reversed entries
                </label>
              </div>
              {rows.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-gray-500">
                  Nothing recorded in this range.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] text-gray-500 uppercase tracking-wider">
                        <th className="text-left font-semibold px-4 py-2">Date</th>
                        <th className="text-left font-semibold px-4 py-2">Service</th>
                        <th className="text-left font-semibold px-4 py-2">Staff</th>
                        <th className="text-right font-semibold px-4 py-2">Price</th>
                        <th className="text-right font-semibold px-4 py-2">Rate</th>
                        <th className="text-right font-semibold px-4 py-2">Commission</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((l) => (
                        <tr
                          key={l.id}
                          className={`border-t border-white/5 ${l.reversed ? "opacity-40" : ""}`}
                        >
                          <td className="px-4 py-2 text-gray-400 whitespace-nowrap">{fmtDate(l.createdAt)}</td>
                          <td className="px-4 py-2 text-white">
                            {l.serviceName}
                            {l.jobNumber && <span className="text-xs text-gray-600 ml-2">{l.jobNumber}</span>}
                          </td>
                          <td className="px-4 py-2 text-gray-300 whitespace-nowrap">
                            {l.staffName}
                            <span className="text-gray-600 text-xs ml-1">
                              ({COMMISSION_ROLE_LABELS[l.role] ?? l.role})
                            </span>
                            {l.isOverride && <span className="text-[10px] text-gray-600 ml-1">override</span>}
                            {l.reversed && <span className="text-[10px] text-red-400 ml-1">reversed</span>}
                          </td>
                          <td className="px-4 py-2 text-right text-gray-400">
                            {(l.baseAmount ?? 0).toLocaleString()}
                          </td>
                          <td className="px-4 py-2 text-right text-gray-400 whitespace-nowrap">
                            {l.commissionType === "percentage"
                              ? `${l.commissionRate}%`
                              : `LKR ${(l.commissionRate ?? 0).toLocaleString()}`}
                          </td>
                          <td className="px-4 py-2 text-right text-orange-300 font-medium">
                            {(l.commissionAmount ?? 0).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
