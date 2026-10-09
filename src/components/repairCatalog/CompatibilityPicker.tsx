import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { fieldClass } from "./Sheet";
import { modelLabel, normalizeTypeKey } from "../../lib/repairCatalog/keys.ts";
import { buildCompatibility } from "../../lib/repairCatalog/compatibility.ts";
import type { InventoryCompatibility, VehicleGroup, VehicleModel } from "../../types/repairCatalog";

/** The picker's working state. `mode: "all"` is "All vehicles". */
export interface CompatForm {
  mode: "all" | "specific";
  types: string[];
  groupIds: string[];
  modelIds: string[];
}

export const ALL_VEHICLES: CompatForm = { mode: "all", types: [], groupIds: [], modelIds: [] };

export function compatFormFrom(c: InventoryCompatibility | undefined): CompatForm {
  if (!c || c.universal) return { ...ALL_VEHICLES };
  return { mode: "specific", types: [...(c.types ?? [])], groupIds: [...(c.groupIds ?? [])], modelIds: [...(c.modelIds ?? [])] };
}

/** The value to store, or null while "specific" has nothing picked (not savable). */
export function compatFromForm(f: CompatForm): InventoryCompatibility | null {
  if (f.mode === "all") return buildCompatibility({ universal: true });
  const built = buildCompatibility({ universal: false, types: f.types, groupIds: f.groupIds, modelIds: f.modelIds });
  return built.types.length + built.groupIds.length + built.modelIds.length === 0 ? null : built;
}

interface Props {
  value: CompatForm;
  onChange: (v: CompatForm) => void;
  models: VehicleModel[];
  groups: VehicleGroup[];
  typeOptions: string[];
  /** Catalogs are still loading: selection works, names fill in when they arrive. */
  loading?: boolean;
  idPrefix: string;
}

type Hit = { kind: "type" | "group" | "model"; id: string; label: string; hint: string };
const MAX_RESULTS = 25;

/**
 * "All vehicles" (the default) or specific types, groups and models, picked from
 * one search box over the cached catalogs. No reads of its own.
 */
export default function CompatibilityPicker({ value, onChange, models, groups, typeOptions, loading, idPrefix }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const modelById = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  const hits = useMemo<Hit[]>(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const takenTypes = new Set(value.types.map(normalizeTypeKey));
    const all: Hit[] = [
      ...typeOptions.filter((t) => !takenTypes.has(normalizeTypeKey(t))).map((t) => ({ kind: "type" as const, id: t, label: t, hint: "Vehicle type" })),
      ...groups.filter((g) => g.isActive !== false && !value.groupIds.includes(g.id)).map((g) => ({ kind: "group" as const, id: g.id, label: g.name, hint: "Group" })),
      ...models.filter((m) => m.isActive !== false && !value.modelIds.includes(m.id)).map((m) => ({ kind: "model" as const, id: m.id, label: modelLabel(m), hint: `Model · ${m.vehicleType}` })),
    ];
    return all.filter((h) => words.every((w) => `${h.label} ${h.hint}`.toLowerCase().includes(w))).slice(0, MAX_RESULTS);
  }, [q, typeOptions, groups, models, value]);

  const add = (h: Hit) => {
    onChange({
      ...value, mode: "specific",
      types: h.kind === "type" ? [...value.types, h.id] : value.types,
      groupIds: h.kind === "group" ? [...value.groupIds, h.id] : value.groupIds,
      modelIds: h.kind === "model" ? [...value.modelIds, h.id] : value.modelIds,
    });
    setQ("");
    setOpen(false);
  };

  const chips: { key: string; label: string; hint: string; remove: () => void }[] = [
    ...value.types.map((t) => ({ key: `t:${t}`, label: t, hint: "type", remove: () => onChange({ ...value, types: value.types.filter((x) => x !== t) }) })),
    ...value.groupIds.map((id) => ({ key: `g:${id}`, label: groupById.get(id)?.name ?? (loading ? "…" : "Removed group"), hint: "group", remove: () => onChange({ ...value, groupIds: value.groupIds.filter((x) => x !== id) }) })),
    ...value.modelIds.map((id) => {
      const m = modelById.get(id);
      return { key: `m:${id}`, label: m ? modelLabel(m) : loading ? "…" : "Removed model", hint: "model", remove: () => onChange({ ...value, modelIds: value.modelIds.filter((x) => x !== id) }) };
    }),
  ];

  const radio = (mode: CompatForm["mode"], label: string, hint: string) => (
    <label className="flex items-start gap-2.5 cursor-pointer">
      <input type="radio" name={`${idPrefix}-compat`} checked={value.mode === mode} className="mt-1 accent-[#F97316]"
        onChange={() => onChange({ ...value, mode })} />
      <span>
        <span className="block text-sm font-medium text-gray-200">{label}</span>
        <span className="block text-xs text-gray-500">{hint}</span>
      </span>
    </label>
  );

  return (
    <div className="space-y-3">
      {radio("all", "All vehicles", "Fits any vehicle. This is how every item behaves until you say otherwise.")}
      {radio("specific", "Specific vehicles", "Pick the types, groups or models this part fits.")}

      {value.mode === "specific" && (
        <div className="space-y-2 pl-6">
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <span key={c.key} className="inline-flex items-center gap-1 rounded-lg bg-[#F97316]/15 border border-[#F97316]/30 pl-2 pr-1 py-1 text-xs text-orange-200">
                  {c.label} <span className="text-[10px] text-orange-300/60">{c.hint}</span>
                  <button type="button" onClick={c.remove} className="p-0.5 hover:text-white" aria-label={`Remove ${c.label}`}><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
          )}
          <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
            <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input className={`${fieldClass} pl-9`} value={q} aria-label="Search types, groups and models"
              placeholder={loading ? "Loading vehicles…" : "Search a type, group or model"}
              onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
            {open && q.trim() && (
              <div className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto bg-[#162032] border border-white/10 rounded-xl shadow-xl">
                {hits.map((h) => (
                  <button type="button" key={`${h.kind}:${h.id}`} onMouseDown={(e) => e.preventDefault()} onClick={() => add(h)}
                    className="w-full text-left px-3 py-2 hover:bg-white/5 flex items-center justify-between gap-2">
                    <span className="text-sm text-white truncate">{h.label}</span>
                    <span className="text-[11px] text-gray-500 flex-shrink-0">{h.hint}</span>
                  </button>
                ))}
                {hits.length === 0 && <p className="px-3 py-2.5 text-sm text-gray-500">Nothing matches.</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
