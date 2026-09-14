// One post-service checklist template: its lines, who may complete it, and
// whether it is the center's default. Owner-only — mounted by
// ChecklistTemplateManager, which does the access check.
import { useState } from "react";
import {
  ArrowDown, ArrowUp, Loader2, Plus, Trash2, X,
} from "lucide-react";
import type {
  PostServiceChecklistRole, PostServiceChecklistTemplate,
  PostServiceChecklistTemplateItem, StaffMember,
} from "../../types/auth";
import { POST_SERVICE_CHECKLIST_ROLES } from "../../types/auth";
import {
  blankTemplateItem, isChecklistRole, renumber, saveTemplate,
} from "../../lib/postServiceChecklist";

interface Props {
  centerId: string;
  /** null = creating a new template. */
  template: PostServiceChecklistTemplate | null;
  /** Active staff, for the optional assignee picker. */
  staff: StaffMember[];
  onClose: () => void;
  onSaved: () => void;
}

export default function ChecklistTemplateEditor({
  centerId, template, staff, onClose, onSaved,
}: Props) {
  const [name, setName] = useState(template?.name ?? "");
  const [items, setItems] = useState<PostServiceChecklistTemplateItem[]>(
    template?.items.length ? template.items : [blankTemplateItem(0)],
  );
  const [allowedRoles, setAllowedRoles] = useState<PostServiceChecklistRole[]>(
    template?.allowedRoles ?? ["Technician"],
  );
  const [defaultAssignee, setDefaultAssignee] = useState<string | null>(template?.defaultAssignee ?? null);
  const [isActive, setIsActive] = useState(template?.isActive ?? true);
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Only staff who could actually complete this checklist can be pinned to
  // it — pinning anyone else would produce a job nobody is allowed to sign
  // off, and the security rules would refuse the write anyway.
  const assignable = staff.filter(
    (s) => s.active !== false && isChecklistRole(s.role) && allowedRoles.includes(s.role),
  );
  // A pinned assignee who falls outside the roles just selected is dropped on
  // save rather than silently kept.
  const assigneeStale = defaultAssignee !== null && !assignable.some((s) => s.id === defaultAssignee);

  const filledItems = items.filter((i) => i.label.trim().length > 0);
  const canSave = name.trim().length > 0 && filledItems.length > 0 && allowedRoles.length > 0 && !saving;

  function setItemLabel(id: string, label: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, label } : i)));
  }

  function removeItem(id: string) {
    setItems((prev) => (prev.length === 1 ? prev : renumber(prev.filter((i) => i.id !== id))));
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    setItems((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return renumber(next);
    });
  }

  function toggleRole(role: PostServiceChecklistRole) {
    setAllowedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      await saveTemplate(centerId, template?.id ?? null, {
        name,
        items: renumber(filledItems),
        allowedRoles,
        defaultAssignee: assigneeStale ? null : defaultAssignee,
        isActive,
        isDefault,
      });
      onSaved();
    } catch {
      setError("Couldn't save this checklist. Check your connection and try again.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">
            {template ? "Edit checklist" : "New checklist"}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Final QC — full service"
            className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
              Checks ({filledItems.length})
            </label>
            <span className="text-xs text-gray-500">Every check must be ticked to deliver</span>
          </div>
          <div className="space-y-2">
            {items.map((item, index) => (
              <div key={item.id} className="flex items-center gap-2">
                <span className="text-xs text-gray-600 w-4 text-right flex-shrink-0">{index + 1}</span>
                <input
                  type="text"
                  value={item.label}
                  onChange={(e) => setItemLabel(item.id, e.target.value)}
                  placeholder="Wheel nuts torqued"
                  className="flex-1 min-w-0 bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                />
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label="Move up"
                    className="text-gray-500 hover:text-white disabled:opacity-20 disabled:hover:text-gray-500 p-1"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => move(index, 1)}
                    disabled={index === items.length - 1}
                    aria-label="Move down"
                    className="text-gray-500 hover:text-white disabled:opacity-20 disabled:hover:text-gray-500 p-1"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => removeItem(item.id)}
                    disabled={items.length === 1}
                    aria-label="Remove check"
                    className="text-gray-500 hover:text-red-400 disabled:opacity-20 p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={() => setItems((prev) => [...prev, blankTemplateItem(prev.length)])}
            className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> Add a check
          </button>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
            Who can complete it
          </label>
          <div className="flex flex-wrap gap-2">
            {POST_SERVICE_CHECKLIST_ROLES.map((role) => {
              const on = allowedRoles.includes(role);
              return (
                <button
                  key={role}
                  onClick={() => toggleRole(role)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition ${
                    on
                      ? "bg-orange-500/20 text-orange-300 border-orange-500/40"
                      : "bg-white/5 text-gray-400 border-white/10 hover:text-white"
                  }`}
                >
                  {role}
                </button>
              );
            })}
          </div>
          {allowedRoles.length === 0 && (
            <p className="text-xs text-amber-400">
              Pick at least one role, or no one will be able to deliver a job.
            </p>
          )}
          <p className="text-xs text-gray-500">
            Signing a vehicle off is workshop work, so Cashier and Receptionist aren't offered here.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
            Always assign to <span className="text-gray-600 normal-case tracking-normal">(optional)</span>
          </label>
          <select
            value={defaultAssignee ?? ""}
            onChange={(e) => setDefaultAssignee(e.target.value || null)}
            className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
          >
            <option value="">Anyone with the roles above</option>
            {assignable.map((s) => (
              <option key={s.id} value={s.id}>{s.fullName || s.displayName || s.email}</option>
            ))}
          </select>
          {assigneeStale && (
            <p className="text-xs text-amber-400">
              The person pinned here no longer has one of the selected roles — saving will clear it.
            </p>
          )}
          <p className="text-xs text-gray-500">
            Pinning one person doesn't lock the job: an Owner or Manager can hand an unfinished
            checklist to someone else.
          </p>
        </div>

        <div className="space-y-3 border-t border-white/5 pt-4">
          <Row
            label="Active"
            note="Inactive checklists stay on file but are never given to a job."
            checked={isActive}
            onChange={() => {
              setIsActive((v) => !v);
              if (isActive) setIsDefault(false);
            }}
          />
          <Row
            label="Default"
            note="Used straight away when more than one checklist fits the person delivering."
            checked={isDefault}
            disabled={!isActive}
            onChange={() => setIsDefault((v) => !v)}
          />
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="text-sm text-gray-400 hover:text-white px-4 py-2"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition flex items-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {template ? "Save changes" : "Create checklist"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, note, checked, disabled, onChange }: {
  label: string; note: string; checked: boolean; disabled?: boolean; onChange: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm text-white">{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{note}</p>
      </div>
      <button
        onClick={() => !disabled && onChange()}
        disabled={disabled}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-30 disabled:cursor-not-allowed ${
          checked ? "bg-[#F97316]" : "bg-white/10"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
