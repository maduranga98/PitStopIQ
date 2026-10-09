import { useMemo, useState } from "react";
import Sheet, { fieldClass, ghostBtn, primaryBtn } from "./Sheet";
import { createVehicleGroup, updateVehicleGroup } from "../../lib/repairCatalog/writes";
import { modelLabel, normalizeTypeKey } from "../../lib/repairCatalog/keys.ts";
import { searchModels } from "../../lib/repairCatalog/models.ts";
import type { VehicleGroup, VehicleModel } from "../../types/repairCatalog";

interface Props {
  centerId: string;
  groups: VehicleGroup[];
  models: VehicleModel[];
  typeOptions: string[];
  editing?: VehicleGroup;
  onClose: () => void;
  onSaved: (group: VehicleGroup) => void;
}

export default function GroupFormSheet({ centerId, groups, models, typeOptions, editing, onClose, onSaved }: Props) {
  const [name, setName] = useState(editing?.name ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [types, setTypes] = useState<string[]>(editing?.types ?? []);
  const [modelIds, setModelIds] = useState<Set<string>>(new Set(editing?.modelIds ?? []));
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const active = useMemo(() => models.filter((m) => m.isActive !== false), [models]);
  const shown = useMemo(() => searchModels(active, q).slice(0, 60), [active, q]);
  const nameTaken = groups.some(
    (g) => g.id !== editing?.id && g.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );

  const toggleType = (t: string) =>
    setTypes((prev) => prev.some((x) => normalizeTypeKey(x) === normalizeTypeKey(t))
      ? prev.filter((x) => normalizeTypeKey(x) !== normalizeTypeKey(t))
      : [...prev, t]);
  const toggleModel = (id: string) =>
    setModelIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function save() {
    setBusy(true);
    setError("");
    const input = { name, types, modelIds: [...modelIds], notes };
    try {
      if (editing) {
        await updateVehicleGroup(centerId, editing.id, input);
        onSaved({ ...editing, name: name.trim(), types, modelIds: input.modelIds, notes });
      } else {
        const id = await createVehicleGroup(centerId, input, groups);
        onSaved({
          id, name: name.trim(), types, modelIds: input.modelIds, notes,
          priority: Math.max(0, ...groups.map((g) => g.priority ?? 0)) + 1,
          isActive: true, centerId,
        } as VehicleGroup);
      }
    } catch {
      setError("Couldn't save. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={editing ? "Edit group" : "New group"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={ghostBtn} onClick={onClose}>Cancel</button>
          <button type="button" className={primaryBtn} disabled={busy || !name.trim() || nameTaken} onClick={save}>
            {busy ? "Saving…" : "Save group"}
          </button>
        </>
      }
    >
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-gray-300">Group name</span>
        <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Scooters" autoFocus />
        {nameTaken && <span className="text-xs text-amber-300">A group with this name already exists.</span>}
      </label>

      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-300">Whole vehicle types <span className="text-gray-500 font-normal">(optional)</span></p>
        <div className="flex flex-wrap gap-2">
          {typeOptions.map((t) => {
            const on = types.some((x) => normalizeTypeKey(x) === normalizeTypeKey(t));
            return (
              <button type="button" key={t} onClick={() => toggleType(t)}
                className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${on ? "bg-[#F97316]/20 border-[#F97316]/50 text-orange-200" : "border-white/10 text-gray-400 hover:text-white"}`}>
                {t}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-300">Models <span className="text-gray-500 font-normal">({modelIds.size} selected)</span></p>
        <input className={fieldClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models" />
        <div className="max-h-56 overflow-y-auto rounded-xl border border-white/10 divide-y divide-white/5">
          {shown.map((m) => (
            <label key={m.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-white/5">
              <input type="checkbox" checked={modelIds.has(m.id)} onChange={() => toggleModel(m.id)} className="accent-[#F97316] w-4 h-4" />
              <span className="text-sm text-white flex-1 truncate">{modelLabel(m)}</span>
              <span className="text-xs text-gray-500">{m.vehicleType}</span>
            </label>
          ))}
          {shown.length === 0 && <p className="px-3 py-3 text-sm text-gray-500">No models match.</p>}
        </div>
      </div>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-gray-300">Notes <span className="text-gray-500 font-normal">(optional)</span></span>
        <input className={fieldClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </Sheet>
  );
}
