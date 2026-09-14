// The post-service QC checklist as the person delivering the job sees it: a
// plain list of checks, every one of which has to be ticked before the job
// can be handed back. Deliberately simpler than the pre-service inspection —
// no photos, no condition grading, no damage reports.
//
// The instance is created when this opens (so an Owner or Manager can hand it
// to someone else while it is outstanding) and the ticks are written together
// with the sign-off when it is submitted, so an abandoned checklist never
// leaves a half-true record of what was checked.
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ClipboardCheck, Loader2, Lock, X } from "lucide-react";
import type {
  PostServiceChecklist, PostServiceChecklistItem, PostServiceChecklistRole,
  PostServiceChecklistTemplate, StaffMember, UserRole,
} from "../../types/auth";
import {
  allItemsChecked, canCompleteChecklist, canCompleteTemplate, canReassignChecklist,
  completeChecklist, createChecklistInstance, reassignChecklist,
} from "../../lib/postServiceChecklist";

interface Props {
  centerId: string;
  jobId: string;
  /** Set when starting fresh from a chosen template. */
  template: PostServiceChecklistTemplate | null;
  /** Set when resuming a checklist that already exists on the job. */
  existing: PostServiceChecklist | null;
  user: { uid?: string; role?: UserRole };
  /** Active staff, for the Owner/Manager reassignment control. */
  staff: StaffMember[];
  onClose: () => void;
  /** Called once the checklist is signed off — the caller then writes the
   *  status change that this checklist was gating. */
  onCompleted: () => void | Promise<void>;
}

