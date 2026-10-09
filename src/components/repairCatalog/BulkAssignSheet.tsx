import { useState } from "react";
import Sheet, { ghostBtn, primaryBtn } from "./Sheet";
import { bulkAssignModels } from "../../lib/repairCatalog/writes";
import type { VehicleGroup } from "../../types/repairCatalog";

interface Props {
  centerId: string;
  groups: VehicleGroup[];
  modelIds: string[];
  onClose: () => void;
  onDone: (mode: "add" | "remove", groupIds: string[]) => void;
}

/** Add the selected models to (or remove them from) one or more groups in one go. */
export default function BulkAssignSheet({ centerId, groups, modelIds, onClose, onDone }: Props) {
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const usable = groups.filter((g) => g.isActive !== false);

  const toggle = (id: string) =>
    setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function apply() {
    setBusy(true);
    setError("");
    try {
      await bulkAssignModels(centerId, [...picked], modelIds, mode);
      onDone(mode, [...picked]);
    } catch {
      setError("Couldn't save. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={`${modelIds.length} model${modelIds.length === 1 ? "" : "s"} selected`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={ghostBtn} onClick={onClose}>Cancel</button>
          <button type="button" className={primaryBtn} disabled={busy || picked.size === 0} onClick={apply}>
            {busy ? "Saving…" : mode === "add" ? "Add to groups" : "Remove from groups"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-1 bg-[#0B1120] border border-white/10 rounded-xl p-1">
        {(["add", "remove"] as const).map((m) => (
          <button type="button" key={m} onClick={() => setMode(m)}
            className={`py-2 rounded-lg text-sm font-medium ${mode === m ? "bg-[#162032] text-white shadow" : "text-gray-400"}`}>
            {m === "add" ? "Add to" : "Remove from"}
          </button>
        ))}
      </div>
      {usable.length === 0 ? (
        <p className="text-sm text-gray-500">No groups yet. Create one on the Groups tab first.</p>
      ) : (
        <div className="rounded-xl border border-white/10 divide-y divide-white/5 max-h-72 overflow-y-auto">
          {usable.map((g) => (
            <label key={g.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-white/5">
              <input type="checkbox" checked={picked.has(g.id)} onChange={() => toggle(g.id)} className="accent-[#F97316] w-4 h-4" />
              <span className="text-sm text-white flex-1 truncate">{g.name}</span>
              <span className="text-xs text-gray-500">priority {g.priority}</span>
            </label>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </Sheet>
  );
}
