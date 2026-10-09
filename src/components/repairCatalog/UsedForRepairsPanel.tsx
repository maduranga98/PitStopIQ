import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Plus, Trash2 } from "lucide-react";
import Sheet, { fieldClass, ghostBtn, primaryBtn } from "./Sheet";
import { addPartLink, linkedRepairsFor, parseQty, removePartLink } from "../../lib/repairCatalog/partLinks.ts";
import { checkRepairForLink, saveSuggestedParts } from "../../lib/repairCatalog/inventoryWrites";
import type { Actor } from "../../lib/repairCatalog/repairWrites";
import type { RepairItem, RepairSuggestedPart } from "../../types/repairCatalog";

interface Props {
  centerId: string;
  itemId: string;
  itemName: string;
  repairs: RepairItem[];
  setRepairs: Dispatch<SetStateAction<RepairItem[]>>;
  loaded: boolean;
  error: boolean;
  onRetry: () => void;
  /** Has repairCatalog write permission. Without it the list is read-only. */
  canEdit: boolean;
  actor: Actor;
}

type Change = { kind: "add"; qty: number } | { kind: "remove" };
interface Pending { repair: RepairItem; change: Change; fields: string[]; by?: string; fresh: RepairItem }

const apply = (parts: RepairSuggestedPart[], itemId: string, c: Change) =>
  c.kind === "add" ? addPartLink(parts, itemId, c.qty) : removePartLink(parts, itemId);

/**
 * The repairs an item is linked to, computed from the cached catalog. The link
 * is stored only on the repair (`suggestedParts`), so adding or removing writes
 * to the repair document, guarded by the Phase 4 `updatedAt` check.
 */