export default function PostServiceChecklistRunner({
  centerId, jobId, template, existing, user, staff, onClose, onCompleted,
}: Props) {
  const [checklist, setChecklist] = useState<PostServiceChecklist | null>(existing);
  const [items, setItems] = useState<PostServiceChecklistItem[]>(existing?.items ?? []);
  const [creating, setCreating] = useState(!existing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const created = useRef(false);

  // Create the instance once, on open. The ref guards React 18's double-invoke
  // in development, which would otherwise write the document twice.
  useEffect(() => {
    if (!template || created.current) return;
    created.current = true;
    createChecklistInstance(centerId, jobId, template).then(
      (instance) => {
        setChecklist(instance);
        setItems(instance.items);
        setCreating(false);
      },
      () => {
        setError("Couldn't start the checklist. Check your connection and try again.");
        setCreating(false);
      },
    );
  }, [centerId, jobId, template]);

  const done = items.filter((i) => i.checked).length;
  const ready = allItemsChecked(items);

  function toggle(id: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, checked: !i.checked } : i)));
  }

  async function handleComplete() {
    if (!ready || saving || !user.uid) return;
    setSaving(true);
    setError("");
    try {
      await completeChecklist(centerId, jobId, items, user.uid);
      await onCompleted();
    } catch {
      setError("Couldn't save the checklist. Check your connection and try again.");
      setSaving(false);
    }
  }

  async function handleReassign(uid: string) {
    if (!checklist) return;
    const next = uid || null;
    const previous = checklist.assignedTo;
    setChecklist({ ...checklist, assignedTo: next });
    try {
      await reassignChecklist(centerId, jobId, next);
    } catch {
      setChecklist({ ...checklist, assignedTo: previous });
      setError("Couldn't reassign the checklist. Check your connection and try again.");
    }
  }

  // Reassignment is offered to Owner/Manager while the checklist is still
  // open, and only to staff who could actually complete it.
  const canReassign = canReassignChecklist(user.role) && !!checklist;
  const assignable = staff.filter(
    (s) => s.active !== false
        && canCompleteTemplate({ allowedRoles: checklist?.allowedRoles ?? [] }, s.role),
  );
  // Someone can be looking at a checklist they may not finish: an Owner who
  // pinned it to a technician, say. The gate keeps them out of here in the
  // ordinary case, but the control stays honest either way.
  const mayComplete = checklist ? canCompleteChecklist(checklist, user) : false;
  const assigneeName = (uid: string) =>
    staff.find((s) => s.id === uid)?.fullName
    ?? staff.find((s) => s.id === uid)?.displayName
    ?? "another staff member";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={saving ? undefined : onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-[#F97316] flex-shrink-0" />
              <h3 className="text-base font-semibold text-white truncate">
                {checklist?.templateName ?? template?.name ?? "Post-service check"}
              </h3>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Every check has to be ticked before this job can be marked delivered.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="text-gray-500 hover:text-gray-300 transition flex-shrink-0 disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {creating ? (
          <div className="flex items-center gap-2 text-xs text-gray-500 py-6 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Starting the checklist…
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#F97316] transition-all duration-200"
                  style={{ width: items.length ? `${(done / items.length) * 100}%` : "0%" }}
                />
              </div>
              <span className="text-xs text-gray-400 flex-shrink-0 tabular-nums">
                {done}/{items.length}
              </span>
            </div>

            <div className="space-y-2">
              {items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => mayComplete && toggle(item.id)}
                  disabled={!mayComplete || saving}
                  role="checkbox"
                  aria-checked={item.checked}
                  className={`w-full flex items-center gap-3 text-left rounded-lg px-3 py-2.5 border transition disabled:cursor-not-allowed ${
                    item.checked
                      ? "bg-green-500/10 border-green-500/30"
                      : "bg-white/5 border-white/10 hover:border-white/20"
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 transition ${
                      item.checked ? "bg-green-500 border-green-500" : "border-white/25"
                    }`}
                  >
                    {item.checked && <Check className="w-3.5 h-3.5 text-white" />}
                  </span>
                  <span className={`text-sm min-w-0 ${item.checked ? "text-green-200" : "text-white"}`}>
                    {item.label}
                  </span>
                </button>
              ))}
            </div>

            {!mayComplete && checklist && (
              <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  {checklist.assignedTo
                    ? `This checklist is assigned to ${assigneeName(checklist.assignedTo)}.`
                    : `Only ${[...new Set([...checklist.allowedRoles, "Owner", "Manager"])].join(", ")} can complete this checklist.`}
                </span>
              </div>
            )}

            {canReassign && (
              <div className="space-y-1.5 border-t border-white/5 pt-4">
                <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                  Assigned to
                </label>
                <select
                  value={checklist?.assignedTo ?? ""}
                  onChange={(e) => handleReassign(e.target.value)}
                  disabled={saving}
                  className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 disabled:opacity-40"
                >
                  <option value="">Anyone who can complete it</option>
                  {assignable.map((s) => (
                    <option key={s.id} value={s.id}>{s.fullName || s.displayName || s.email}</option>
                  ))}
                </select>
              </div>
            )}

            {error && <p className="text-xs text-red-400">{error}</p>}

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onClose}
                disabled={saving}
                className="text-sm text-gray-400 hover:text-white px-4 py-2 disabled:opacity-40"
              >
                Not now
              </button>
              <button
                onClick={handleComplete}
                disabled={!ready || !mayComplete || saving}
                className="bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-lg transition flex items-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? "Delivering…" : "Complete & mark delivered"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The two states where delivery is refused outright: the center has no active
 * checklist at all (a setup fault the Owner has to fix), or this person holds
 * none of the roles any active checklist names. Both fail loudly — the toggle
 * being on means the Owner wants the gate, so silently delivering anyway would
 * defeat the point of it.
 */
export function ChecklistBlockedNotice({ reason, waitingOn, isOwnerOrManager, onClose }: {
  reason: "no-templates" | "wrong-role";
  waitingOn?: PostServiceChecklistRole[];
  isOwnerOrManager: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-white">
              {reason === "no-templates" ? "No checklist is set up" : "Waiting on someone else"}
            </h3>
            <p className="text-sm text-gray-400 mt-1.5">
              {reason === "no-templates" ? (
                isOwnerOrManager ? (
                  <>
                    The post-service checklist is switched on, but no active checklist exists yet.
                    Add one in Settings → Services &amp; Modules → Post-Service Checklist before
                    jobs can be delivered.
                  </>
                ) : (
                  <>
                    The post-service checklist is switched on, but none has been set up yet. Ask
                    the Owner to add one — jobs can't be delivered until then.
                  </>
                )
              ) : (
                <>
                  This job needs a post-service check signed off by{" "}
                  {waitingOn?.length ? waitingOn.join(" or ") : "someone else"} before it can be
                  handed back.
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="bg-white/10 hover:bg-white/15 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
