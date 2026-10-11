import { useMemo, useState } from "react";
import { Package, Plus, Search, Wrench, X } from "lucide-react";
import { useRepairCatalog, useInventoryForParts } from "../../hooks/useRepairCatalog";
import { useModelsAndGroups } from "../../hooks/useRepairModels";
import {
  addRepair, attachPartIds, customRepair, jobRepairContext, jobRepairGroups, overrideRepairPrice, parsePrice,
  pickRepair, priceSourceText, removeRepair, repairsForPicker, hasRepair, type JobVehicle,
} from "../../lib/repairCatalog/jobRepairs.ts";
import { addPartSnapshot, parseQtyInput, shortOfStock, suggestedPartRows } from "../../lib/repairCatalog/jobParts.ts";
import { sortPartsForVehicle } from "../../lib/repairCatalog/compatibility.ts";
import type { InventoryItem, PartUsed } from "../../types/auth";
import type { RepairItem, RepairPerformed } from "../../types/repairCatalog";

export interface RepairPickerChange {
  repairs: RepairPerformed[];
  /** Present only when the change also added parts. The caller stores it exactly like its own "Add Part". */
  partsUsed?: PartUsed[];
}

interface Props {
  centerId: string;
  vehicle: JobVehicle;
  repairs: RepairPerformed[];
  partsUsed: PartUsed[];
  /**
   * Whether the parts section exists at all. The page passes ITS OWN rule for
   * adding parts (Pro plan, jobs.addParts / edit) AND canReadInventory(role),
   * so this never grants a role the ability to add parts, and a role that
   * cannot read inventory (Receptionist) sees the repairs with no parts
   * section and no inventory read.
   */
  partsEnabled: boolean;
  onChange: (change: RepairPickerChange) => void;
}

const lkr = new Intl.NumberFormat();
const input = "bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500";

interface Draft { repair: RepairItem; price: string; checked: Record<string, boolean>; qty: Record<string, string> }

/**
 * Repairs on a job: pick from the catalog (filtered for the vehicle), see where
 * the price came from, take the suggested parts, or type a one-off. Rendered
 * only when the Repair Catalog is on and the user may use it; its catalogs load
 * once, through the cached loaders, when it mounts.
 */
