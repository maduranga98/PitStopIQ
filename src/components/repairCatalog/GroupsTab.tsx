import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Power } from "lucide-react";
import GroupFormSheet from "./GroupFormSheet";
import { primaryBtn } from "./Sheet";
import { reorderPriorities, sortGroups } from "../../lib/repairCatalog/models.ts";
import { saveGroupPriorities, setVehicleGroupActive } from "../../lib/repairCatalog/writes";
import type { ModelsAndGroups } from "../../hooks/useRepairModels";
import type { VehicleGroup } from "../../types/repairCatalog";

interface Props {
  centerId: string;
  data: ModelsAndGroups;
  typeOptions: string[];
  canManage: boolean;
}

export default function GroupsTab({ centerId, data, typeOptions, canManage }: Props) {
  const { models, groups, setGroups } = data;
  const [form, setForm] = useState<{ editing?: VehicleGroup } | null>(null);
  const [error, setError] = useState("");
  const ordered = sortGroups(groups);

  async function move(from: number, to: number) {
    const changes = reorderPriorities(ordered, from, to);
    if (changes.length === 0) return;
    setError("");
    const before = groups;
    const byId = new Map(changes.map((c) => [c.id, c.priority]));
    setGroups((prev) => prev.map((g) => (byId.has(g.id) ? { ...g, priority: byId.get(g.id)! } : g)));
    try {
      await saveGroupPriorities(centerId, changes);
    } catch {
      setGroups(before);
      setError("Couldn't save the new order. Try again.");
    }
  }

  async function toggleActive(g: VehicleGroup) {
    setError("");
    const next = g.isActive === false;
    setGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, isActive: next } : x)));
    try {
      await setVehicleGroupActive(centerId, g.id, next);
    } catch {
      setGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, isActive: !next } : x)));
      setError("Couldn't update the group. Try again.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-gray-500 max-w-md">
          A group bundles models (and optionally whole vehicle types), such as “Scooters”. When a model sits in several groups
          that each set a price, the group with the <strong className="text-gray-300">lower priority number wins</strong>.
        </p>
        {canManage && (
          <button type="button" className={`${primaryBtn} flex items-center gap-1.5 whitespace-nowrap`} onClick={() => setForm({})}>
            <Plus className="w-4 h-4" /> New group
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {ordered.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-[#162032] p-8 text-center">
          <p className="text-sm text-gray-300">No groups yet.</p>
          <p className="text-xs text-gray-500 mt-1">Groups are optional. Models and vehicle types work without them.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {ordered.map((g, i) => {
            const off = g.isActive === false;
            return (
              <li key={g.id} className={`flex items-start gap-3 rounded-xl border border-white/10 bg-[#162032] px-4 py-3 ${off ? "opacity-60" : ""}`}>
                <span className="mt-0.5 w-7 h-7 flex-shrink-0 rounded-full bg-white/5 text-xs font-semibold text-gray-300 flex items-center justify-center" title="Priority">
                  {g.priority}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate">{g.name}</p>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-gray-300">
                      {g.modelIds.length} model{g.modelIds.length === 1 ? "" : "s"}
                    </span>
                    {g.types.map((t) => (
                      <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-[#F97316]/15 text-orange-200">all {t}</span>
                    ))}
                    {off && <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-700/50 text-gray-300">Off</span>}
                  </div>
                </div>
                {canManage && (
                  <div className="flex gap-0.5 flex-shrink-0">
                    <button type="button" disabled={i === 0} className="p-2 text-gray-400 hover:text-white disabled:opacity-30 rounded-lg hover:bg-white/5" aria-label="Higher priority" onClick={() => move(i, i - 1)}><ArrowUp className="w-4 h-4" /></button>
                    <button type="button" disabled={i === ordered.length - 1} className="p-2 text-gray-400 hover:text-white disabled:opacity-30 rounded-lg hover:bg-white/5" aria-label="Lower priority" onClick={() => move(i, i + 1)}><ArrowDown className="w-4 h-4" /></button>
                    <button type="button" className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/5" aria-label="Edit" onClick={() => setForm({ editing: g })}><Pencil className="w-4 h-4" /></button>
                    <button type="button" className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/5" aria-label={off ? "Switch on" : "Switch off"} onClick={() => toggleActive(g)}><Power className="w-4 h-4" /></button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!canManage && ordered.length > 0 && <p className="text-xs text-gray-500">You can view groups but not change them.</p>}

      {form && (
        <GroupFormSheet
          centerId={centerId}
          groups={groups}
          models={models}
          typeOptions={typeOptions}
          editing={form.editing}
          onClose={() => setForm(null)}
          onSaved={(g) => {
            setGroups((prev) => (prev.some((x) => x.id === g.id) ? prev.map((x) => (x.id === g.id ? { ...x, ...g } : x)) : [...prev, g]));
            setForm(null);
          }}
        />
      )}
    </div>
  );
}
