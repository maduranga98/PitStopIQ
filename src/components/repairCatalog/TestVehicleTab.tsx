import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import ModelPicker from "./ModelPicker";
import { fieldClass, ghostBtn } from "./Sheet";
import { fetchVehicles } from "../../lib/refData";
import { categoryList } from "../../lib/repairCatalog/catalog.ts";
import { groupsForContext, repairApplies, vehicleContext, type VehicleContext } from "../../lib/repairCatalog/applicability.ts";
import { resolvePartQty, resolveRepairPrice, sourceLabel } from "../../lib/repairCatalog/pricing.ts";
import { modelLabel } from "../../lib/repairCatalog/keys.ts";
import { formatLKR } from "../../lib/reportFormat";
import type { RepairCatalogData } from "../../hooks/useRepairCatalog";
import type { ModelsAndGroups } from "../../hooks/useRepairModels";
import type { InventoryItem, Vehicle } from "../../types/auth";
import type { RepairItem, RepairResolvedFrom, VehicleModel } from "../../types/repairCatalog";

type Mode = "model" | "type" | "vehicle";
const PAGE = 60;

const SOURCE_STYLE: Record<RepairResolvedFrom, string> = {
  model: "bg-[#F97316]/20 text-orange-200",
  group: "bg-sky-500/20 text-sky-200",
  type: "bg-violet-500/20 text-violet-200",
  default: "bg-white/10 text-gray-300",
};

interface Props {
  centerId: string;
  catalog: RepairCatalogData;
  mg: ModelsAndGroups;
  typeOptions: string[];
  canSeeParts: boolean;
  inventory: { items: InventoryItem[]; loaded: boolean };
}

/**
 * Preview what a vehicle would be offered: pick a model, a type, or a real
 * vehicle and see which repairs apply and what each would cost, with the source
 * of every price. For checking a catalog of hundreds of items before staff use it.
 */