export default function UsedForRepairsPanel({ centerId, itemId, itemName, repairs, setRepairs, loaded, error, onRetry, canEdit, actor }: Props) {
  const linked = useMemo(() => linkedRepairsFor(itemId, repairs), [itemId, repairs]);
  const linkedIds = useMemo(() => new Set(linked.map((l) => l.repair.id)), [linked]);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<RepairItem | null>(null);
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);

  const options = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return repairs
      .filter((r) => r.isActive !== false && !linkedIds.has(r.id))
      .filter((r) => words.every((w) => `${r.name} ${r.category ?? ""}`.toLowerCase().includes(w)))
      .slice(0, 12);
  }, [q, repairs, linkedIds]);

  const upsert = (r: RepairItem) =>
    setRepairs((prev) => [...prev.filter((x) => x.id !== r.id), r].sort((a, b) => a.name.localeCompare(b.name)));

  async function write(base: RepairItem, change: Change) {
    const next = apply(base.suggestedParts, itemId, change);
    // Already in the wanted state (someone got there first): nothing to write.
    upsert(next === base.suggestedParts ? base : await saveSuggestedParts(centerId, base, next, actor));
  }

  async function run(repair: RepairItem, change: Change) {
    if (!canEdit) return; // belt and braces: the buttons are not rendered either
    setBusy(true); setMsg("");
    try {
      const check = await checkRepairForLink(centerId, repair);
      if (check.conflict === "gone") { setMsg(`“${repair.name}” no longer exists.`); return; }
      if (check.conflict) {
        setPending({ repair, change, fields: check.fields, fresh: check.fresh, by: check.fresh.updatedByName });
        return;
      }
      await write(check.fresh, change);
      setPick(null); setQ(""); setQty("1");
    } catch {
      setMsg("Couldn't save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmOverwrite() {
    if (!pending || !canEdit) return;
    setBusy(true); setMsg("");
    try {
      // On top of THEIR version: only this part's entry changes.
      await write(pending.fresh, pending.change);
      setPick(null); setQ(""); setQty("1");
      setPending(null);
    } catch {
      setMsg("Couldn't save. Check your connection and try again.");
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  function cancelOverwrite() {
    if (pending) upsert(pending.fresh); // show what is stored now
    setPending(null);
  }

  const qtyNum = parseQty(qty);

  return (
    <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Used for repairs</h2>
        <p className="text-xs text-gray-600 mt-1">
          The repairs that suggest this part. The link is kept on the repair, so changing it here edits that repair.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-gray-400">Couldn't load repairs. <button type="button" className="text-[#F97316] hover:underline" onClick={onRetry}>Try again</button></p>
      ) : !loaded ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : linked.length === 0 ? (
        <p className="text-sm text-gray-500">Not linked to any repair yet.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {linked.map(({ repair, defaultQty }) => (
            <li key={repair.id} className="py-2.5 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white truncate">
                  {repair.name}
                  {repair.isActive === false && <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-500">inactive</span>}
                </p>
                <p className="text-[11px] text-gray-500">{[repair.category, `${defaultQty} per repair`].filter(Boolean).join(" · ")}</p>
              </div>
              {canEdit && (
                <button type="button" disabled={busy} onClick={() => run(repair, { kind: "remove" })}
                  className="p-2 text-gray-400 hover:text-red-400 disabled:opacity-50" aria-label={`Remove link to ${repair.name}`}>
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && loaded && !error && (
        <div className="space-y-2 pt-1">
          {pick ? (
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 text-sm text-white truncate">{pick.name}</p>
              <input type="number" min="0" step="any" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)}
                className="w-20 bg-[#0B1120] border border-white/10 rounded-lg px-2 py-2 text-sm text-white text-right" aria-label={`Quantity of ${itemName} per repair`} />
              <button type="button" className={primaryBtn} disabled={busy || qtyNum == null} onClick={() => qtyNum != null && run(pick, { kind: "add", qty: qtyNum })}>
                {busy ? "Adding…" : "Add"}
              </button>
              <button type="button" className={ghostBtn} onClick={() => setPick(null)}>Cancel</button>
            </div>
          ) : (
            <div className="relative">
              <Plus className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input className={`${fieldClass} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Link to a repair — search by name" aria-label="Search repairs to link" />
              {q.trim() && (
                <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-[#162032] border border-white/10 rounded-xl shadow-xl">
                  {options.map((r) => (
                    <button type="button" key={r.id} onClick={() => { setPick(r); setQty("1"); }}
                      className="w-full text-left px-3 py-2 hover:bg-white/5">
                      <span className="block text-sm text-white truncate">{r.name}</span>
                      {r.category && <span className="block text-[11px] text-gray-500">{r.category}</span>}
                    </button>
                  ))}
                  {options.length === 0 && <p className="px-3 py-2.5 text-sm text-gray-500">No matching repair.</p>}
                </div>
              )}
            </div>
          )}
          {pick && qtyNum == null && <p className="text-xs text-red-400">Enter a quantity above 0.</p>}
        </div>
      )}
      {!canEdit && loaded && !error && (
        <p className="text-[11px] text-gray-600">Linking parts to repairs needs the “edit repairs” permission.</p>
      )}
      {msg && <p className="text-xs text-red-400">{msg}</p>}

      {pending && (
        <Sheet
          title="This repair was changed"
          onClose={cancelOverwrite}
          footer={
            <>
              <button type="button" className={ghostBtn} onClick={cancelOverwrite}>Cancel</button>
              <button type="button" className={primaryBtn} disabled={busy} onClick={confirmOverwrite}>
                {busy ? "Saving…" : pending.change.kind === "add" ? "Add on top of their changes" : "Remove on top of their changes"}
              </button>
            </>
          }
        >
          <p className="text-sm text-gray-300">
            “{pending.repair.name}” was saved{pending.by ? ` by ${pending.by}` : " by someone else"} after you loaded it
            {pending.fields.length > 0 && <> (changed: {pending.fields.join(", ")})</>}.
          </p>
          <p className="text-sm text-gray-400">
            {pending.change.kind === "add" ? `Adding ${itemName}` : `Removing ${itemName}`} will be applied to their version.
            Nothing else on the repair is touched.
          </p>
        </Sheet>
      )}
    </div>
  );
}
