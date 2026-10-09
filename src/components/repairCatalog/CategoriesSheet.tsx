import { useState } from "react";
import { ArrowDown, ArrowUp, Check, Pencil, Plus } from "lucide-react";
import Sheet, { fieldClass, ghostBtn, primaryBtn } from "./Sheet";
import { addCategory, moveInList, renameCategory, repairsInCategory } from "../../lib/repairCatalog/catalog.ts";
import { renameCategoryEverywhere, saveCategories, type Actor } from "../../lib/repairCatalog/repairWrites";
import type { RepairItem } from "../../types/repairCatalog";

interface Props {
  centerId: string;
  actor: Actor;
  /** The categories as currently shown (the owner's list, or the defaults). */
  list: string[];
  repairs: RepairItem[];
  /** After a change is saved: the new list, and the repairs whose category was renamed. */
  onChanged: (list: string[], renamed?: { from: string; to: string }) => void;
  onClose: () => void;
}

/** Add, rename and reorder the owner's categories in place. Each change is saved as it is made. */
export default function CategoriesSheet({ centerId, actor, list, repairs, onChanged, onClose }: Props) {
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await work(); } catch { setError("Couldn't save. Check your connection and try again."); }
    setBusy(false);
  }

  const add = () => {
    const res = addCategory(list, adding);
    if ("error" in res) { setError(res.error); return; }
    void run(async () => { await saveCategories(centerId, res.list); onChanged(res.list); setAdding(""); });
  };

  const move = (from: number, to: number) => {
    const next = moveInList(list, from, to);
    if (next === list) return;
    void run(async () => { await saveCategories(centerId, next); onChanged(next); });
  };

  const rename = () => {
    if (!editing) return;
    const from = list[editing.index];
    if (editing.text.trim() === from) { setEditing(null); return; }
    const res = renameCategory(list, from, editing.text);
    if ("error" in res) { setError(res.error); return; }
    const to = res.list[editing.index];
    const ids = repairsInCategory(repairs, from).map((r) => r.id);
    void run(async () => {
      await renameCategoryEverywhere(centerId, res.list, ids, to, actor);
      onChanged(res.list, { from, to });
      setEditing(null);
    });
  };

  return (
    <Sheet title="Categories" onClose={onClose} footer={<button type="button" className={ghostBtn} onClick={onClose}>Done</button>}>
      <p className="text-xs text-gray-500">Renaming a category moves its repairs with it. The order here is the order shown in lists and filters.</p>
      <ul className="space-y-2">
        {list.map((c, i) => {
          const n = repairsInCategory(repairs, c).length;
          const isEditing = editing?.index === i;
          return (
            <li key={`${c}-${i}`} className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#0B1120] px-3 py-2">
              {isEditing ? (
                <>
                  <input className={`${fieldClass} !py-1.5`} autoFocus value={editing.text}
                    onChange={(e) => setEditing({ index: i, text: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") rename(); if (e.key === "Escape") setEditing(null); }} />
                  <button type="button" className="p-2 text-[#F97316]" aria-label="Save name" disabled={busy} onClick={rename}><Check className="w-4 h-4" /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 min-w-0 text-sm text-white truncate">{c}</span>
                  <span className="text-xs text-gray-500">{n}</span>
                  <button type="button" disabled={busy || i === 0} className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30" aria-label="Move up" onClick={() => move(i, i - 1)}><ArrowUp className="w-4 h-4" /></button>
                  <button type="button" disabled={busy || i === list.length - 1} className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30" aria-label="Move down" onClick={() => move(i, i + 1)}><ArrowDown className="w-4 h-4" /></button>
                  <button type="button" disabled={busy} className="p-1.5 text-gray-400 hover:text-white" aria-label={`Rename ${c}`} onClick={() => setEditing({ index: i, text: c })}><Pencil className="w-4 h-4" /></button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <input className={fieldClass} value={adding} onChange={(e) => { setAdding(e.target.value); setError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="New category" />
        <button type="button" className={`${primaryBtn} flex items-center gap-1`} disabled={busy || !adding.trim()} onClick={add}>
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </Sheet>
  );
}
