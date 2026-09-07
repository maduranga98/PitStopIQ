// My Commissions — a technician's own earnings, read-only.
//
// Deliberately narrow: it queries commissionLogs with
// where('staffId','==',auth.uid), which is exactly the shape firestore.rules
// permits a technician, and shows nobody else's figures. Overrides earned on
// this person's work by their supervisor are somebody else's pay and are not
// shown here.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, limit, orderBy, query, Timestamp, where } from "firebase/firestore";
import { Wallet } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { LoadingBlock } from "../../components/LoadingProgress";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { useWorkshopModules } from "../../hooks/useWorkshopModules";
import type { CommissionLog } from "../../types/auth";

/** A year of entries — enough to look back over, without an unbounded read. */
const PAGE_SIZE = 500;

function monthKey(ts: Timestamp | undefined): string {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function fmtDate(ts: Timestamp | undefined): string {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export default function MyCommissionsPage() {
  const { currentUser } = useAuth();
  const centerId = currentUser?.centerId ?? "";
  const uid = currentUser?.uid;
  const { commissionEnabled, loading: modulesLoading } = useWorkshopModules(centerId);

  // null until the read lands — that is what "loading" means here, so nothing
  // has to be cleared from inside the effect body.
  const [loaded, setLoaded] = useState<CommissionLog[] | null>(null);
  const logs = useMemo(() => loaded ?? [], [loaded]);
  const loading = Boolean(centerId) && Boolean(uid) && commissionEnabled && loaded === null;

  useEffect(() => {
    if (!centerId || !uid || !commissionEnabled) return;
    let active = true;
    getDocs(query(
      collection(db, "servicecenters", centerId, "commissionLogs"),
      where("staffId", "==", uid),
      orderBy("createdAt", "desc"),
      limit(PAGE_SIZE),
    ))
      .then((snap) => {
        if (active) setLoaded(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CommissionLog)));
      })
      .catch(() => { if (active) setLoaded([]); });
    return () => { active = false; };
  }, [centerId, uid, commissionEnabled]);

  // A reversed entry was superseded by a correction — it is history, not pay.
  const live = useMemo(() => logs.filter((l) => !l.reversed), [logs]);
  const total = live.reduce((sum, l) => sum + (l.commissionAmount ?? 0), 0);

  const byMonth = useMemo(() => {
    const map = new Map<string, CommissionLog[]>();
    live.forEach((l) => {
      const key = monthKey(l.createdAt);
      map.set(key, [...(map.get(key) ?? []), l]);
    });
    return Array.from(map.entries());
  }, [live]);

  if (modulesLoading || loading) {
    return <div className="min-h-screen bg-[#0B1120]"><LoadingBlock className="pt-24" /></div>;
  }

  if (!commissionEnabled) {
    return (
      <div className="min-h-screen bg-[#0B1120] text-white">
        <PageHeader icon={<Wallet className="w-5 h-5" />} title="My Commissions" />
        <div className="max-w-3xl mx-auto px-4 py-12 text-center text-sm text-gray-400">
          Commission isn't switched on for this service center.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader icon={<Wallet className="w-5 h-5" />} title="My Commissions" />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div className="bg-[#162032] border border-white/10 rounded-xl p-5">
          <div className="text-[11px] text-gray-500 uppercase tracking-wider">Earned to date</div>
          <div className="text-3xl font-bold text-white mt-1">LKR {total.toLocaleString()}</div>
          <p className="text-xs text-gray-500 mt-2">
            Recorded automatically when a job you worked on is marked done. Read-only.
          </p>
        </div>

        {byMonth.length === 0 ? (
          <div className="border border-dashed border-white/10 rounded-xl px-4 py-10 text-center">
            <p className="text-sm text-gray-400">Nothing recorded yet.</p>
            <p className="text-xs text-gray-600 mt-1">
              Commission appears here once a job naming you on a service is completed.
            </p>
            <Link to="/services" className="text-xs text-orange-400 hover:text-orange-300 mt-3 inline-block">
              Go to jobs →
            </Link>
          </div>
        ) : (
          byMonth.map(([month, entries]) => (
            <div key={month} className="bg-[#162032] border border-white/10 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/5">
                <span className="text-sm font-semibold text-white">{month}</span>
                <span className="text-sm text-orange-300 font-medium">
                  LKR {entries.reduce((s, l) => s + (l.commissionAmount ?? 0), 0).toLocaleString()}
                </span>
              </div>
              <div className="divide-y divide-white/5">
                {entries.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm text-white truncate">{l.serviceName}</div>
                      <div className="text-[11px] text-gray-500">
                        {fmtDate(l.createdAt)}
                        {l.jobNumber && ` · ${l.jobNumber}`}
                        {l.isOverride && " · override"}
                      </div>
                    </div>
                    <span className="text-sm text-orange-300 font-medium flex-shrink-0">
                      LKR {(l.commissionAmount ?? 0).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
