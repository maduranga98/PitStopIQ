import { useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import ScopeTargetField from "./ScopeTargetField";
import { fieldClass } from "./Sheet";
import type { SuggestedPartForm } from "../../lib/repairCatalog/form.ts";
import { itemBrand } from "../../lib/inventoryOptions";
import type { InventoryItem } from "../../types/auth";
import type { VehicleGroup, VehicleModel } from "../../types/repairCatalog";

interface Props {
  value: SuggestedPartForm[];
  onChange: (v: SuggestedPartForm[]) => void;
  /** The cached inventory catalog (already filtered to non-archived). */
  items: InventoryItem[];
  loaded: boolean;
  models: VehicleModel[];
  groups: VehicleGroup[];
  typeOptions: string[];
  errors: Record<string, string>;
}

const MAX_RESULTS = 20;

/** Pick inventory parts for a repair: search-as-you-type over the cached list, default qty, optional overrides. */
export default function SuggestedPartsEditor({ value, onChange, items, loaded, models, groups, typeOptions, errors }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const results = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const taken = new Set(value.map((p) => p.inventoryItemId));
    return items
      .filter((i) => !taken.has(i.id))
      .filter((i) => {
        const hay = `${i.name} ${i.partNumber ?? ""} ${itemBrand(i)}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, MAX_RESULTS);
  }, [q, items, value]);

  const patch = (i: number, p: Partial<SuggestedPartForm>) => onChange(value.map((x, j) => (j === i ? { ...x, ...p } : x)));

  return (
    <div className="space-y-3">
      {value.map((p, i) => {
        const item = byId.get(p.inventoryItemId);
        const name = item?.name ?? (p.name || "Unknown part");
        return (
          <div key={p.inventoryItemId} className="rounded-xl border border-white/10 bg-[#0B1120] p-3 space-y-2">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white truncate">{name}</p>
                <p className="text-[11px] text-gray-500">
                  {item ? `${item.currentQty} ${item.unit} in stock` : loaded ? "No longer in inventory" : "Loading…"}
                </p>
              </div>
              <input
                type="number" min="0" step="any" inputMode="decimal"
                className="w-20 bg-[#162032] border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white text-right"
                value={p.defaultQty} onChange={(e) => patch(i, { defaultQty: e.target.value })} aria-label={`Quantity of ${name}`}
              />
              <button type="button" className="p-2 text-gray-400 hover:text-red-400" aria-label={`Remove ${name}`}
                onClick={() => onChange(value.filter((_, j) => j !== i))}>
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            {errors[`part.${i}`] && <p className="text-xs text-red-400">{errors[`part.${i}`]}</p>}

            {p.overrides.map((o, j) => (
              <div key={j} className="space-y-1">
                <div className="flex items-start gap-2">
                  <ScopeTargetField scope={o.scope} scopeId={o.scopeId} models={models} groups={groups} typeOptions={typeOptions}
                    onChange={(scope, scopeId) => patch(i, { overrides: p.overrides.map((x, k) => (k === j ? { ...x, scope, scopeId } : x)) })} />
                  <input type="number" min="0" step="any" inputMode="decimal"
                    className="w-20 bg-[#162032] border border-white/10 rounded-lg px-2 py-2.5 text-sm text-white text-right"
                    value={o.qty} onChange={(e) => patch(i, { overrides: p.overrides.map((x, k) => (k === j ? { ...x, qty: e.target.value } : x)) })} aria-label="Quantity override" />
                  <button type="button" className="p-2 text-gray-400 hover:text-red-400" aria-label="Remove quantity override"
                    onClick={() => patch(i, { overrides: p.overrides.filter((_, k) => k !== j) })}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {errors[`part.${i}.${j}`] && <p className="text-xs text-red-400">{errors[`part.${i}.${j}`]}</p>}
              </div>
            ))}
            <button type="button" className="text-xs text-[#F97316] hover:underline"
              onClick={() => patch(i, { overrides: [...p.overrides, { scope: "model", scopeId: "", qty: p.defaultQty || "1" }] })}>
              + Different quantity for a model, group or type
            </button>
          </div>
        );
      })}

      <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
        <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          className={`${fieldClass} pl-9`} value={q} placeholder={loaded ? "Search parts by name, code or brand" : "Loading parts…"}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        />
        {open && q.trim() && (
          <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-[#162032] border border-white/10 rounded-xl shadow-xl">
            {results.map((i) => (
              <button type="button" key={i.id} onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange([...value, { inventoryItemId: i.id, name: i.name, defaultQty: "1", overrides: [] }]); setQ(""); setOpen(false); }}
                className="w-full text-left px-3 py-2.5 hover:bg-white/5 flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block text-sm text-white truncate">{i.name}</span>
                  <span className="block text-[11px] text-gray-500 truncate">{[itemBrand(i), i.partNumber].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-gray-400">{i.currentQty} {i.unit}</span>
                  <Plus className="w-4 h-4 text-[#F97316]" />
                </span>
              </button>
            ))}
            {results.length === 0 && <p className="px-3 py-2.5 text-sm text-gray-500">No matching part.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
