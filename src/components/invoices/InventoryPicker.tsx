import { useEffect, useState } from "react";
import { Package, Search, X, Plus } from "lucide-react";
import { searchInventoryItems } from "../../lib/inventorySearch";
import { formatLKR, serviceCenterPriceOf } from "../../lib/inventoryPricing";
import type { InventoryItem } from "../../types/auth";

interface Props {
  centerId: string;
  open: boolean;
  onClose: () => void;
  onPick: (item: InventoryItem, qty: number) => void;
  /** One line under the title saying when the stock will move. */
  note?: string;
}

/**
 * Pick a part off the shelf and put it on a bill. Shared by the new-invoice
 * form and the invoice card, so both search the same way the job card does —
 * by item name or by the code printed on the box.
 *
 * The picker only chooses; the caller decides what the line looks like and
 * when the stock actually moves.
 */
export default function InventoryPicker(props: Props) {
  // Mounting the body only while open is what resets the search between
  // openings — no effect has to clear it.
  if (!props.open) return null;
  return <PickerBody {...props} />;
}

function PickerBody({ centerId, onClose, onPick, note }: Props) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<InventoryItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});

  useEffect(() => {
    const term = search.trim();
    // An empty box is cleared by the change handler, so there is nothing to
    // look up and nothing to reset here.
    if (!term) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      searchInventoryItems(centerId, term)
        .then((items) => { if (!cancelled) setResults(items); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search, centerId]);

  function add(item: InventoryItem) {
    const n = parseFloat(qty[item.id] ?? "1");
    if (isNaN(n) || n <= 0) return;
    onPick(item, n);
    setQty((prev) => ({ ...prev, [item.id]: "1" }));
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 print:hidden">
      <div className="bg-[#162032] border border-white/10 rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center flex-shrink-0">
              <Package className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <h3 className="font-bold text-white leading-tight">Add from Inventory</h3>
              <p className="text-xs text-gray-400 mt-0.5">{note ?? "Search by item name or code."}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 -mr-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 border-b border-white/10">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search parts…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (!e.target.value.trim()) setResults([]);
              }}
              autoFocus
              className="w-full pl-9 pr-3 py-2 bg-white/5 border border-white/10 text-white rounded-lg text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {!search.trim() ? (
            <div className="text-center text-gray-500 text-sm py-8">Start typing to find a part.</div>
          ) : searching && results.length === 0 ? (
            <div className="text-center text-gray-500 text-sm py-8">Searching…</div>
          ) : results.length === 0 ? (
            <div className="text-center text-gray-500 text-sm py-8">No matches found.</div>
          ) : (
            results.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg hover:bg-white/5">
                <div className="min-w-0">
                  <div className="text-white text-sm truncate">{item.name}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-2">
                    {item.partNumber && <span className="font-mono">{item.partNumber}</span>}
                    <span className={item.currentQty > 0 ? "" : "text-red-400"}>
                      {item.currentQty} {item.unit} in stock
                    </span>
                    <span className="text-orange-400">{formatLKR(serviceCenterPriceOf(item))}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={qty[item.id] ?? "1"}
                    onChange={(e) => setQty((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    className="w-16 bg-white/5 border border-white/10 text-white rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:border-orange-500"
                  />
                  <button
                    onClick={() => add(item)}
                    className="flex items-center gap-1 bg-[#F97316] hover:bg-orange-600 text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