export default function RepairPicker({ centerId, vehicle, repairs, partsUsed, partsEnabled, onChange }: Props) {
  const catalog = useRepairCatalog(centerId, true);
  const mg = useModelsAndGroups(centerId, true);
  const stock = useInventoryForParts(centerId, partsEnabled);

  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [partQ, setPartQ] = useState("");
  const [extraPart, setExtraPart] = useState<InventoryItem | null>(null);
  const [extraQty, setExtraQty] = useState("1");

  const ctx = useMemo(() => jobRepairContext(vehicle, mg.models), [vehicle, mg.models]);
  const groups = useMemo(() => jobRepairGroups(vehicle, mg.groups), [vehicle, mg.groups]);
  const inventoryById = useMemo(() => new Map(stock.items.map((i) => [i.id, i])), [stock.items]);

  const offered = useMemo(
    () => repairsForPicker(catalog.repairs, vehicle, mg.models, mg.groups, showAll),
    [catalog.repairs, vehicle, mg.models, mg.groups, showAll],
  );
  const grouped = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hits = offered.filter((r) => words.every((w) => `${r.name} ${r.category ?? ""}`.toLowerCase().includes(w)));
    const byCat = new Map<string, RepairItem[]>();
    for (const r of hits) {
      const c = r.category?.trim() || "Other";
      byCat.set(c, [...(byCat.get(c) ?? []), r]);
    }
    return [...byCat.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [offered, q]);

  const openDraft = (repair: RepairItem) => {
    const { entry } = pickRepair(repair, vehicle, mg.models, mg.groups);
    const rows = partsEnabled ? suggestedPartRows(repair, ctx, groups, inventoryById) : [];
    setDraft({
      repair,
      price: String(entry.price),
      checked: Object.fromEntries(rows.map((r) => [r.itemId, true])),
      qty: Object.fromEntries(rows.map((r) => [r.itemId, String(r.qty)])),
    });
  };

  const draftRows = useMemo(
    () => (draft && partsEnabled ? suggestedPartRows(draft.repair, ctx, groups, inventoryById) : []),
    [draft, partsEnabled, ctx, groups, inventoryById],
  );

  const confirmDraft = () => {
    if (!draft) return;
    const price = parsePrice(draft.price);
    if (price == null) return;
    const picked = pickRepair(draft.repair, vehicle, mg.models, mg.groups);
    let entry: RepairPerformed = picked.entry;
    // Resolved as picked; a different typed price is an override, not a new source.
    if (price !== picked.entry.price) entry = { ...entry, price, priceOverridden: true };
    let parts = partsUsed;
    const added: string[] = [];
    for (const row of draftRows) {
      const qty = parseQtyInput(draft.qty[row.itemId] ?? "");
      if (!draft.checked[row.itemId] || qty == null) continue;
      parts = addPartSnapshot(parts, row.item, qty);
      added.push(row.itemId);
    }
    const next = attachPartIds(addRepair(repairs, entry), entry.repairItemId, added);
    onChange(added.length > 0 ? { repairs: next, partsUsed: parts } : { repairs: next });
    setDraft(null);
  };

  const addCustom = () => {
    const price = parsePrice(customPrice);
    if (!customName.trim() || price == null) return;
    onChange({ repairs: addRepair(repairs, customRepair(customName, price)) });
    setCustomName(""); setCustomPrice("");
  };

  const partMatches = useMemo(() => {
    const words = partQ.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const hits = stock.items.filter((i) =>
      words.every((w) => `${i.name} ${i.partNumber ?? ""} ${i.brand ?? ""}`.toLowerCase().includes(w)));
    // Parts that fit this vehicle first, then everything else.
    return sortPartsForVehicle(hits, { vehicleType: ctx.type, modelId: ctx.modelId }, { models: mg.models, groups })
      .slice(0, 12);
  }, [partQ, stock.items, ctx, mg.models, groups]);

  const onJobQty = (id: string) => partsUsed.find((p) => p.itemId === id)?.quantity ?? 0;

  const addExtraPart = () => {
    const qty = parseQtyInput(extraQty);
    if (!extraPart || qty == null) return;
    onChange({ repairs, partsUsed: addPartSnapshot(partsUsed, extraPart, qty) });
    setExtraPart(null); setPartQ(""); setExtraQty("1");
  };

  return (
    <div className="border border-white/10 rounded-xl p-4 space-y-4 bg-white/[0.02]">
      <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wider font-semibold">
        <Wrench className="w-3.5 h-3.5 text-orange-400" /> Repairs
      </div>

      {/* On the job */}
      {repairs.length > 0 && (
        <ul className="space-y-2">
          {repairs.map((r) => (
            <li key={r.repairItemId} className="flex items-center gap-2 text-sm bg-white/5 border border-white/10 rounded-lg px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-white truncate">{r.name}</p>
                <p className="text-[11px] text-gray-500">{priceSourceText(r, mg.groups)}</p>
              </div>
              <span className="text-gray-400 text-xs">LKR</span>
              <input
                type="number" min="0" step="any" inputMode="decimal" defaultValue={r.price} key={`${r.repairItemId}:${r.price}`}
                aria-label={`Price of ${r.name}`}
                onBlur={(e) => {
                  const p = parsePrice(e.target.value);
                  if (p != null && p !== r.price) onChange({ repairs: overrideRepairPrice(repairs, r.repairItemId, p) });
                }}
                className="w-24 bg-[#0B1120] border border-white/10 rounded-lg px-2 py-1 text-sm text-white text-right"
              />
              {/* Removes this repair only; parts already added stay on the job. */}
              <button type="button" aria-label={`Remove ${r.name}`} onClick={() => onChange({ repairs: removeRepair(repairs, r.repairItemId) })}
                className="text-gray-600 hover:text-red-400"><X className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      )}

      {/* Search + catalog */}
      {catalog.error || mg.error ? (
        <p className="text-sm text-gray-400">
          Couldn't load repairs.{" "}
          <button type="button" className="text-orange-400 hover:underline" onClick={() => { catalog.retry(); mg.retry(); }}>Try again</button>
        </p>
      ) : !catalog.loaded || !mg.loaded ? (
        <p className="text-sm text-gray-500">Loading repairs…</p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input className={`${input} w-full pl-9`} placeholder="Search repairs…" aria-label="Search repairs" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-gray-400 whitespace-nowrap">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all repairs
            </label>
          </div>

          {grouped.length === 0 ? (
            <p className="text-sm text-gray-500 border border-dashed border-white/10 rounded-lg px-3 py-4 text-center">
              {catalog.repairs.length === 0
                ? "No repairs set up yet. The owner adds them under Repair Catalog."
                : showAll || q.trim()
                  ? "No repair matches."
                  : "No repair is set up for this vehicle. Turn on “Show all repairs” to see the rest."}
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-3">
              {grouped.map(([category, list]) => (
                <div key={category}>
                  <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">{category}</p>
                  <ul className="space-y-1">
                    {list.map((r) => {
                      const on = hasRepair(repairs, r.id);
                      const p = pickRepair(r, vehicle, mg.models, mg.groups);
                      return (
                        <li key={r.id}>
                          <button type="button" disabled={on} onClick={() => openDraft(r)}
                            className="w-full text-left flex items-center justify-between gap-2 px-3 py-2 rounded-lg hover:bg-white/5 disabled:opacity-40">
                            <span className="text-sm text-white truncate">{r.name}{on && <span className="ml-2 text-[10px] text-gray-500">added</span>}</span>
                            <span className="text-xs text-gray-400 flex-shrink-0">LKR {lkr.format(p.entry.price)} · {priceSourceText(p.entry, mg.groups)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* The repair being added: price and suggested parts */}
      {draft && (
        <div className="border border-orange-500/30 rounded-lg p-3 space-y-3 bg-orange-500/5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-white font-medium truncate">{draft.repair.name}</p>
            <button type="button" className="text-xs text-gray-400 hover:text-white" onClick={() => setDraft(null)}>Cancel</button>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            Price (LKR)
            <input type="number" min="0" step="any" inputMode="decimal" className={`${input} w-28 text-right`} value={draft.price}
              onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
            <span className="text-[11px] text-gray-500">
              {priceSourceText(pickRepair(draft.repair, vehicle, mg.models, mg.groups).entry, mg.groups)}
            </span>
          </label>
          {partsEnabled && (
            <div className="space-y-1.5">
              {!stock.loaded ? (
                <p className="text-xs text-gray-500">Loading stock…</p>
              ) : draftRows.length === 0 ? (
                <p className="text-xs text-gray-500">No suggested parts for this repair.</p>
              ) : (
                <>
                  <p className="text-xs text-gray-400">Suggested parts</p>
                  {draftRows.map((row) => {
                    const qty = parseQtyInput(draft.qty[row.itemId] ?? "");
                    const short = qty != null && shortOfStock(row.available, qty, onJobQty(row.itemId));
                    return (
                      <div key={row.itemId} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={!!draft.checked[row.itemId]} aria-label={`Add ${row.item.name}`}
                          onChange={(e) => setDraft({ ...draft, checked: { ...draft.checked, [row.itemId]: e.target.checked } })} />
                        <span className="min-w-0 flex-1 truncate text-white">{row.item.name}
                          <span className={`ml-2 text-[11px] ${short ? "text-amber-400" : "text-gray-500"}`}>
                            stock {row.available} {row.item.unit}{short ? " — not enough" : ""}
                          </span>
                        </span>
                        <input type="number" min="0" step="any" inputMode="decimal" aria-label={`Quantity of ${row.item.name}`}
                          className="w-16 bg-[#0B1120] border border-white/10 rounded-lg px-2 py-1 text-sm text-white text-right"
                          value={draft.qty[row.itemId] ?? ""} onChange={(e) => setDraft({ ...draft, qty: { ...draft.qty, [row.itemId]: e.target.value } })} />
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
          <button type="button" disabled={parsePrice(draft.price) == null} onClick={confirmDraft}
            className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm">
            Add to job
          </button>
        </div>
      )}

      {/* A one-off repair */}
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${input} flex-1 min-w-[10rem]`} placeholder="Other repair (name)" aria-label="Custom repair name" value={customName} onChange={(e) => setCustomName(e.target.value)} />
        <input type="number" min="0" step="any" inputMode="decimal" className={`${input} w-28 text-right`} placeholder="Price" aria-label="Custom repair price" value={customPrice} onChange={(e) => setCustomPrice(e.target.value)} />
        <button type="button" onClick={addCustom} disabled={!customName.trim() || parsePrice(customPrice) == null}
          className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 disabled:opacity-40"><Plus className="w-3.5 h-3.5" /> Add</button>
      </div>

      {/* Other parts, compatible ones first. Only where the page lets this role add parts. */}
      {partsEnabled && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400 flex items-center gap-1.5"><Package className="w-3.5 h-3.5" /> Add another part</p>
          <input className={`${input} w-full`} placeholder="Search inventory by name, brand or item code…" aria-label="Search parts"
            value={partQ} onChange={(e) => { setPartQ(e.target.value); setExtraPart(null); }} />
          {partMatches.length > 0 && !extraPart && (
            <ul className="bg-[#0B1120] border border-white/10 rounded-lg overflow-hidden">
              {partMatches.map((i) => (
                <li key={i.id}>
                  <button type="button" onClick={() => { setExtraPart(i); setPartQ(i.name); }}
                    className="w-full text-left px-3 py-2 text-sm text-white hover:bg-white/5 flex justify-between gap-2">
                    <span className="truncate">{i.name}</span>
                    <span className="text-gray-400 flex-shrink-0">Stock: {i.currentQty} {i.unit}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {extraPart && (
            <div className="flex items-center gap-2">
              <input type="number" min="0" step="any" className="w-20 bg-white/5 border border-white/10 text-white rounded-lg px-3 py-1.5 text-sm" value={extraQty} onChange={(e) => setExtraQty(e.target.value)} />
              <button type="button" onClick={addExtraPart} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-1.5 rounded-lg text-sm">Add Part</button>
              {parseQtyInput(extraQty) != null && shortOfStock(Number(extraPart.currentQty) || 0, parseQtyInput(extraQty)!, onJobQty(extraPart.id)) && (
                <span className="text-[11px] text-amber-400">Not enough in stock</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The repairs already on a job, read-only: no catalog read, no inputs. For jobs that can no longer be edited. */
export function JobRepairsList({ repairs }: { repairs: RepairPerformed[] }) {
  if (repairs.length === 0) return null;
  return (
    <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
      <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">Repairs</div>
      <ul className="divide-y divide-white/5">
        {repairs.map((r) => (
          <li key={r.repairItemId} className="py-2 flex justify-between gap-3 text-sm">
            <span className="text-white truncate">{r.name}</span>
            <span className="text-gray-300 flex-shrink-0">LKR {lkr.format(r.price)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
