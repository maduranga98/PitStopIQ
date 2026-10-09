import { X } from "lucide-react";
import ModelPicker from "./ModelPicker";
import { modelLabel, normalizeTypeKey } from "../../lib/repairCatalog/keys.ts";
import type { RepairAppliesTo, VehicleGroup, VehicleModel } from "../../types/repairCatalog";

interface Props {
  value: RepairAppliesTo;
  onChange: (v: RepairAppliesTo) => void;
  models: VehicleModel[];
  groups: VehicleGroup[];
  typeOptions: string[];
  error?: string;
}

const chip = (on: boolean) =>
  `px-3 py-1.5 rounded-full text-xs border transition-colors ${on ? "bg-[#F97316]/20 border-[#F97316]/50 text-orange-200" : "border-white/10 text-gray-400 hover:text-white"}`;

/** Which vehicles a repair is offered for: all, or any of the chosen types, groups and models. */
export default function AppliesToEditor({ value, onChange, models, groups, typeOptions, error }: Props) {
  const toggleIn = (list: string[], item: string) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const selectedModels = value.modelIds.map((id) => models.find((m) => m.id === id)).filter((m): m is VehicleModel => !!m);
  const missing = value.modelIds.length - selectedModels.length;

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" className="accent-[#F97316] w-4 h-4" checked={value.all} onChange={(e) => onChange({ ...value, all: e.target.checked })} />
        <span className="text-sm text-white">All vehicles</span>
      </label>
      {!value.all && (
        <div className="space-y-4 pl-1">
          <div className="space-y-2">
            <p className="text-xs text-gray-400">Vehicle types</p>
            <div className="flex flex-wrap gap-2">
              {typeOptions.map((t) => {
                const on = value.types.some((x) => normalizeTypeKey(x) === normalizeTypeKey(t));
                return (
                  <button type="button" key={t} className={chip(on)}
                    onClick={() => onChange({ ...value, types: on ? value.types.filter((x) => normalizeTypeKey(x) !== normalizeTypeKey(t)) : [...value.types, t] })}>
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
          {groups.some((g) => g.isActive !== false) && (
            <div className="space-y-2">
              <p className="text-xs text-gray-400">Groups</p>
              <div className="flex flex-wrap gap-2">
                {groups.filter((g) => g.isActive !== false || value.groupIds.includes(g.id)).map((g) => (
                  <button type="button" key={g.id} className={chip(value.groupIds.includes(g.id))}
                    onClick={() => onChange({ ...value, groupIds: toggleIn(value.groupIds, g.id) })}>
                    {g.name}{g.isActive === false ? " (off)" : ""}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-2">
            <p className="text-xs text-gray-400">Specific models</p>
            {selectedModels.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selectedModels.map((m) => (
                  <span key={m.id} className="inline-flex items-center gap-1 pl-3 pr-1.5 py-1 rounded-full text-xs bg-[#F97316]/20 border border-[#F97316]/50 text-orange-100">
                    {modelLabel(m)}
                    <button type="button" aria-label={`Remove ${modelLabel(m)}`} className="p-0.5 hover:text-white"
                      onClick={() => onChange({ ...value, modelIds: value.modelIds.filter((id) => id !== m.id) })}>
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {missing > 0 && <p className="text-[11px] text-amber-300">{missing} listed model{missing === 1 ? " is" : "s are"} no longer on file.</p>}
            <ModelPicker
              models={models.filter((m) => m.isActive !== false && !value.modelIds.includes(m.id))}
              selected={null}
              onSelect={(m) => { if (m) onChange({ ...value, modelIds: [...value.modelIds, m.id] }); }}
              canAdd={false}
              onAddNew={() => undefined}
            />
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
