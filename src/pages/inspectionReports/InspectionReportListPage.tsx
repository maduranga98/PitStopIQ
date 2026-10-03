import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FileCheck, ListChecks, Plus } from "lucide-react";
import type { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { fetchReportsPage, type ReportListTab } from "../../lib/inspectionReports/reports";
import { LoadingBlock } from "../../components/LoadingProgress";
import { StatusBadge, TypeBadge } from "../../components/inspectionReports/ReportBadges";
import type { InspectionReport } from "../../types/inspectionReports";

const fmt = (ts: { toDate?: () => Date } | null | undefined) =>
  ts?.toDate ? ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

export default function InspectionReportListPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const centerId = currentUser?.centerId;
  const role = currentUser?.role;
  const permCreate = usePermission("inspectionReports.create");
  const permTemplate = usePermission("inspectionReports.manageTemplate");
  const canCreate = (role === "Owner" || role === "Manager") && permCreate;
  const canTemplate = (role === "Owner" || role === "Manager") && permTemplate;
  const isTech = role === "Technician";
  const uid = currentUser?.uid;

  const [tab, setTab] = useState<ReportListTab>("draft");
  const [reports, setReports] = useState<InspectionReport[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async (reset: boolean, from: QueryDocumentSnapshot<DocumentData> | null) => {
    if (!centerId) return;
    if (reset) setLoading(true); else setMore(true);
    setError(false);
    try {
      const page = await fetchReportsPage(centerId, {
        tab, technicianUid: isTech ? uid : undefined, cursor: reset ? null : from,
      });
      setReports((prev) => (reset ? page.reports : [...prev, ...page.reports]));
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch { setError(true); }
    finally { setLoading(false); setMore(false); }
  }, [centerId, tab, isTech, uid]);

  // Fetch on mount and whenever the tab changes; load() sets the loading state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(true, null); }, [load]);

  return (
    <div className="min-h-screen bg-[#0B1120] text-white pb-16">
      <div className="border-b border-white/10 bg-[#0B1120]/90 backdrop-blur sticky top-0 z-20">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <FileCheck className="w-5 h-5 text-[#F97316]" />
          <h1 className="text-lg font-bold flex-1">Inspection Reports</h1>
          {canTemplate && (
            <Link to="/inspection-reports/template" aria-label="Checklist template" className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5">
              <ListChecks className="w-5 h-5" />
            </Link>
          )}
          {canCreate && (
            <>
              <button onClick={() => navigate("/inspection-reports/new")}
                className="flex items-center gap-1.5 rounded-lg bg-[#F97316] hover:bg-[#ea6c0f] px-3 py-2 text-xs font-semibold text-white">
                <Plus className="w-4 h-4" /> New
              </button>
            </>
          )}
        </div>
        {!isTech && (
          <div className="max-w-2xl mx-auto px-4 flex gap-5">
            {(["draft", "finalized"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`pb-2.5 text-sm border-b-2 -mb-px transition-colors ${tab === t ? "border-[#F97316] text-white" : "border-transparent text-gray-500 hover:text-gray-300"}`}>
                {t === "draft" ? "Drafts" : "Finalized"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 space-y-2">
        {loading ? <LoadingBlock /> : error ? (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-gray-400">Couldn't load reports. Check your connection.</p>
            <button onClick={() => load(true, null)} className="text-sm text-[#F97316]">Try again</button>
          </div>
        ) : reports.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-16">
            {isTech ? "No reports are assigned to you." : tab === "draft" ? "No drafts." : "No finalized reports yet."}
          </p>
        ) : (
          <>
            {reports.map((r) => (
              <Link key={r.id} to={`/inspection-reports/${r.id}`}
                className="block bg-[#162032] border border-white/10 hover:border-[#F97316]/40 rounded-xl px-4 py-3 transition-colors">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold flex-1 truncate">{r.header.plateNumber}</p>
                  <TypeBadge type={r.type} /> <StatusBadge status={r.status} />
                </div>
                <p className="text-xs text-gray-400 truncate mt-0.5">{r.header.customerName}</p>
                <p className="text-[11px] text-gray-600 mt-1">
                  {r.reportNumber ?? "Not numbered"} · {fmt(r.status === "finalized" ? r.finalizedAt : r.updatedAt)}
                  {r.assignedToName && ` · ${r.assignedToName}`}
                </p>
              </Link>
            ))}
            {hasMore && (
              <button onClick={() => load(false, cursor)} disabled={more}
                className="w-full py-3 text-sm text-[#F97316] hover:text-orange-300 disabled:opacity-50">
                {more ? "Loading…" : "Load more"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
