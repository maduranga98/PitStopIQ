import ModelPicker from "./ModelPicker";
import { fieldClass } from "./Sheet";
import type { RepairScope, VehicleGroup, VehicleModel } from "../../types/repairCatalog";

interface Props {
  scope: RepairScope;
  scopeId: string;
  onChange: (scope: RepairScope, scopeId: string) => void;
  models: VehicleModel[];
  groups: VehicleGroup[];
  typeOptions: string[];
}

/** "For a [model | group | type] [target]": the scope selector shared by price and quantity overrides. */
export default function ScopeTargetField({ scope, scopeId, onChange, models, groups, typeOptions }: Props) {
  const activeGroups = groups.filter((g) => g.isActive !== false || g.id === scopeId);
  return (
    <div className="flex flex-col sm:flex-row gap-2 flex-1 min-w-0">
      <select
        className={`${fieldClass} sm:w-28`}
        value={scope}
        onChange={(e) => onChange(e.target.value as RepairScope, "")}
        aria-label="Applies to"
      >
        <option value="model">Model</option>
        <option value="group">Group</option>
        <option value="type">Type</option>
      </select>
      <div className="flex-1 min-w-0">
        {scope === "type" && (
          <select className={fieldClass} value={scopeId} onChange={(e) => onChange("type", e.target.value)} aria-label="Vehicle type">
            <option value="">Choose a type</option>
            {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            {scopeId && !typeOptions.includes(scopeId) && <option value={scopeId}>{scopeId}</option>}
          </select>
        )}
        {scope === "group" && (
          <select className={fieldClass} value={scopeId} onChange={(e) => onChange("group", e.target.value)} aria-label="Group">
            <option value="">Choose a group</option>
            {activeGroups.map((g) => <option key={g.id} value={g.id}>{g.name} (priority {g.priority})</option>)}
          </select>
        )}
        {scope === "model" && (
          <ModelPicker
            models={models.filter((m) => m.isActive !== false || m.id === scopeId)}
            selected={models.find((m) => m.id === scopeId) ?? null}
            onSelect={(m) => onChange("model", m?.id ?? "")}
            canAdd={false}
            onAddNew={() => undefined}
          />
        )}
      </div>
    </div>
  );
}
