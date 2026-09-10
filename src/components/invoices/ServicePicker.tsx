import { useState } from "react";
import { BookOpen, Search, Tag, X } from "lucide-react";
import type { ServicePriceItem } from "../../types/auth";
import {
  catalogPrice, resolveServiceItem, serviceNamesForVehicleType, vehicleTypeLabel,
} from "../../lib/servicePricing";

function formatLKR(n: number) {
  return `LKR ${n.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Every priced service the centre offers (from fetchServicePrices). */
  catalog: ServicePriceItem[];
  /** The vehicle being billed, so its own prices are shown first. "" = all types. */
  defaultVehicleType?: string;
  onPick: (name: string, price: number) => void;
}

/**
 * Pick a priced service off the library and put it on a bill — the services
 * counterpart of InventoryPicker, so a line can be chosen instead of typed.
 * Shared by the new-invoice form and the invoice card so both bill the same
 * price for the same service.
 */
export default function ServicePicker(props: Props) {
  // Mounting the body only while open resets search and type tabs between
  // openings, so the picker always opens on this vehicle's own prices.
  if (!props.open) return null;
  return <PickerBody {...props} />;
}

function PickerBody({ catalog, defaultVehicleType = "", onClose, onPick }: Props) {
  const [search, setSearch] = useState("");
  // The vehicle type whose prices are listed. Starts on the billed vehicle's
  // own type so a bill uses the right per-type price instead of every type at
  // once; once the user picks a tab, that choice wins ("All types" included).
  const [vehicleType, setVehicleType] = useState(defaultVehicleType);

  // Types the list can be filtered by: every type with at least one price,
  // plus the billed vehicle's own. "" (All types) is the general fallback.
  const typeOptions = Array.from(
    new Set<string>([
      ...catalog.map((c) => c.vehicleType ?? "").filter(Boolean),
      ...(defaultVehicleType ? [defaultVehicleType] : []),
    ]),
  ).sort();

  // One row per service (not per price doc), resolved to the chosen type — a
  // service priced for cars alone has no business on a motorbike's bill.
  const rows = serviceNamesForVehicleType(catalog, vehicleType)
    .filter((name) => !search || name.toLowerCase().includes(search.toLowerCase()))
    .map((name) => {
      const item = resolveServiceItem(catalog, name, vehicleType);
      return {
        name,
        category: item?.category,
        price: item ? catalogPrice(item) : 0,
        resolvedType: item?.vehicleType ?? "",
        // The resolved price is for a different type than requested (fell back).
        isFallback: !!vehicleType && (item?.vehicleType ?? "") !== vehicleType,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 print:hidden">
      <div className="bg-[#162032] border border-white/10 rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <h3 className="font-bold text-white leading-tight">Service Library</h3>
              <p className="text-xs text-gray-400 mt-0.5">Prices shown for the selected vehicle type.</p>
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
              onClick={() => setVehicleType("")}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                vehicleType === ""
                  ? "bg-orange-500 border-orange-500 text-white"
                  : "bg-white/5 border-white/10 text-gray-300 hover:border-white/30"
              }`}
            >
              All types
            </button>
            {typeOptions.map((vt) => (
              <button
                key={vt}
                onClick={() => setVehicleType(vt)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize ${
                  vehicleType === vt
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

        <div className="flex-1 overflow-y-auto p-2">
          {rows.length === 0 ? (
            <div className="text-center text-gray-500 text-sm py-8">
              {catalog.length === 0
                ? "No services priced yet. Set them up under Services → Manage Services."
                : "No services for this vehicle type. Try All types, or add one under Services → Manage Services."}
            </div>
          ) : (
            rows.map((row) => (
              <button
                key={row.name}
                onClick={() => onPick(row.name, row.price)}
                className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-white/10 transition-colors flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-white text-sm truncate">{row.name}</div>
                  <div className="text-[11px] text-gray-500 flex items-center gap-1.5 mt-0.5">
                    {row.category && <span>{row.category}</span>}
                    <span className="inline-flex items-center gap-0.5 capitalize">
                      <Tag className="w-2.5 h-2.5" />
                      {vehicleTypeLabel(row.resolvedType)}
                      {row.isFallback && <span className="text-amber-400/80"> · fallback</span>}
                    </span>
                  </div>
                </div>
                <div className="text-orange-400 text-sm font-semibold whitespace-nowrap">
                  {formatLKR(row.price)}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
