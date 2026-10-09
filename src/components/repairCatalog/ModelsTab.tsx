import { useMemo, useState } from "react";
import { Pencil, Plus, Power } from "lucide-react";
import ModelFormDialog from "./ModelFormDialog";
import BulkAssignSheet from "./BulkAssignSheet";
import { fieldClass, primaryBtn, ghostBtn } from "./Sheet";
import { modelLabel, normalizeTypeKey } from "../../lib/repairCatalog/keys.ts";
import { groupsForModel, searchModels } from "../../lib/repairCatalog/models.ts";
import { setVehicleModelActive } from "../../lib/repairCatalog/writes";
import type { ModelsAndGroups } from "../../hooks/useRepairModels";
import type { VehicleModel } from "../../types/repairCatalog";

const PAGE_STEP = 50;

interface Props {
  centerId: string;
  data: ModelsAndGroups;
  typeOptions: string[];
  canManage: boolean;
}

export default function ModelsTab({ centerId, data, typeOptions, canManage }: Props) {
  const { models, groups, setModels, setGroups } = data;
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [visible, setVisible] = useState(PAGE_STEP);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<{ editing?: VehicleModel } | null>(null);
  const [bulk, setBulk] = useState(false);
  const [error, setError] = useState("");

  const filtered = useMemo(() => {
    let list = searchModels(models, q);
    if (!showInactive) list = list.filter((m) => m.isActive !== false);
    if (typeFilter) list = list.filter((m) => normalizeTypeKey(m.vehicleType) === normalizeTypeKey(typeFilter));
    return list;
  }, [models, q, typeFilter, showInactive]);

  const modelTypes = useMemo(
    () => [...new Set(models.map((m) => m.vehicleType).filter(Boolean))].sort(),
    [models],
  );
  const page = filtered.slice(0, visible);
  const toggle = (id: string) =>
    setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function toggleActive(m: VehicleModel) {
    setError("");
    const next = m.isActive === false;
    setModels((prev) => prev.map((x) => (x.id === m.id ? { ...x, isActive: next } : x)));
    try {
      await setVehicleModelActive(centerId, m.id, next);
    } catch {
      setModels((prev) => prev.map((x) => (x.id === m.id ? { ...x, isActive: !next } : x)));
      setError("Couldn't update the model. Try again.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <input className={fieldClass} value={q} onChange={(e) => { setQ(e.target.value); setVisible(PAGE_STEP); }} placeholder="Search make, model or type" />
        <select className={`${fieldClass} sm:w-44`} value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setVisible(PAGE_STEP); }}>
          <option value="">All types</option>
          {modelTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {canManage && (
          <button type="button" className={`${primaryBtn} flex items-center justify-center gap-1.5 whitespace-nowrap`} onClick={() => setForm({})}>
            <Plus className="w-4 h-4" /> Add model
          </button>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{filtered.length} model{filtered.length === 1 ? "" : "s"}</span>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" className="accent-[#F97316]" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show switched-off
        </label>
      </div>

      {canManage && selected.size > 0 && (
        <div className="sticky top-14 z-10 flex items-center justify-between gap-3 rounded-xl border border-[#F97316]/40 bg-[#162032] px-4 py-3">
          <span className="text-sm text-white">{selected.size} selected</span>
          <div className="flex gap-2">
            <button type="button" className={ghostBtn} onClick={() => setSelected(new Set())}>Clear</button>
            <button type="button" className={primaryBtn} onClick={() => setBulk(true)}>Groups…</button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {models.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-[#162032] p-8 text-center">
          <p className="text-sm text-gray-300">No vehicle models yet.</p>
          <p className="text-xs text-gray-500 mt-1">Models give repairs a finer match than the vehicle type, such as Honda Dio or Bajaj Pulsar 150.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {page.map((m) => {
            const memberOf = groupsForModel(groups, m);
            const off = m.isActive === false;
            return (
              <li key={m.id} className={`flex items-start gap-3 rounded-xl border border-white/10 bg-[#162032] px-4 py-3 ${off ? "opacity-60" : ""}`}>
                {canManage && (
                  <input type="checkbox" className="accent-[#F97316] w-4 h-4 mt-1" checked={selected.has(m.id)} onChange={() => toggle(m.id)} aria-label={`Select ${modelLabel(m)}`} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate">{modelLabel(m)}</p>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-gray-300">{m.vehicleType}</span>
                    {off && <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-700/50 text-gray-300">Off</span>}
                    {memberOf.map((g) => (
                      <span key={g.id} className="text-[11px] px-2 py-0.5 rounded-full bg-[#F97316]/15 text-orange-200">{g.name}</span>
                    ))}
                  </div>
                  {m.notes && <p className="text-xs text-gray-500 mt-1 truncate">{m.notes}</p>}
                </div>
                {canManage && (
                  <div className="flex gap-1 flex-shrink-0">
                    <button type="button" className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/5" aria-label="Edit" onClick={() => setForm({ editing: m })}>
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button type="button" className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/5" aria-label={off ? "Switch on" : "Switch off"} onClick={() => toggleActive(m)}>
                      <Power className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {filtered.length > visible && (
        <button type="button" className={`${ghostBtn} w-full`} onClick={() => setVisible((v) => v + PAGE_STEP)}>
          Show more ({filtered.length - visible} left)
        </button>
      )}

      {form && (
        <ModelFormDialog
          centerId={centerId}
          models={models}
          typeOptions={typeOptions}
          editing={form.editing}
          onClose={() => setForm(null)}
          onSaved={(m, outcome) => {
            setModels((prev) => {
              const without = prev.filter((x) => x.id !== m.id);
              return [...without, m].sort((a, b) => modelLabel(a).localeCompare(modelLabel(b)));
            });
            setForm(null);
            if (outcome === "existing") setQ(modelLabel(m));
          }}
        />
      )}
      {bulk && (
        <BulkAssignSheet
          centerId={centerId}
          groups={groups}
          modelIds={[...selected]}
          onClose={() => setBulk(false)}
          onDone={(mode, groupIds) => {
            const ids = [...selected];
            setGroups((prev) => prev.map((g) => {
              if (!groupIds.includes(g.id)) return g;
              const set = new Set(g.modelIds);
              for (const id of ids) { if (mode === "add") set.add(id); else set.delete(id); }
              return { ...g, modelIds: [...set] };
            }));
            setBulk(false);
            setSelected(new Set());
          }}
        />
      )}
    </div>
  );
}
