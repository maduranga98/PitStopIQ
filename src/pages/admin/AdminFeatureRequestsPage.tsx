import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { collection, orderBy, query } from "firebase/firestore";
import {
  Lightbulb, Bug, Plus, PhoneCall, ListChecks, ExternalLink, Play, CheckCircle2, X,
} from "lucide-react";
import { db } from "../../config/firebase";
import { watchQuery } from "../../lib/listeners";
import { useSuperAdmin } from "../../contexts/SuperAdminContext";
import {
  closeFeatureRequestToTesting, createFeatureRequest, startFeatureRequest,
} from "../../lib/devTracker";
import AdminModal, { Field, inputClass } from "../../components/admin/AdminModal";
import {
  FEATURE_STATUS_META, FEATURE_STATUSES, FEATURE_TYPE_META, FEATURE_TYPES,
  blankFeatureDraft, type FeatureRequest, type FeatureRequestDraft, type FeatureStatus, type FeatureType,
} from "../../types/devTracker";

function when(ts?: { toDate: () => Date } | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * What used to be a verbal "can you also add…" from a service center owner:
 * a request comes in (raised here, or from a customer's bug report on a
 * call), a developer picks it up, and closing it hands the work to Testing —
 * a to-do this section creates for itself — rather than marking it done on
 * the spot. Finishing that to-do is what actually closes the ticket.
 */
export default function AdminFeatureRequestsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { superAdmin } = useSuperAdmin();
  const [items, setItems] = useState<FeatureRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<"all" | FeatureType>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | FeatureStatus>("all");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<FeatureRequestDraft>(blankFeatureDraft());
  const [closing, setClosing] = useState<FeatureRequest | null>(null);
  const [featurePath, setFeaturePath] = useState("");
  const [saving, setSaving] = useState(false);

  const admin = useMemo(
    () => ({ id: superAdmin?.id ?? "", name: superAdmin?.displayName || superAdmin?.email || "Super Admin" }),
    [superAdmin],
  );

  useEffect(() => {
    return watchQuery(
      query(collection(db, "featureRequests"), orderBy("createdAt", "desc")),
      (snap) => {
        setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as FeatureRequest)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  const openId = searchParams.get("open");

  const filtered = useMemo(() => {
    return items.filter((f) => {
      if (typeFilter !== "all" && f.type !== typeFilter) return false;
      if (statusFilter !== "all" && f.status !== statusFilter) return false;
      return true;
    });
  }, [items, typeFilter, statusFilter]);

  async function submitNew() {
    if (!draft.title.trim() || saving) return;
    setSaving(true);
    try {
      await createFeatureRequest(draft, admin);
      setDraft(blankFeatureDraft());
      setAdding(false);
    } finally {
      setSaving(false);
    }
  }

  async function submitClose() {
    if (!closing || !featurePath.trim() || saving) return;
    setSaving(true);
    try {
      await closeFeatureRequestToTesting(closing, featurePath, admin);
      setClosing(null);
      setFeaturePath("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-amber-400" /> Feature Requests
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Feature requests and bugs — from here, from a customer's call, or from testing. Closing hands it to Testing in the To-Do list.
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white transition-colors flex-shrink-0"
        >
          <Plus className="w-4 h-4" /> New request
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex gap-1.5">
          {(["all", ...FEATURE_TYPES.map((t) => t.key)] as const).map((key) => (
            <button
              key={key}
              onClick={() => setTypeFilter(key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                typeFilter === key ? "bg-orange-500 text-white" : "bg-gray-900 border border-gray-800 text-gray-400 hover:text-white"
              }`}
            >
              {key === "all" ? "All types" : FEATURE_TYPE_META[key].label}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {(["all", ...FEATURE_STATUSES.map((s) => s.key)] as const).map((key) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                statusFilter === key ? "bg-orange-500 text-white" : "bg-gray-900 border border-gray-800 text-gray-400 hover:text-white"
              }`}
            >
              {key === "all" ? "All statuses" : FEATURE_STATUS_META[key].label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-600">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-600 py-10 text-center border border-dashed border-gray-800 rounded-xl">
          Nothing here.
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((f) => (
            <li
              key={f.id}
              className={`bg-gray-900 border rounded-xl p-4 ${f.id === openId ? "border-orange-500/50" : "border-gray-800"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex items-center gap-1 ${FEATURE_TYPE_META[f.type].chip}`}>
                      {f.type === "bug" ? <Bug className="w-2.5 h-2.5" /> : <Lightbulb className="w-2.5 h-2.5" />}
                      {FEATURE_TYPE_META[f.type].label}
                    </span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${FEATURE_STATUS_META[f.status].chip}`}>
                      {FEATURE_STATUS_META[f.status].label}
                    </span>
                  </div>
                  <p className="font-medium text-white mt-1.5">{f.title}</p>
                  {f.description && <p className="text-sm text-gray-400 mt-1 whitespace-pre-wrap">{f.description}</p>}
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 flex-wrap">
                    <span>{when(f.createdAt)}{f.createdByName ? ` · ${f.createdByName}` : ""}</span>
                    {f.leadId && (
                      <button
                        onClick={() => navigate("/admin/leads", { state: { leadId: f.leadId } })}
                        className="flex items-center gap-1 text-sky-400 hover:text-sky-300"
                      >
                        <PhoneCall className="w-3 h-3" /> {f.leadName || "Customer"}
                      </button>
                    )}
                    {f.testingTodoId && (
                      <button
                        onClick={() => navigate("/admin/todos")}
                        className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300"
                      >
                        <ListChecks className="w-3 h-3" /> Testing to-do
                      </button>
                    )}
                    {f.sourceTodoId && (
                      <span className="flex items-center gap-1 text-gray-600">
                        <ExternalLink className="w-3 h-3" /> found in testing
                      </span>
                    )}
                    {f.featurePath && <span className="text-gray-600">Path: {f.featurePath}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {f.status === "requested" && (
                    <button
                      onClick={() => startFeatureRequest(f.id)}
                      title="Start working on this"
                      className="p-1.5 rounded-lg text-amber-400 hover:bg-amber-500/10 transition-colors"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  )}
                  {f.status === "in_progress" && (
                    <button
                      onClick={() => { setClosing(f); setFeaturePath(""); }}
                      title="Close — move to testing"
                      className="p-1.5 rounded-lg text-violet-400 hover:bg-violet-500/10 transition-colors"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <AdminModal
          title="New feature request or bug"
          icon={<Lightbulb className="w-4 h-4 text-amber-400" />}
          onClose={() => setAdding(false)}
          footer={
            <>
              <button onClick={() => setAdding(false)} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors">
                Cancel
              </button>
              <button
                onClick={submitNew}
                disabled={saving || !draft.title.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white transition-colors"
              >
                {saving ? "Saving…" : "Create"}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="Type">
              <div className="flex gap-2">
                {FEATURE_TYPES.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setDraft((d) => ({ ...d, type: t.key }))}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      draft.type === t.key ? t.chip : "bg-gray-900 border border-gray-800 text-gray-500"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Title">
              <input
                className={inputClass}
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                autoFocus
              />
            </Field>
            <Field label="Details">
              <textarea
                className={`${inputClass} min-h-[100px] resize-y`}
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              />
            </Field>
            <Field label="Customer (optional)" hint="Link it to a lead so it shows on their profile too.">
              <input
                className={inputClass}
                placeholder="Business name"
                value={draft.leadName ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, leadName: e.target.value }))}
              />
            </Field>
          </div>
        </AdminModal>
      )}

      {closing && (
        <AdminModal
          title="Close — move to testing"
          icon={<CheckCircle2 className="w-4 h-4 text-violet-400" />}
          onClose={() => setClosing(null)}
          footer={
            <>
              <button onClick={() => setClosing(null)} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors">
                <X className="w-4 h-4 inline mr-1" /> Cancel
              </button>
              <button
                onClick={submitClose}
                disabled={saving || !featurePath.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white transition-colors"
              >
                {saving ? "Saving…" : "Move to testing"}
              </button>
            </>
          }
        >
          <Field
            label="Feature path"
            hint="Where the finished work lives — a route, a PR, a file path. A testing to-do is created automatically."
          >
            <input
              className={inputClass}
              placeholder="/src/pages/… or a PR link"
              value={featurePath}
              onChange={(e) => setFeaturePath(e.target.value)}
              autoFocus
            />
          </Field>
        </AdminModal>
      )}
    </div>
  );
}
