// One post-service checklist template: its sections and lines (each a status,
// or a status plus a number), who may complete it, and whether it is the
// center's default. Owner-only — mounted by
// ChecklistTemplateManager, which does the access check.
import { useState } from "react";
import {
  ArrowDown, ArrowUp, Loader2, Plus, Trash2, X,
} from "lucide-react";
import type {
  ChecklistItemType, ChecklistSection, ChecklistSectionItem,
  PostServiceChecklistRole, PostServiceChecklistTemplate, StaffMember,
} from "../../types/auth";
import { POST_SERVICE_CHECKLIST_ROLES } from "../../types/auth";
import {
  canCompleteTemplate, isSeniorRole, saveTemplate,
} from "../../lib/postServiceChecklist";
import {
  blankSection, blankSectionItem, cleanSections, renumberAll, sectionsError, templateSections,
} from "../../lib/checklistSections";

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
  // A template saved before sections existed opens as one "Checks" section and
  // is saved back as sectioned — nothing is migrated until the owner edits it.
  const [sections, setSections] = useState<ChecklistSection[]>(() => {
    const existing = template ? templateSections(template) : [];
    return existing.length > 0 ? existing : [blankSection(0)];
  });
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
  // off, and the security rules would refuse the write anyway. Owners and
  // Managers always qualify, whatever roles are picked below.
  const assignable = staff.filter(
    (s) => s.active !== false && canCompleteTemplate({ allowedRoles }, s.role),
  );
  // A pinned assignee who falls outside the roles just selected is dropped on
  // save rather than silently kept.
  const assigneeStale = defaultAssignee !== null && !assignable.some((s) => s.id === defaultAssignee);
  const seniorPinned = defaultAssignee !== null
    && isSeniorRole(staff.find((s) => s.id === defaultAssignee)?.role);

  const checkCount = cleanSections(sections).reduce((n, sec) => n + sec.items.length, 0);
  const problem = sectionsError(sections);
  // No role has to be ticked — Owner and Manager can always complete a
  // checklist, so an empty selection means "management signs these off".
  const canSave = name.trim().length > 0 && !problem && !saving;

  function patchSection(id: string, patch: Partial<ChecklistSection>) {
    setSections((prev) => prev.map((sec) => (sec.id === id ? { ...sec, ...patch } : sec)));
  }
  function patchItem(sectionId: string, itemId: string, patch: Partial<ChecklistSectionItem>) {
    setSections((prev) => prev.map((sec) => (sec.id !== sectionId ? sec : {
      ...sec, items: sec.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
    })));
  }
  function moveIn<T extends { order: number }>(list: T[], index: number, delta: number): T[] {
    const target = index + delta;
    if (target < 0 || target >= list.length) return list;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    return renumberAll(next);
  }
  function moveSection(index: number, delta: number) {
    setSections((prev) => moveIn(prev, index, delta));
  }
  function moveItem(sectionId: string, index: number, delta: number) {
    setSections((prev) => prev.map((sec) => (sec.id !== sectionId ? sec : { ...sec, items: moveIn(sec.items, index, delta) })));
  }
  function removeSection(id: string) {
    setSections((prev) => (prev.length === 1 ? prev : renumberAll(prev.filter((sec) => sec.id !== id))));
  }
  function removeItem(sectionId: string, itemId: string) {
    setSections((prev) => prev.map((sec) => (sec.id !== sectionId || sec.items.length === 1 ? sec : {
      ...sec, items: renumberAll(sec.items.filter((i) => i.id !== itemId)),
    })));
  }
  function addItem(sectionId: string) {
    setSections((prev) => prev.map((sec) => (sec.id !== sectionId ? sec : {
      ...sec, items: [...sec.items, blankSectionItem(sec.items.length)],
    })));
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
        items: [],
        sections,
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

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
              Sections ({checkCount} {checkCount === 1 ? "check" : "checks"})
            </label>
            <span className="text-xs text-gray-500">Each check is rated OK / attention / immediate</span>
          </div>

          {sections.map((sec, si) => (
            <div key={sec.id} className="border border-white/10 rounded-xl p-3 space-y-3 bg-white/[0.02]">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={sec.title}
                  onChange={(e) => patchSection(sec.id, { title: e.target.value })}
                  placeholder="Section title, e.g. Under Hood"
                  className="flex-1 min-w-0 bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:border-orange-500"
                />
                <div className="flex items-center gap-1 flex-shrink-0">
                  <IconBtn label="Move section up" disabled={si === 0} onClick={() => moveSection(si, -1)}><ArrowUp className="w-3.5 h-3.5" /></IconBtn>
                  <IconBtn label="Move section down" disabled={si === sections.length - 1} onClick={() => moveSection(si, 1)}><ArrowDown className="w-3.5 h-3.5" /></IconBtn>
                  <IconBtn label="Remove section" disabled={sections.length === 1} onClick={() => removeSection(sec.id)} danger><Trash2 className="w-3.5 h-3.5" /></IconBtn>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={sec.hasTechnician}
                  onChange={(e) => patchSection(sec.id, { hasTechnician: e.target.checked })}
                  className="accent-orange-500"
                />
                Record a technician name on every line in this section
              </label>

              <div className="space-y-2">
                {sec.items.map((item, ii) => (
                  <div key={item.id} className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                    <span className="text-xs text-gray-600 w-4 text-right flex-shrink-0">{ii + 1}</span>
                    <input
                      type="text"
                      value={item.label}
                      onChange={(e) => patchItem(sec.id, item.id, { label: e.target.value })}
                      placeholder="Wheel nuts torqued"
                      className="flex-1 min-w-[10rem] bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                    />
                    <select
                      value={item.type}
                      onChange={(e) => patchItem(sec.id, item.id, { type: e.target.value as ChecklistItemType })}
                      aria-label="Check type"
                      className="bg-[#0B1120] border border-white/10 text-white rounded-lg px-2 py-2 text-xs focus:outline-none focus:border-orange-500 [&>option]:bg-[#0B1120]"
                    >
                      <option value="status">Status only</option>
                      <option value="status_numeric">Status + value</option>
                    </select>
                    {item.type === "status_numeric" && (
                      <input
                        type="text"
                        value={item.unit ?? ""}
                        onChange={(e) => patchItem(sec.id, item.id, { unit: e.target.value })}
                        placeholder="Unit (V, psi…)"
                        maxLength={12}
                        aria-label="Unit"
                        className="w-24 bg-white/5 border border-white/10 text-white rounded-lg px-2 py-2 text-xs focus:outline-none focus:border-orange-500"
                      />
                    )}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <IconBtn label="Move up" disabled={ii === 0} onClick={() => moveItem(sec.id, ii, -1)}><ArrowUp className="w-3.5 h-3.5" /></IconBtn>
                      <IconBtn label="Move down" disabled={ii === sec.items.length - 1} onClick={() => moveItem(sec.id, ii, 1)}><ArrowDown className="w-3.5 h-3.5" /></IconBtn>
                      <IconBtn label="Remove check" disabled={sec.items.length === 1} onClick={() => removeItem(sec.id, item.id)} danger><Trash2 className="w-3.5 h-3.5" /></IconBtn>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => addItem(sec.id)}
                className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add a check
              </button>
            </div>
          ))}

          <button
            onClick={() => setSections((prev) => [...prev, blankSection(prev.length)])}
            className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> Add a section
          </button>
          {problem && name.trim().length > 0 && <p className="text-xs text-amber-400">{problem}</p>}
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
          <p className="text-xs text-gray-500">
            Owners and Managers can always complete a checklist — this picks who
            <em className="not-italic text-gray-400"> else</em> may. Signing a vehicle off is
            workshop work, so Cashier and Receptionist aren't offered at all.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
            Always assign to <span className="text-gray-600 normal-case tracking-normal">(optional)</span>
          </label>
          <select
            value={defaultAssignee ?? ""}
            onChange={(e) => setDefaultAssignee(e.target.value || null)}
            className="w-full bg-[#0B1120] border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 [&>option]:bg-[#0B1120] [&>option]:text-white"
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
            {seniorPinned
              ? "Pinning holds even for management: only this person can complete it, until an Owner or Manager hands it on."
              : "A pin is the one thing Owners and Managers don't override — they can hand the checklist on, including to themselves, but not sign off someone else's."}
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
            note="The one used for job reminders and standalone checklists when more than one fits."
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

function IconBtn({ label, disabled, onClick, danger, children }: {
  label: string; disabled?: boolean; onClick: () => void; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`text-gray-500 ${danger ? "hover:text-red-400" : "hover:text-white"} disabled:opacity-20 disabled:hover:text-gray-500 p-1`}
    >
      {children}
    </button>
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
