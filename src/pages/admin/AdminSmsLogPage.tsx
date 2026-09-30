import { useEffect, useMemo, useState } from "react";
import { collection, collectionGroup, getDocs, limit, orderBy, query, Timestamp } from "firebase/firestore";
import { MessageSquare, RotateCw, ChevronDown, ChevronUp, Search } from "lucide-react";
import { db } from "../../config/firebase";
import { watchQuery } from "../../lib/listeners";
import { safeAddDoc } from "../../lib/firestoreWrite";
import type { SmsLog } from "../../types/auth";

const LOG_LIMIT = 500;

type Tab = "platform" | "center";
type StatusFilter = "all" | "failed" | "pending_blackout" | "sent" | "delivered";

type Row = SmsLog & { centerId: string };
type CenterInfo = { name: string; ownerPhone: string };

const STATUS_META: Record<SmsLog["status"], { label: string; chip: string }> = {
  delivered: { label: "Delivered", chip: "bg-green-500/15 text-green-400 border border-green-500/30" },
  sent: { label: "Queued", chip: "bg-sky-500/15 text-sky-300 border border-sky-500/30" },
  pending_blackout: { label: "Waiting (8 AM)", chip: "bg-amber-500/15 text-amber-300 border border-amber-500/30" },
  failed: { label: "Failed", chip: "bg-red-500/15 text-red-300 border border-red-500/30" },
};

const last9 = (p?: string) => (p ?? "").replace(/\D/g, "").slice(-9);

