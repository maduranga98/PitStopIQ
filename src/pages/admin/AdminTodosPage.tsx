import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, orderBy, query } from "firebase/firestore";
import {
  ListChecks, Plus, Check, ExternalLink, PhoneCall, Bug, X, Trash2,
} from "lucide-react";
import { db } from "../../config/firebase";
import { watchQuery } from "../../lib/listeners";
import { useSuperAdmin } from "../../contexts/SuperAdminContext";
import { createTodo, deleteTodo, reportBugFromTodo, setTodoStatus } from "../../lib/devTracker";
import AdminModal, { Field, inputClass } from "../../components/admin/AdminModal";
import { TODO_STATUSES, type Todo, type TodoDraft, type TodoStatus } from "../../types/devTracker";

function when(ts?: { toDate: () => Date } | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

const KIND_LABEL: Record<Todo["kind"], string> = {
  general: "General",
  testing: "Testing",
  bug_report: "Bug report",
};

/**
 * The super admin's own to-do list. General reminders sit alongside the ones
 * this section creates for itself — a `testing` todo when a feature request
 * closes to Testing — so finishing that todo is what closes the feature
 * request back. A todo can carry a customer and a due time, or neither.
 */
export default function AdminTodosPage() {
  const navigate = useNavigate();
  const { superAdmin } = useSuperAdmin();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | TodoStatus>("open");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<TodoDraft>({ title: "", description: "", dueDate: "", dueTime: "" });
  const [bugFor, setBugFor] = useState<Todo | null>(null);
  const [bugText, setBugText] = useState("");
  const [saving, setSaving] = useState(false);

  const admin = useMemo(
    () => ({ id: superAdmin?.id ?? "", name: superAdmin?.displayName || superAdmin?.email || "Super Admin" }),
    [superAdmin],
  );

  useEffect(() => {
    return watchQuery(
      query(collection(db, "todos"), orderBy("createdAt", "desc")),
      (snap) => {
        setTodos(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Todo)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  const filtered = useMemo(() => {
    if (filter === "open") return todos.filter((t) => t.status !== "done");
    return todos.filter((t) => t.status === filter);
  }, [todos, filter]);

  async function submitNew() {
    if (!draft.title.trim() || saving) return;
    setSaving(true);
    try {
      await createTodo(draft, admin);
      setDraft({ title: "", description: "", dueDate: "", dueTime: "" });
      setAdding(false);
    } finally {
      setSaving(false);
    }
  }

  async function submitBug() {
    if (!bugFor || !bugText.trim() || saving) return;
    setSaving(true);
    try {
      await reportBugFromTodo(bugFor, bugText, admin);
      setBugText("");
      setBugFor(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <ListChecks className="w-5 h-5 text-emerald-400" /> To-Do
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Reminders, linked to a customer or call where relevant. Testing to-dos close their feature request when marked done.
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white transition-colors flex-shrink-0"
        >
          <Plus className="w-4 h-4" /> Add to-do
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {(["open", ...TODO_STATUSES.map((s) => s.key)] as const).map((key) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filter === key ? "bg-orange-500 text-white" : "bg-gray-900 border border-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {key === "open" ? "Open (not done)" : TODO_STATUSES.find((s) => s.key === key)?.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-gray-600">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-600 py-10 text-center border border-dashed border-gray-800 rounded-xl">
          Nothing here.
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((t) => (
            <li key={t.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <button
                  onClick={() => setTodoStatus(t, t.status === "done" ? "open" : "done")}
                  className={`mt-0.5 w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                    t.status === "done" ? "bg-emerald-500 border-emerald-500" : "border-gray-700 hover:border-emerald-500"
                  }`}
                >
                  {t.status === "done" && <Check className="w-3.5 h-3.5 text-white" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`font-medium ${t.status === "done" ? "text-gray-600 line-through" : "text-white"}`}>
                      {t.title}
                    </p>
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-800 text-gray-400">
                      {KIND_LABEL[t.kind]}
                    </span>
                  </div>
                  {t.description && <p className="text-sm text-gray-400 mt-1 whitespace-pre-wrap">{t.description}</p>}
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 flex-wrap">
                    {t.dueAt && <span>Due {when(t.dueAt)}</span>}
                    {t.leadId && (
                      <button
                        onClick={() => navigate("/admin/leads", { state: { leadId: t.leadId } })}
                        className="flex items-center gap-1 text-sky-400 hover:text-sky-300"
                      >
                        <PhoneCall className="w-3 h-3" /> {t.leadName || "Customer"}
                      </button>
                    )}
                    {t.featureRequestId && (
                      <button
                        onClick={() => navigate(`/admin/feature-requests?open=${t.featureRequestId}`)}
                        className="flex items-center gap-1 text-violet-400 hover:text-violet-300"
                      >
                        <ExternalLink className="w-3 h-3" /> Feature request
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {t.kind === "testing" && t.status !== "done" && (
                    <button
                      onClick={() => setBugFor(t)}
                      title="Found a bug while testing"
                      className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Bug className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => deleteTodo(t.id)}
                    title="Delete"
                    className="p-1.5 rounded-lg text-gray-600 hover:text-red-300 hover:bg-gray-800 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <AdminModal
          title="Add to-do"
          icon={<ListChecks className="w-4 h-4 text-emerald-400" />}
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
                {saving ? "Saving…" : "Add"}
              </button>
            </>
          }
        >
          <div className="space-y-4">
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
                className={`${inputClass} min-h-[80px] resize-y`}
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Due date">
                <input
                  type="date"
                  className={inputClass}
                  value={draft.dueDate}
                  onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value }))}
                />
              </Field>
              <Field label="Due time">
                <input
                  type="time"
                  className={inputClass}
                  value={draft.dueTime}
                  onChange={(e) => setDraft((d) => ({ ...d, dueTime: e.target.value }))}
                />
              </Field>
            </div>
          </div>
        </AdminModal>
      )}

      {bugFor && (
        <AdminModal
          title="Report a bug found in testing"
          icon={<Bug className="w-4 h-4 text-red-400" />}
          onClose={() => setBugFor(null)}
          footer={
            <>
              <button onClick={() => setBugFor(null)} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors">
                <X className="w-4 h-4 inline mr-1" /> Cancel
              </button>
              <button
                onClick={submitBug}
                disabled={saving || !bugText.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white transition-colors"
              >
                {saving ? "Saving…" : "Create bug ticket"}
              </button>
            </>
          }
        >
          <Field label="What's wrong" hint="This creates a new bug ticket in Feature Requests, linked back to this test.">
            <textarea
              className={`${inputClass} min-h-[100px] resize-y`}
              value={bugText}
              onChange={(e) => setBugText(e.target.value)}
              autoFocus
            />
          </Field>
        </AdminModal>
      )}
    </div>
  );
}
