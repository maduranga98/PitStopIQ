import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, orderBy, query, Timestamp } from "firebase/firestore";
import { MessageSquare, ThumbsUp, AlertTriangle, Check, Archive } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { safeUpdateDoc } from "../../lib/firestoreWrite";
import type { CustomerFeedback, CustomerFeedbackStatus } from "../../types/auth";
import { LoadingBlock } from "../../components/LoadingProgress";

// Complaints and suggestions raised from a customer's public view (no login),
// via the submitCustomerFeedback callable. Owner/Manager triage the queue here.

const canReview = (role?: string) => role === "Owner" || role === "Manager";

const STATUS_LABEL: Record<CustomerFeedbackStatus, string> = {
  new: "New",
  reviewed: "Reviewed",
  resolved: "Resolved",
};

function formatDate(ts?: Timestamp | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

type Tab = "new" | "reviewed" | "resolved" | "all";

export default function CustomerFeedbackPage() {
  const { currentUser } = useAuth();
  const centerId = currentUser?.centerId ?? "";
  const uid = currentUser?.uid ?? "";
  const userName = currentUser?.displayName ?? currentUser?.email ?? "Staff";
  const editable = canReview(currentUser?.role);

  const [items, setItems] = useState<CustomerFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("new");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!centerId) return;
    const q = query(
      collection(db, "servicecenters", centerId, "customerFeedback"),
      orderBy("createdAt", "desc"),
    );
    return onSnapshot(q, (snap) => {
      setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CustomerFeedback)));
      setLoading(false);
    }, () => setLoading(false));
  }, [centerId]);

  const visible = useMemo(
    () => (tab === "all" ? items : items.filter((i) => i.status === tab)),
    [items, tab],
  );
  const newCount = items.filter((i) => i.status === "new").length;

  async function setStatus(item: CustomerFeedback, status: CustomerFeedbackStatus) {
    if (!editable) return;
    setBusyId(item.id);
    try {
      await safeUpdateDoc(doc(db, "servicecenters", centerId, "customerFeedback", item.id), {
        status,
        reviewedAt: Timestamp.now(),
        reviewedBy: uid,
        reviewedByName: userName,
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<MessageSquare className="w-5 h-5" />}
        title="Complaints & Suggestions"
        below={
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-3">
            <div className="flex bg-white/5 rounded-lg p-0.5 gap-0.5 w-fit flex-wrap">
              {(["new", "reviewed", "resolved", "all"] as Tab[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                    tab === key ? "bg-orange-500 text-white" : "text-gray-400 hover:text-white"
                  }`}
                >
                  {key === "new" ? `New (${newCount})` : key === "all" ? "All" : STATUS_LABEL[key]}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {loading ? (
          <LoadingBlock className="py-20" />
        ) : visible.length === 0 ? (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3">
            <MessageSquare className="h-12 w-12 text-gray-700" />
            <p className="text-gray-400 font-medium">Nothing here yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map((item) => (
              <div key={item.id} className="bg-[#162032] border border-white/10 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium border ${
                          item.type === "complaint"
                            ? "bg-red-500/15 text-red-400 border-red-500/30"
                            : "bg-blue-500/15 text-blue-400 border-blue-500/30"
                        }`}
                      >
                        {item.type === "complaint" ? <AlertTriangle className="w-3 h-3" /> : <ThumbsUp className="w-3 h-3" />}
                        {item.type === "complaint" ? "Complaint" : "Suggestion"}
                      </span>
                      <span className="text-sm font-semibold text-white truncate">{item.customerName || "Customer"}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {item.customerPhone} · {formatDate(item.createdAt)}
                    </p>
                    <p className="text-sm text-gray-300 mt-2 whitespace-pre-wrap">{item.message}</p>
                    {item.status !== "new" && item.reviewedByName && (
                      <p className="text-xs text-gray-500 mt-2">
                        {STATUS_LABEL[item.status]} by {item.reviewedByName}
                      </p>
                    )}
                  </div>
                  <span className={`flex-shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${
                    item.status === "new"
                      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                      : item.status === "reviewed"
                        ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                        : "bg-green-500/15 text-green-400 border-green-500/30"
                  }`}>
                    {STATUS_LABEL[item.status]}
                  </span>
                </div>

                {editable && item.status !== "resolved" && (
                  <div className="flex gap-2 mt-4">
                    {item.status === "new" && (
                      <button
                        onClick={() => setStatus(item, "reviewed")}
                        disabled={busyId === item.id}
                        className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 px-3 py-2 rounded-lg transition disabled:opacity-60"
                      >
                        <Check className="h-3.5 w-3.5" /> Mark Reviewed
                      </button>
                    )}
                    <button
                      onClick={() => setStatus(item, "resolved")}
                      disabled={busyId === item.id}
                      className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 px-3 py-2 rounded-lg transition disabled:opacity-60"
                    >
                      <Archive className="h-3.5 w-3.5" /> Mark Resolved
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