function when(ts?: { toDate: () => Date } | null): string {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Every SMS that went through the gateway, across all service centers, split by
 * who it was for: "PitStopIQ → owners" (login credentials, payment reminders)
 * and "Centers → customers". New platform messages carry `origin: "platform"`;
 * older ones are recognised by being addressed to that center's owner phone.
 */
export default function AdminSmsLogPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [centers, setCenters] = useState<Record<string, CenterInfo>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("platform");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    getDocs(collection(db, "servicecenters"))
      .then((snap) => {
        const map: Record<string, CenterInfo> = {};
        snap.docs.forEach((d) => {
          const c = d.data();
          map[d.id] = { name: c.name ?? d.id, ownerPhone: c.ownerPhone ?? "" };
        });
        setCenters(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    return watchQuery(
      query(collectionGroup(db, "smsLogs"), orderBy("sentAt", "desc"), limit(LOG_LIMIT)),
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, centerId: d.ref.parent.parent?.id ?? "", ...d.data() } as Row)));
        setLoading(false);
      },
      () => {
        setError("Could not load the SMS log. If this is the first time, deploy the Firestore rules and indexes.");
        setLoading(false);
      },
    );
  }, []);

  const isPlatform = (r: Row) =>
    r.origin === "platform" ||
    (!!centers[r.centerId]?.ownerPhone && last9(r.phone) === last9(centers[r.centerId].ownerPhone));

  const inTab = useMemo(() => rows.filter((r) => (isPlatform(r) ? "platform" : "center") === tab),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, centers, tab]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: inTab.length, failed: 0, pending_blackout: 0, sent: 0, delivered: 0 };
    inTab.forEach((r) => { c[r.status] = (c[r.status] ?? 0) + 1; });
    return c;
  }, [inTab]);

  const tabFailed = useMemo(() => {
    const t = { platform: 0, center: 0 };
    rows.forEach((r) => { if (r.status === "failed") t[isPlatform(r) ? "platform" : "center"]++; });
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, centers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inTab.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (!q) return true;
      return [r.phone, r.customerName, r.message, r.messageType, centers[r.centerId]?.name]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [inTab, status, search, centers]);

  async function resend(r: Row) {
    setResending(r.id);
    setNotice("");
    try {
      // A fresh log doc: the failed attempt stays as the record, the retry is
      // its own line. Delivery fields belong to the old attempt, so not copied.
      const copy: Record<string, unknown> = {
        customerName: r.customerName ?? "",
        phone: r.phone,
        messageType: r.messageType,
        message: r.message,
        status: "sent",
        sentAt: Timestamp.now(),
        retryOf: r.id,
      };
      for (const k of ["customerId", "distributorId", "supplierId", "vehicleId", "plateNumber", "jobId", "invoiceId", "mask"] as const) {
        if (r[k]) copy[k] = r[k];
      }
      if (isPlatform(r)) copy.origin = "platform";
      await safeAddDoc(collection(db, "servicecenters", r.centerId, "smsLogs"), copy);
      setNotice(`Re-sent to ${r.phone}. The new attempt appears at the top.`);
    } catch {
      setNotice("Could not queue the message. Check your connection and try again.");
    } finally {
      setResending(null);
    }
  }

  const statusChips: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "failed", label: "Failed" },
    { key: "pending_blackout", label: "Waiting" },
    { key: "sent", label: "Queued" },
    { key: "delivered", label: "Delivered" },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-white flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-sky-400" /> SMS Log
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Latest {LOG_LIMIT} messages across all service centers. Open a row to see why one failed.
        </p>
      </div>

      <div className="flex gap-1 border-b border-gray-800 mb-4">
        {([
          ["platform", "PitStopIQ → Owners"],
          ["center", "Centers → Customers"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setTab(key); setStatus("all"); setOpen(null); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 ${
              tab === key ? "border-orange-500 text-orange-400" : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            {label}
            {tabFailed[key] > 0 && (
              <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{tabFailed[key]}</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex flex-wrap gap-1.5">
          {statusChips.map((c) => (
            <button
              key={c.key}
              onClick={() => setStatus(c.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                status === c.key ? "bg-orange-500 text-white" : "bg-gray-900 border border-gray-800 text-gray-400 hover:text-white"
              }`}
            >
              {c.label} <span className="opacity-60">{counts[c.key] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="w-4 h-4 text-gray-600 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search center, phone, text"
            className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500"
          />
        </div>
      </div>

      {notice && <p className="text-sm text-sky-300 bg-sky-500/10 border border-sky-500/20 rounded-lg px-3 py-2 mb-3">{notice}</p>}
      {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2 mb-3">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-600">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-600 py-10 text-center border border-dashed border-gray-800 rounded-xl">Nothing here.</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => {
            const expanded = open === r.id;
            const meta = STATUS_META[r.status] ?? STATUS_META.sent;
            return (
              <li key={`${r.centerId}/${r.id}`} className={`bg-gray-900 border rounded-xl ${r.status === "failed" ? "border-red-500/30" : "border-gray-800"}`}>
                <div className="flex items-start gap-3 p-4">
                  <button onClick={() => setOpen(expanded ? null : r.id)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${meta.chip}`}>{meta.label}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-800 text-gray-400">{r.messageType}</span>
                      <span className="text-sm text-white truncate">{centers[r.centerId]?.name ?? r.centerId}</span>
                      <span className="text-xs text-gray-500">→ {r.customerName || "—"} · {r.phone}</span>
                    </div>
                    <p className={`text-sm text-gray-400 mt-1.5 ${expanded ? "whitespace-pre-wrap" : "line-clamp-2"}`}>{r.message}</p>
                    {r.status === "failed" && r.errorMessage && !expanded && (
                      <p className="text-xs text-red-400 mt-1.5 line-clamp-1">{r.errorMessage}</p>
                    )}
                    <p className="text-xs text-gray-600 mt-1.5">{when(r.sentAt)}{r.retryOf ? " · resend" : ""}</p>
                  </button>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {(r.status === "failed" || r.status === "pending_blackout") && (
                      <button
                        onClick={() => resend(r)}
                        disabled={resending === r.id}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white transition-colors"
                      >
                        <RotateCw className={`w-3.5 h-3.5 ${resending === r.id ? "animate-spin" : ""}`} /> Resend
                      </button>
                    )}
                    <button onClick={() => setOpen(expanded ? null : r.id)} className="p-1.5 text-gray-500 hover:text-white">
                      {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-gray-800 px-4 py-3 space-y-2 text-xs">
                    {r.status === "failed" && (
                      <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
                        <p className="text-red-300 font-medium">Why it failed</p>
                        <p className="text-red-200/90 mt-0.5">{r.errorMessage || "No reason was recorded."}</p>
                        {r.errorCode && <p className="text-red-300/70 mt-0.5 font-mono">{r.errorCode}</p>}
                      </div>
                    )}
                    {r.status === "pending_blackout" && r.errorMessage && (
                      <p className="text-amber-300">{r.errorMessage}</p>
                    )}
                    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-gray-500">
                      <div><dt className="inline">Sender: </dt><dd className="inline text-gray-300">{r.senderMask || r.mask || "default"}</dd></div>
                      <div><dt className="inline">Delivered: </dt><dd className="inline text-gray-300">{when(r.deliveredAt)}</dd></div>
                      {r.esmsTransactionId != null && <div><dt className="inline">Txn: </dt><dd className="inline text-gray-300 font-mono">{String(r.esmsTransactionId)}</dd></div>}
                    </dl>
                    {r.providerResponse != null && (
                      <pre className="bg-gray-950 border border-gray-800 rounded-lg p-2 text-gray-400 overflow-x-auto whitespace-pre-wrap break-all">
                        {typeof r.providerResponse === "string" ? r.providerResponse : JSON.stringify(r.providerResponse, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