export default function TestVehicleTab({ centerId, catalog, mg, typeOptions, canSeeParts, inventory }: Props) {
  const { repairs, storedCategories } = catalog;
  const { models, groups } = mg;
  const [mode, setMode] = useState<Mode>("model");
  const [model, setModel] = useState<VehicleModel | null>(null);
  const [type, setType] = useState("");
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [vq, setVq] = useState("");
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [visible, setVisible] = useState(PAGE);

  // Vehicles are only fetched (from the shared cache) once that mode is opened.
  useEffect(() => {
    if (mode !== "vehicle" || vehicles) return;
    let active = true;
    fetchVehicles(centerId).then((v) => { if (active) setVehicles(v); }).catch(() => { if (active) setVehicles([]); });
    return () => { active = false; };
  }, [mode, vehicles, centerId]);

  const vehicleMatches = useMemo(() => {
    const words = vq.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!vehicles || words.length === 0) return [];
    return vehicles
      .filter((v) => {
        const hay = `${v.plateNumber} ${v.make ?? ""} ${v.model ?? ""} ${v.customerName ?? ""}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 15);
  }, [vehicles, vq]);

  const ctx: VehicleContext | null = useMemo(() => {
    if (mode === "model") return model ? vehicleContext({ modelId: model.id }, models) : null;
    if (mode === "type") return type ? { type, modelId: undefined } : null;
    return vehicle ? vehicleContext(vehicle, models) : null;
  }, [mode, model, type, vehicle, models]);

  const names = useMemo(() => new Map(inventory.items.map((i) => [i.id, i.name])), [inventory.items]);

  const rows = useMemo(() => {
    if (!ctx) return [];
    const order = categoryList(storedCategories, repairs);
    const rank = (c?: string) => { const i = order.findIndex((x) => x.toLowerCase() === (c ?? "").trim().toLowerCase()); return i < 0 ? order.length : i; };
    return repairs
      .filter((r) => r.isActive !== false)
      .map((r) => ({ r, applies: repairApplies(r.appliesTo, ctx, groups), price: resolveRepairPrice(r, ctx, groups) }))
      .filter((x) => showAll || x.applies)
      .sort((a, b) => Number(b.applies) - Number(a.applies) || rank(a.r.category) - rank(b.r.category) || a.r.name.localeCompare(b.r.name));
  }, [ctx, repairs, groups, storedCategories, showAll]);

  const applyingCount = rows.filter((x) => x.applies).length;
  const inGroups = ctx ? groupsForContext(ctx, groups) : [];

  const partsLine = (r: RepairItem) =>
    r.suggestedParts
      .map((p) => `${names.get(p.inventoryItemId) ?? "Unknown part"} ×${resolvePartQty(p, ctx!, groups).value}`)
      .join(", ");

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">Pick a vehicle model, a type, or a real vehicle to see which repairs it would be offered and what each costs.</p>
      <div className="grid grid-cols-3 gap-1 bg-[#0B1120] border border-white/10 rounded-xl p-1">
        {([["model", "Model"], ["type", "Type"], ["vehicle", "Vehicle"]] as const).map(([k, label]) => (
          <button type="button" key={k} onClick={() => { setMode(k); setVisible(PAGE); }}
            className={`py-2 rounded-lg text-sm font-medium ${mode === k ? "bg-[#162032] text-white shadow" : "text-gray-400"}`}>{label}</button>
        ))}
      </div>

      {mode === "model" && (
        <ModelPicker models={models.filter((m) => m.isActive !== false)} selected={model} onSelect={setModel} canAdd={false} onAddNew={() => undefined} />
      )}
      {mode === "type" && (
        <select className={fieldClass} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Choose a vehicle type</option>
          {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      )}
      {mode === "vehicle" && (
        vehicle ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-[#F97316]/40 bg-[#F97316]/10 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">{vehicle.plateNumber}</p>
              <p className="text-xs text-gray-400 truncate">
                {[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "No make/model"} · {vehicle.vehicleType || "no type"}
                {vehicle.modelId ? ` · linked to ${modelLabel(models.find((m) => m.id === vehicle.modelId) ?? { make: "a model", model: "" })}` : " · not linked to a model"}
              </p>
            </div>
            <button type="button" className={ghostBtn} onClick={() => { setVehicle(null); setVq(""); }}>Change</button>
          </div>
        ) : (
          <div className="space-y-2">
            <input className={fieldClass} value={vq} onChange={(e) => setVq(e.target.value)} placeholder={vehicles ? "Search plate, make, model or customer" : "Loading vehicles…"} />
            {vehicleMatches.map((v) => (
              <button type="button" key={v.id} onClick={() => setVehicle(v)}
                className="w-full text-left rounded-xl border border-white/10 bg-[#162032] px-3 py-2.5 hover:bg-white/5">
                <span className="text-sm text-white">{v.plateNumber}</span>
                <span className="text-xs text-gray-500"> · {[v.make, v.model].filter(Boolean).join(" ")} · {v.vehicleType}</span>
              </button>
            ))}
          </div>
        )
      )}

      {ctx && (
        <>
          <div className="text-xs text-gray-400 space-y-1">
            <p>
              {applyingCount} of {repairs.filter((r) => r.isActive !== false).length} active repairs apply.
              {inGroups.length > 0 ? ` In groups: ${inGroups.map((g) => g.name).join(", ")}.` : ""}
            </p>
            {!ctx.modelId && <p className="text-amber-300">No model: only “All vehicles”, the type, and groups covering the whole type can match.</p>}
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
            <input type="checkbox" className="accent-[#F97316]" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Also show repairs that don't apply
          </label>

          {rows.length === 0 ? (
            <p className="text-sm text-gray-500">No repairs would be offered for this vehicle.</p>
          ) : (
            <ul className="space-y-2">
              {rows.slice(0, visible).map(({ r, applies, price }) => (
                <li key={r.id} className={`rounded-xl border border-white/10 bg-[#162032] px-4 py-3 ${applies ? "" : "opacity-50"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{r.name}</p>
                      <p className="text-[11px] text-gray-500">{r.category || "No category"}{applies ? "" : " · not offered"}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-semibold text-white">{formatLKR(price.value)}</p>
                      <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full mt-1 ${SOURCE_STYLE[price.from]}`}>
                        {sourceLabel(price, groups, models)}
                      </span>
                    </div>
                  </div>
                  {price.ambiguous && (
                    <p className="flex items-center gap-1.5 text-[11px] text-amber-300 mt-2">
                      <AlertTriangle className="w-3.5 h-3.5" /> Two groups share the same priority with different prices. Change a priority on the Groups tab.
                    </p>
                  )}
                  {canSeeParts && applies && r.suggestedParts.length > 0 && (
                    <p className="text-[11px] text-gray-400 mt-2">Parts: {partsLine(r)}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {rows.length > visible && (
            <button type="button" className={`${ghostBtn} w-full`} onClick={() => setVisible((v) => v + PAGE)}>Show more ({rows.length - visible} left)</button>
          )}
        </>
      )}
    </div>
  );
}
