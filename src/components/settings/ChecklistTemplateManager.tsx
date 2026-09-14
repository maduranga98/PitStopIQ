// The post-service checklist library: every template the center has, and the
// Add / Edit / Deactivate actions over them.
//
// Owner-only, deliberately — deciding who is allowed to sign a vehicle off is
// the same class of decision as Staff & Roles, not something a Manager
// changes. The security rules enforce the same ceiling, so a Manager who
// reached this screen anyway could not save anything.
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { collection, orderBy, query } from "firebase/firestore";
import { db } from "../../config/firebase";
import { boundedGetDocs } from "../../lib/firestoreRead";
import type { PostServiceChecklistTemplate, StaffMember } from "../../types/auth";
import {
  deactivateTemplate, fetchTemplates, reactivateTemplate,
} from "../../lib/postServiceChecklist";
import ChecklistTemplateEditor from "./ChecklistTemplateEditor";

export default function ChecklistTemplateManager({ centerId }: { centerId: string }) {
  const [templates, setTemplates] = useState<PostServiceChecklistTemplate[] | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [editing, setEditing] = useState<PostServiceChecklistTemplate | null | "new">(null);
  const [confirmOff, setConfirmOff] = useState<PostServiceChecklistTemplate | null>(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  async function reload() {
    try {
      setTemplates(await fetchTemplates(centerId));
      setError("");
    } catch {
      setTemplates([]);
      setError("Couldn't load your checklists. Check your connection and try again.");
    }
  }

  useEffect(() => {
    let live = true;
    fetchTemplates(centerId).then(
      (t) => live && setTemplates(t),
      () => {
        if (!live) return;
        setTemplates([]);
        setError("Couldn't load your checklists. Check your connection and try again.");
      },
    );
    // The assignee picker needs names, not uids. Read once — the editor is
    // opened rarely and a live listener here would outlive it.
    boundedGetDocs(query(collection(db, "servicecenters", centerId, "staff"), orderBy("createdAt", "asc")))
      .then((snap) => {
        if (live) setStaff(snap.docs.map((d) => ({ id: d.id, ...d.data() } as StaffMember)));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [centerId]);

  async function setActive(template: PostServiceChecklistTemplate, active: boolean) {
    setBusyId(template.id);
    setError("");
    try {
      await (active ? reactivateTemplate(centerId, template.id) : deactivateTemplate(centerId, template.id));
      setConfirmOff(null);
      await reload();
    } catch {
      setError("Couldn't save that change. Check your connection and try again.");
    } finally {
      setBusyId("");
    }
  }

  const active = templates?.filter((t) => t.isActive) ?? [];

  return (
    <div className="border-t border-white/5 pt-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Checklists</div>
        <button
          onClick={() => setEditing("new")}
          className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" /> New checklist
        </button>
      </div>

      {templates === null ? (
        <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
        </div>
      ) : templates.length === 0 ? (
        <p className="text-xs text-gray-500">
          No checklists yet. Add the checks a vehicle has to pass before it leaves —
          "wheel nuts torqued", "no tools left in the bay", "seat covers removed".
        </p>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-3 bg-white/5 border border-white/10 rounded-lg px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm truncate ${t.isActive ? "text-white" : "text-gray-500 line-through"}`}>
                    {t.name}
                  </span>
                  {t.isDefault && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/30">
                      Default
                    </span>
                  )}
                  {!t.isActive && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-gray-500 border border-white/10">
                      Inactive
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5 truncate">
                  {t.items.length} {t.items.length === 1 ? "check" : "checks"} ·{" "}
                  {t.allowedRoles.length ? t.allowedRoles.join(", ") : "no role set"}
                  {t.defaultAssignee ? " · pinned" : ""}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => setEditing(t)}
                  aria-label={`Edit ${t.name}`}
                  className="text-gray-400 hover:text-white p-1.5"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                {busyId === t.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500 m-1.5" />
                ) : t.isActive ? (
                  <button
                    onClick={() => setConfirmOff(t)}
                    aria-label={`Deactivate ${t.name}`}
                    className="text-gray-400 hover:text-red-400 p-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button
                    onClick={() => setActive(t, true)}
                    aria-label={`Reactivate ${t.name}`}
                    className="text-gray-400 hover:text-white p-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {templates !== null && active.length === 0 && (
        <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            No active checklist. While this module is on, no job can be marked delivered until
            at least one active checklist exists.
          </span>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {editing !== null && (
        <ChecklistTemplateEditor
          centerId={centerId}
          template={editing === "new" ? null : editing}
          staff={staff}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}

      {confirmOff && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmOff(null)} />
          <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-base font-semibold text-white">Deactivate "{confirmOff.name}"?</h3>
            <p className="text-sm text-gray-400">
              It stops being given to new jobs. Checklists already completed on delivered jobs
              keep their record, which is why it isn't deleted outright — you can reactivate it
              at any time.
            </p>
            {active.length === 1 && (
              <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  This is your only active checklist. Without one, no job can be marked
                  delivered while this module is on.
                </span>
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmOff(null)}
                className="text-sm text-gray-400 hover:text-white px-4 py-2"
              >
                Cancel
              </button>
              <button
                onClick={() => setActive(confirmOff, false)}
                disabled={busyId === confirmOff.id}
                className="bg-red-500/90 hover:bg-red-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
              >
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
