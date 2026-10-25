// Standalone post-service checklists, newest first: drafts to carry on with and
// signed-off records to look back at. Opening one goes to the same form, which
// is read-only once it is signed off.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ClipboardCheck, Loader2, Plus, Search } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { useAuth } from "../../contexts/AuthContext";
import { HISTORY_LIMIT, checklistSubject, fetchRecentStandalone } from "../../lib/standaloneChecklists";
import { fetchCustomers, fetchVehicles } from "../../lib/refData";
import { ratedProgress, resultCounts } from "../../lib/checklistFill";
import {
  checklistState, filterChecklists, stateCounts, urgentCount, type ChecklistStateFilter,
} from "../../lib/checklistHistory";
import type { StandalonePostServiceChecklist } from "../../types/auth";

export default function PostServiceChecklistListPage() {
  const { currentUser } = useAuth();
  const centerId = currentUser?.centerId;
  const navigate = useNavigate();
  const [records, setRecords] = useState<StandalonePostServiceChecklist[] | null>(null);
  const [error, setError] = useState("");
  const [plateById, setPlateById] = useState<Map<string, string>>(new Map());
  const [nameById, setNameById] = useState<Map<string, string>>(new Map());
  const [phoneById, setPhoneById] = useState<Map<string, string>>(new Map());
  const [query, setQuery] = useState("");
  const [state, setState] = useState<ChecklistStateFilter>("all");
  const [urgentOnly, setUrgentOnly] = useState(false);

  // Names for records made on a vehicle / customer on file. Both lists are
  // cached, and failing to load them only leaves the generic wording.
  useEffect(() => {
    if (!centerId) return;
    let live = true;
    fetchVehicles(centerId).then((v) => live && setPlateById(new Map(v.map((x) => [x.id, x.plateNumber])))).catch(() => {});
    fetchCustomers(centerId).then((c) => {
      if (!live) return;
      setNameById(new Map(c.map((x) => [x.id, x.name])));
      setPhoneById(new Map(c.map((x) => [x.id, x.phone])));
    }).catch(() => {});
    return () => { live = false; };
  }, [centerId]);

  useEffect(() => {
    if (!centerId) return;
    let live = true;
    fetchRecentStandalone(centerId).then(
      (r) => live && setRecords(r),
      () => { if (live) { setRecords([]); setError("Couldn't load your checklists. Check your connection and try again."); } },
    );
    return () => { live = false; };
  }, [centerId]);

  const counts = stateCounts(records ?? []);
  const shown = filterChecklists(records ?? [], { query, state, urgentOnly }, { plateById, nameById, phoneById });
  const filtering = query.trim() !== "" || state !== "all" || urgentOnly;
  const TABS: { key: ChecklistStateFilter; label: string }[] = [
    { key: "all", label: "All" }, { key: "draft", label: "Drafts" },
    { key: "signed", label: "Signed off" }, { key: "sent", label: "Sent" },
  ];

  return (
    <div className="min-h-screen bg-[#0B1120]">
      <PageHeader
        icon={<ClipboardCheck className="w-5 h-5" />}
        title="Post-Service Checklists"
        actions={
          <button
            onClick={() => navigate("/post-service-checklists/new")}
            className="flex items-center gap-1.5 bg-[#F97316] hover:bg-[#ea6c0f] text-white text-sm font-semibold px-3 py-2 rounded-lg"
          >
            <Plus className="w-4 h-4" /> New checklist
          </button>
        }
      />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-3">
        {error && <p className="text-sm text-red-400">{error}</p>}

        {records !== null && records.length > 0 && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search plate, customer or phone"
                aria-label="Search checklists"
                className="w-full bg-white/5 border border-white/10 text-white rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-orange-500"
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div role="tablist" aria-label="Status" className="flex gap-1.5 flex-wrap">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={state === t.key}
                    onClick={() => setState(t.key)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition ${
                      state === t.key
                        ? "bg-orange-500/20 text-orange-300 border-orange-500/40"
                        : "bg-white/5 text-gray-400 border-white/10 hover:text-white"
                    }`}
                  >
                    {t.label} <span className="tabular-nums text-gray-500">{counts[t.key]}</span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => setUrgentOnly((v) => !v)}
                aria-pressed={urgentOnly}
                className={`text-xs px-3 py-1.5 rounded-full border transition ${
                  urgentOnly ? "bg-red-500/20 text-red-300 border-red-500/40" : "bg-white/5 text-gray-400 border-white/10 hover:text-white"
                }`}
              >
                Has urgent items
              </button>
            </div>
          </div>
        )}
        {records === null ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-10 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : records.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-10">
            No checklists yet. Start one for any vehicle — it doesn't need a job card.
          </p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-10">
            No checklists match{filtering ? " these filters" : ""}.
            {filtering && (
              <button onClick={() => { setQuery(""); setState("all"); setUrgentOnly(false); }} className="ml-2 text-orange-400 hover:text-orange-300">
                Clear filters
              </button>
            )}
          </p>
        ) : (
          [...shown.map((r) => {
            const signed = checklistState(r) !== "draft";
            const { done, total } = ratedProgress(r.sections ?? []);
            const results = resultCounts(r.sections ?? []);
            const date = r.date?.toDate?.();
            return (
              <Link
                key={r.id}
                to={`/post-service-checklists/${r.id}`}
                className="block bg-[#162032] border border-white/10 hover:border-white/20 rounded-xl px-4 py-3 transition"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-white truncate">{checklistSubject(r, plateById, nameById)}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border flex-shrink-0 ${
                    r.sentToCustomer
                      ? "bg-blue-500/15 text-blue-300 border-blue-500/30"
                      : signed
                        ? "bg-green-500/15 text-green-300 border-green-500/30"
                        : "bg-white/5 text-gray-400 border-white/10"
                  }`}>
                    {r.sentToCustomer ? "Sent" : signed ? "Signed off" : "Draft"}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-3">
                  <span>{r.templateName}</span>
                  {date && <span>{date.toLocaleDateString()}</span>}
                  <span className="tabular-nums">{done}/{total} rated</span>
                  {results.attention > 0 && <span className="text-yellow-400">{results.attention} to watch</span>}
                  {urgentCount(r.sections) > 0 && <span className="text-red-400">{urgentCount(r.sections)} urgent</span>}
                </p>
              </Link>
            );
          }),
          records!.length >= HISTORY_LIMIT && (
            <p key="cap" className="text-xs text-gray-600 text-center pt-2">
              Showing the latest {HISTORY_LIMIT} checklists.
            </p>
          )]
        )}
      </div>
    </div>
  );
}
