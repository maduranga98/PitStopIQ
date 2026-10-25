// Standalone post-service checklists, newest first: drafts to carry on with and
// signed-off records to look back at. Opening one goes to the same form, which
// is read-only once it is signed off.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ClipboardCheck, Loader2, Plus } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { useAuth } from "../../contexts/AuthContext";
import { checklistSubject, fetchRecentStandalone } from "../../lib/standaloneChecklists";
import { fetchCustomers, fetchVehicles } from "../../lib/refData";
import { ratedProgress, resultCounts } from "../../lib/checklistFill";
import type { StandalonePostServiceChecklist } from "../../types/auth";

export default function PostServiceChecklistListPage() {
  const { currentUser } = useAuth();
  const centerId = currentUser?.centerId;
  const navigate = useNavigate();
  const [records, setRecords] = useState<StandalonePostServiceChecklist[] | null>(null);
  const [error, setError] = useState("");
  const [plateById, setPlateById] = useState<Map<string, string>>(new Map());
  const [nameById, setNameById] = useState<Map<string, string>>(new Map());

  // Names for records made on a vehicle / customer on file. Both lists are
  // cached, and failing to load them only leaves the generic wording.
  useEffect(() => {
    if (!centerId) return;
    let live = true;
    fetchVehicles(centerId).then((v) => live && setPlateById(new Map(v.map((x) => [x.id, x.plateNumber])))).catch(() => {});
    fetchCustomers(centerId).then((c) => live && setNameById(new Map(c.map((x) => [x.id, x.name])))).catch(() => {});
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
        {records === null ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-10 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : records.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-10">
            No checklists yet. Start one for any vehicle — it doesn't need a job card.
          </p>
        ) : (
          records.map((r) => {
            const signed = !!r.completedAt;
            const { done, total } = ratedProgress(r.sections ?? []);
            const counts = resultCounts(r.sections ?? []);
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
                  {counts.attention > 0 && <span className="text-yellow-400">{counts.attention} to watch</span>}
                  {counts.immediate > 0 && <span className="text-red-400">{counts.immediate} urgent</span>}
                </p>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
