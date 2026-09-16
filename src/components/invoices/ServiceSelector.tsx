import { useCallback, useMemo, useState } from "react";
import { Check, Minus, Plus, Search, Tag, Wrench, X } from "lucide-react";
import type { ServicePriceItem, StaffMember } from "../../types/auth";
import {
  buildCatalogIndex, catalogPrice, resolveFromIndex, serviceNamesFromIndex, vehicleTypeLabel,
} from "../../lib/servicePricing";
import { previewLineCommissions } from "../../lib/commission";
import { staffDisplayName } from "../../lib/jobTechnicians";

function formatLKR(n: number) {
  return `LKR ${n.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const money = (n: number) => Math.round(n * 100) / 100;

/** A service the user has picked, with the price and discount it will be billed at. */
export interface PickedService {
  name: string;
  qty: number;
  unitPrice: number;
  /** Money off this service alone, in rupees. 0 when it is sold at list price. */
  discount: number;
  /** Who performed it. "" when nobody was named — the line earns no commission. */
  technicianId: string;
  /** Their display name, denormalised onto the line. "" when unattributed. */
  technicianName: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Every priced service the centre offers (from fetchServicePrices). */
  catalog: ServicePriceItem[];
  /** The billed vehicle's type, so its own prices are the ones offered. */
  vehicleType?: string;
  /** Whether the per-service discount box is offered at all (centre setting). */
  allowDiscounts?: boolean;
  /**
   * The technicians a service can be attributed to. Empty (the default) hides
   * the picker entirely, which is what a centre with no technicians on the
   * books gets. Supervisors are excluded by the caller: their override is
   * derived from the technician's `reportsTo`, never picked by hand.
   */
  technicians?: StaffMember[];
  /**
   * Every staff member, for resolving a technician's supervisor when pricing
   * the payout. Passed only where the commission module is running AND this
   * user may see pay — without it a service is still attributed, it just
   * quotes no figure.
   */
  staffById?: Map<string, StaffMember>;
  /** Called once with every service picked, when the user confirms. */
  onAdd: (services: PickedService[]) => void;
}

/**
 * Pick the services a vehicle is being billed for, priced by its vehicle type.
 *
 * A workshop prices the same service differently per vehicle — an alignment on
 * a lorry is not an alignment on a hatchback — so the list opens on the billed
 * vehicle's own type and the price comes across automatically. Several services
 * are chosen in one pass rather than one modal opening per line, and each one
 * carries its own optional discount: most are sold at list price, but the box
 * is there on every row for the ones that aren't. Those discounts are summed
 * into the bill's single Discount figure (see lib/invoiceTotals.ts).
 */
export default function ServiceSelector(props: Props) {
  // Mounting the body only while open is what resets the search, the type tabs
  // and the selection between openings — no effect has to clear them.
  if (!props.open) return null;
  return <SelectorBody {...props} />;
}

function SelectorBody({
  catalog, vehicleType = "", allowDiscounts = true, technicians = [],
  staffById, onClose, onAdd,
}: Props) {
  const [search, setSearch] = useState("");
  // Starts on the billed vehicle's own type so the bill uses the right
  // per-type price; once the user picks a tab, that choice wins.
  const [type, setType] = useState(vehicleType);
  const [picked, setPicked] = useState<Record<string, PickedService>>({});

  // Grouped once per catalog, so each row below is a Map hit rather than a
  // scan of every price doc — see lib/servicePricing.ts.
  const index = useMemo(() => buildCatalogIndex(catalog), [catalog]);

  const typeOptions = useMemo(
    () =>
      Array.from(
        new Set<string>([
          ...catalog.map((c) => c.vehicleType ?? "").filter(Boolean),
          ...(vehicleType ? [vehicleType] : []),
        ]),
      ).sort(),
    [catalog, vehicleType],
  );

  // One row per service (not per price doc), resolved to the chosen type — a
  // service priced for cars alone has no business on a motorbike's bill.
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return serviceNamesFromIndex(index, type)
      .filter((name) => !needle || name.toLowerCase().includes(needle))
      .map((name) => {
        const item = resolveFromIndex(index, name, type);
        return {
          name,
          category: item?.category,
          price: item ? catalogPrice(item) : 0,
          resolvedType: item?.vehicleType ?? "",
          // Priced for a different type than asked for, so the price is a fallback.
          isFallback: !!type && (item?.vehicleType ?? "") !== type,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [index, type, search]);

  const toggle = useCallback((name: string, price: number) => {
    setPicked((prev) => {
      if (prev[name]) {
        // Tapping a chosen service again takes it back off the bill.
        const rest = { ...prev };
        delete rest[name];
        return rest;
      }
      return {
        ...prev,
        [name]: { name, qty: 1, unitPrice: price, discount: 0, technicianId: "", technicianName: "" },
      };
    });
  }, []);

  const assign = useCallback((name: string, technicianId: string, technicianName: string) => {
    setPicked((prev) => (
      prev[name] ? { ...prev, [name]: { ...prev[name], technicianId, technicianName } } : prev
    ));
  }, []);

  const patch = useCallback((name: string, field: "qty" | "unitPrice" | "discount", raw: string) => {
    setPicked((prev) => {
      const current = prev[name];
      if (!current) return prev;
      const n = Math.max(0, parseFloat(raw) || 0);
      const next = { ...current, [field]: n };
      // A discount can never be worth more than the service it comes off.
      next.discount = Math.min(next.discount, money(next.qty * next.unitPrice));
      return { ...prev, [name]: next };
    });
  }, []);

  const selected = useMemo(() => Object.values(picked), [picked]);
  const selectedGross = money(selected.reduce((s, p) => s + p.qty * p.unitPrice, 0));
  const selectedDiscount = money(selected.reduce((s, p) => s + p.discount, 0));

  // What attributing these services would pay out, computed with the same
  // rules the Cloud Function applies once the bill is saved — the technician's
  // own share plus any supervisor override. Shown so the counter can see the
  // cost of the work before the bill is raised, never stored from here.
  const commissionByService = useMemo(() => {
    const map = new Map<string, number>();
    if (!staffById || technicians.length === 0) return map;
    for (const p of selected) {
      if (!p.technicianId) continue;
      const base = Math.max(0, money(p.qty * p.unitPrice - p.discount));
      const rows = previewLineCommissions(
        { name: p.name, baseAmount: base, technicianId: p.technicianId },
        staffById,
        vehicleType || undefined,
        staffDisplayName,
      );
      map.set(p.name, money(rows.reduce((sum, r) => sum + r.amount, 0)));
    }
    return map;
  }, [selected, staffById, technicians.length, vehicleType]);

  const commissionTotal = money(
    Array.from(commissionByService.values()).reduce((sum, n) => sum + n, 0),
  );

  function confirm() {
    if (selected.length === 0) return;
    onAdd(selected.filter((p) => p.qty > 0));
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 print:hidden">
      <div className="bg-[#162032] border border-white/10 rounded-2xl w-full max-w-lg max-h-[88vh] flex flex-col shadow-2xl">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center flex-shrink-0">
              <Wrench className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <h3 className="font-bold text-white leading-tight">Add Services</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Priced for <span className="capitalize text-gray-300">{vehicleTypeLabel(type)}</span>
                {allowDiscounts ? " — give any service its own discount." : "."}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 -mr-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Vehicle type tabs + search */}
        <div className="p-4 border-b border-white/10 space-y-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Tag className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
            <button
              onClick={() => setType("")}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                type === ""
                  ? "bg-orange-500 border-orange-500 text-white"
                  : "bg-white/5 border-white/10 text-gray-300 hover:border-white/30"
              }`}
            >
              All types
            </button>
            {typeOptions.map((vt) => (
              <button
                key={vt}
                onClick={() => setType(vt)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize ${
                  type === vt
                    ? "bg-orange-500 border-orange-500 text-white"
                    : "bg-white/5 border-white/10 text-gray-300 hover:border-white/30"
                }`}
              >
                {vt}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search services…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              className="w-full pl-9 pr-3 py-2 bg-white/5 border border-white/10 text-white rounded-lg text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {rows.length === 0 ? (
            <div className="text-center text-gray-500 text-sm py-8">
              {catalog.length === 0
                ? "No services priced yet. Set them up under Services → Manage Services."
                : "No services for this vehicle type. Try All types, or add one under Services → Manage Services."}
            </div>
          ) : (
            rows.map((row) => {
              const pick = picked[row.name];
              const net = pick ? Math.max(0, money(pick.qty * pick.unitPrice - pick.discount)) : 0;
              return (
                <div
                  key={row.name}
                  className={`rounded-xl border transition-colors ${
                    pick ? "border-orange-500/50 bg-orange-500/5" : "border-transparent hover:bg-white/5"
                  }`}
                >
                  <button
                    onClick={() => toggle(row.name, row.price)}
                    className="w-full text-left px-3 py-2.5 flex items-center gap-3"
                  >
                    <span
                      className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 ${
                        pick ? "bg-orange-500 border-orange-500" : "border-white/20"
                      }`}
                    >
                      {pick && <Check className="w-3.5 h-3.5 text-white" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-white text-sm truncate">{row.name}</span>
                      <span className="block text-[11px] text-gray-500 mt-0.5">
                        {row.category && <span className="mr-1.5">{row.category}</span>}
                        <span className="capitalize">{vehicleTypeLabel(row.resolvedType)}</span>
                        {row.isFallback && <span className="text-amber-400/80"> · fallback price</span>}
                      </span>
                    </span>
                    <span className="text-orange-400 text-sm font-semibold whitespace-nowrap">
                      {formatLKR(row.price)}
                    </span>
                  </button>

                  {/* Qty, price and this service's own discount, once it is on the bill */}
                  {pick && (
                    <div className="px-3 pb-3 pt-0 space-y-2">
                      <div className={`grid gap-2 ${allowDiscounts ? "grid-cols-3" : "grid-cols-2"}`}>
                        <label className="block">
                          <span className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Qty</span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => patch(row.name, "qty", String(Math.max(1, pick.qty - 1)))}
                              className="w-7 h-7 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:border-white/30 flex items-center justify-center flex-shrink-0"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={pick.qty}
                              onChange={(e) => patch(row.name, "qty", e.target.value)}
                              onWheel={(e) => e.currentTarget.blur()}
                              className="w-full min-w-0 bg-white/5 border border-white/10 text-white rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:border-orange-500"
                            />
                            <button
                              onClick={() => patch(row.name, "qty", String(pick.qty + 1))}
                              className="w-7 h-7 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:border-white/30 flex items-center justify-center flex-shrink-0"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </label>
                        <label className="block">
                          <span className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Unit Price</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={pick.unitPrice}
                            onChange={(e) => patch(row.name, "unitPrice", e.target.value)}
                            onWheel={(e) => e.currentTarget.blur()}
                            className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:border-orange-500"
                          />
                        </label>
                        {allowDiscounts && (
                          <label className="block">
                            <span className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Discount</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={pick.discount}
                              placeholder="0.00"
                              onChange={(e) => patch(row.name, "discount", e.target.value)}
                              onWheel={(e) => e.currentTarget.blur()}
                              className={`w-full bg-white/5 border rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:border-orange-500 ${
                                pick.discount > 0 ? "border-orange-500/40 text-orange-300" : "border-white/10 text-white"
                              }`}
                            />
                          </label>
                        )}
                      </div>
                      {/* Who did the work. Only ever offered where the centre
                          runs the commission module. */}
                      {technicians.length > 0 && (
                        <label className="block">
                          <span className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                            Technician
                          </span>
                          <select
                            value={pick.technicianId}
                            onChange={(e) => {
                              const id = e.target.value;
                              const tech = technicians.find((t) => t.id === id);
                              assign(row.name, id, tech ? staffDisplayName(tech) : "");
                            }}
                            // A native select paints its options on the element's
                            // own background, so a translucent one comes out
                            // near-white and unreadable. Solid dark, on the
                            // select and every option, same as the job card's.
                            className="w-full bg-[#1e2d42] border border-white/15 text-white rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-orange-500"
                          >
                            <option value="" className="bg-[#1e2d42] text-white">
                              Unassigned
                            </option>
                            {technicians.map((t) => (
                              <option key={t.id} value={t.id} className="bg-[#1e2d42] text-white">
                                {staffDisplayName(t)}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <div className="flex justify-between text-[11px]">
                        <span className="text-gray-500">
                          {pick.discount > 0 ? `Discount − ${formatLKR(pick.discount)}` : "No discount"}
                          {(commissionByService.get(row.name) ?? 0) > 0 && (
                            <span className="text-sky-400">
                              {" · "}Commission {formatLKR(commissionByService.get(row.name) as number)}
                            </span>
                          )}
                        </span>
                        <span className="text-gray-300">{formatLKR(net)}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Running total of what is about to go on the bill */}
        <div className="p-4 border-t border-white/10 space-y-3">
          <div className="flex items-end justify-between text-sm">
            <div className="text-gray-400">
              {selected.length === 0
                ? "No services selected"
                : `${selected.length} service${selected.length > 1 ? "s" : ""} selected`}
            </div>
            <div className="text-right">
              <div className="text-white font-semibold">{formatLKR(selectedGross)}</div>
              {selectedDiscount > 0 && (
                <div className="text-[11px] text-orange-400">Discounts − {formatLKR(selectedDiscount)}</div>
              )}
              {commissionTotal > 0 && (
                <div className="text-[11px] text-sky-400">Commission {formatLKR(commissionTotal)}</div>
              )}
            </div>
          </div>
          <button
            onClick={confirm}
            disabled={selected.length === 0}
            className="w-full bg-[#F97316] hover:bg-orange-600 text-white py-2.5 rounded-xl font-semibold text-sm disabled:bg-white/10 disabled:text-gray-500 disabled:cursor-not-allowed"
          >
            Add to Bill
          </button>
        </div>
      </div>
    </div>
  );
}
