import { useMemo, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { modelLabel } from "../../lib/repairCatalog/keys.ts";
import { searchModels } from "../../lib/repairCatalog/models.ts";
import type { VehicleModel } from "../../types/repairCatalog";

interface Props {
  /** Active models only. */
  models: VehicleModel[];
  selected: VehicleModel | null;
  onSelect: (model: VehicleModel | null) => void;
  /** Offer "Add new model". False for roles the rules don't let create one. */
  canAdd: boolean;
  /** Called with the typed text when the user chooses "Add new model". */
  onAddNew: (typed: string) => void;
  loading?: boolean;
  className?: string;
}

const MAX_SHOWN = 30;

/** Searchable model picker: shows "make model", offers inline add when nothing matches. */
export default function ModelPicker({ models, selected, onSelect, canAdd, onAddNew, loading, className }: Props) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => searchModels(models, text).slice(0, MAX_SHOWN), [models, text]);
  const typed = text.trim();
  const exact = useMemo(
    () => models.some((m) => modelLabel(m).toLowerCase() === typed.replace(/\s+/g, " ").toLowerCase()),
    [models, typed],
  );

  if (selected) {
    return (
      <div className={`flex items-center justify-between gap-2 rounded-xl border border-[#F97316]/40 bg-[#F97316]/10 px-3 py-2.5 ${className ?? ""}`}>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate">{modelLabel(selected)}</p>
          <p className="text-xs text-gray-400">{selected.vehicleType}</p>
        </div>
        <button type="button" onClick={() => onSelect(null)} className="p-1.5 text-gray-400 hover:text-white rounded-lg" aria-label="Clear model">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}
      onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={loading ? "Loading models…" : "Search models, e.g. Honda Dio"}
        className="w-full bg-[#0B1120] border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#F97316]"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-[#162032] border border-white/10 rounded-xl shadow-xl">
          {matches.map((m) => (
            <button
              type="button" key={m.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onSelect(m); setText(""); setOpen(false); }}
              className="w-full text-left px-3 py-2.5 hover:bg-white/5 flex items-center justify-between gap-2"
            >
              <span className="text-sm text-white truncate">{modelLabel(m)}</span>
              <span className="text-xs text-gray-500 flex-shrink-0">{m.vehicleType}</span>
            </button>
          ))}
          {matches.length === 0 && !loading && (
            <p className="px-3 py-2.5 text-sm text-gray-500">{typed ? "No matching model." : "No models yet."}</p>
          )}
          {typed && !exact && canAdd && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setOpen(false); onAddNew(typed); }}
              className="w-full text-left px-3 py-2.5 border-t border-white/10 text-sm text-[#F97316] hover:bg-white/5 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Add “{typed}” as a new model
            </button>
          )}
          {typed && !exact && !canAdd && (
            <p className="px-3 py-2.5 border-t border-white/10 text-xs text-gray-500">
              Not in the list. Ask a manager to add it, or enter the make and model as text.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
