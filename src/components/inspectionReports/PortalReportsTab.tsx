import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ChevronRight, FileCheck, RefreshCw } from "lucide-react";
import { fetchPortalReports } from "../../lib/inspectionReports/share";
import type { PortalReportRow } from "../../types/inspectionReports";

const fmt = (ms: number | null) =>
  ms ? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

/**
 * The customer portal's "Reports" tab: finalized, customer-visible reports for
 * this customer, newest first, 20 at a time. Fetched when the tab is opened (a
 * customer who never looks costs nothing). Each row opens the report's own
 * read-only page, which is where the detail, photos, attachments and PDF live.
 */
export default function PortalReportsTab({ centerId, customerId }: { centerId: string; customerId: string }) {
  const [rows, setRows] = useState<PortalReportRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async (from: string | null) => {
    if (from) setMore(true); else setLoading(true);
    setError(false);
    try {
      const page = await fetchPortalReports(centerId, customerId, from);
      setRows((prev) => (from ? [...prev, ...page.reports] : page.reports));
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch { setError(true); }
    finally { setLoading(false); setMore(false); }
  }, [centerId, customerId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch when the tab opens
  useEffect(() => { load(null); }, [load]);

  return (
    <div className="bg-[#162032] border border-white/10 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <FileCheck className="w-4 h-4 text-[#F97316]" />
        <h2 className="font-semibold">Reports</h2>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : error ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <AlertCircle className="w-6 h-6 text-gray-500" />
          <p className="text-sm text-gray-400">Couldn't load your reports.</p>
          <button onClick={() => load(null)} className="flex items-center gap-1.5 text-sm text-[#F97316]"><RefreshCw className="w-3.5 h-3.5" /> Try again</button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">No reports yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <a key={r.shareToken} href={`/i/${r.shareToken}`}
              className="flex items-center justify-between gap-3 bg-[#0B1120] border border-white/5 rounded-xl px-4 py-3 hover:border-[#F97316]/30 transition">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold whitespace-nowrap">{r.reportNumber}</p>
                <p className="text-xs text-gray-500 mt-0.5">{r.plateNumber} · {fmt(r.finalizedAtMillis)}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-px border border-white/10 text-gray-400">
                    {r.type === "diagnostic" ? "Diagnostic" : "Checklist"}
                  </span>
                  {r.type === "checklist" && (
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${r.needsRepair > 0
                      ? "bg-red-500/15 text-red-300 border-red-500/30" : "bg-white/5 text-gray-400 border-white/10"}`}>
                      {r.needsRepair} need repair
                    </span>
                  )}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
            </a>
          ))}
          {hasMore && (
            <button onClick={() => load(cursor)} disabled={more} className="w-full py-2 text-sm text-[#F97316] hover:text-orange-300 disabled:opacity-50">
              {more ? "Loading…" : "Show more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
