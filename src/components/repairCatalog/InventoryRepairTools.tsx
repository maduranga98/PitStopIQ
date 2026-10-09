import { useMemo, useState } from "react";
import { Link2, ListChecks, Search, Tags, X } from "lucide-react";
import Sheet, { fieldClass, ghostBtn, primaryBtn } from "./Sheet";
import CompatibilityPicker, { ALL_VEHICLES, compatFromForm, type CompatForm } from "./CompatibilityPicker";
import type { InventoryRepairTools as Tools } from "../../hooks/useInventoryRepairTools";
import {
  hasNoSellingPrice, isUnclassified, type CompatTarget,
} from "../../lib/repairCatalog/compatibility.ts";
import { planLinkToRepair, planSetCompatibility, WRITE_CHUNK, chunk, type BulkProgress } from "../../lib/repairCatalog/bulk.ts";
import { parseQty } from "../../lib/repairCatalog/partLinks.ts";
import { modelLabel } from "../../lib/repairCatalog/keys.ts";
import { checkRepairForLink, saveSuggestedParts, setCompatibilityBulk } from "../../lib/repairCatalog/inventoryWrites";
import type { Actor } from "../../lib/repairCatalog/repairWrites";
import type { InventoryItem } from "../../types/auth";
import type { RepairItem } from "../../types/repairCatalog";

interface Props {
  tools: Tools;
  centerId: string;
  /** Every item the page holds (for the filter counts). */
  items: InventoryItem[];
  /** The items passing ALL the page's filters, every page of them. */
  displayed: InventoryItem[];
  /** May change inventory items (permission AND an Owner/Manager role, which is what the rules require). */
  canEditItems: boolean;
  /** May edit repairs (repairCatalog.edit AND an Owner/Manager role). */
  canEditRepairs: boolean;
  actor: Actor;
}

const chip = (on: boolean) =>
  `px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
    on ? "bg-[#F97316]/20 text-[#F97316] border-[#F97316]/40" : "bg-[#0B1120] text-gray-400 border-white/10 hover:border-white/20"
  }`;

const PREVIEW_ROWS = 8;

export default function InventoryRepairTools({ tools, centerId, items, displayed, canEditItems, canEditRepairs, actor }: Props) {
  const { filter, setFilter, selected } = tools;
  const [sheet, setSheet] = useState<"compat" | "link" | null>(null);

  const counts = useMemo(() => ({
    unclassified: items.filter(isUnclassified).length,
    noPrice: items.filter(hasNoSellingPrice).length,
  }), [items]);

  const selectedItems = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected]);
  const canBulk = canEditItems || canEditRepairs;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-gray-500 mr-1">Repairs</span>
        <button type="button" className={chip(filter.unclassified)} aria-pressed={filter.unclassified}
          onClick={() => setFilter({ ...filter, unclassified: !filter.unclassified })}>
          Unclassified · {counts.unclassified}
        </button>
        <button type="button" className={chip(filter.noSellingPrice)} aria-pressed={filter.noSellingPrice}
          onClick={() => setFilter({ ...filter, noSellingPrice: !filter.noSellingPrice })}>
          No selling price · {counts.noPrice}
        </button>
        <CompatibleWithFilter tools={tools} />
      </div>

      {canBulk && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[#0B1120] border border-white/10 px-3 py-2">
          <ListChecks className="w-4 h-4 text-gray-500" />
          <span className="text-xs text-gray-400">
            {selectedItems.length > 0 ? `${selectedItems.length} selected` : "Tick items to change several at once"}
          </span>
          <button type="button" className="text-xs text-[#F97316] hover:underline disabled:opacity-40" disabled={displayed.length === 0}
            onClick={() => tools.selectMany(displayed.map((i) => i.id))}>
            Select all {displayed.length} shown by the filters
          </button>
          {selectedItems.length > 0 && (
            <>
              <button type="button" className="text-xs text-gray-400 hover:text-white" onClick={tools.clearSelection}>Clear</button>
              <span className="flex-1" />
              {canEditItems && (
                <button type="button" className={`${ghostBtn} !py-1.5 !px-3 text-xs flex items-center gap-1.5`} onClick={() => setSheet("compat")}>
                  <Tags className="w-3.5 h-3.5" /> Set compatibility
                </button>
              )}
              {canEditRepairs && (
                <button type="button" className={`${ghostBtn} !py-1.5 !px-3 text-xs flex items-center gap-1.5`} onClick={() => setSheet("link")}>
                  <Link2 className="w-3.5 h-3.5" /> Link to a repair
                </button>
              )}
            </>
          )}
        </div>
      )}

      {sheet === "compat" && canEditItems && (
        <BulkCompatibilitySheet tools={tools} centerId={centerId} items={selectedItems} onClose={() => setSheet(null)} />
      )}
      {sheet === "link" && canEditRepairs && (
        <BulkLinkSheet tools={tools} centerId={centerId} items={selectedItems} actor={actor} onClose={() => setSheet(null)} />
      )}
    </>
  );
}

// ── "Compatible with" filter ─────────────────────────────────────────────────

function CompatibleWithFilter({ tools }: { tools: Tools }) {
  const { filter, setFilter, mg, typeOptions } = tools;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const target = filter.compatibleWith;

  const label = (t: CompatTarget) =>
    t.kind === "type" ? t.id
      : t.kind === "group" ? (mg.groups.find((g) => g.id === t.id)?.name ?? "Group")
        : (() => { const m = mg.models.find((x) => x.id === t.id); return m ? modelLabel(m) : "Model"; })();

  const hits = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const all: { t: CompatTarget; text: string; hint: string }[] = [
      ...typeOptions.map((id) => ({ t: { kind: "type", id } as CompatTarget, text: id, hint: "Type" })),
      ...mg.groups.filter((g) => g.isActive !== false).map((g) => ({ t: { kind: "group", id: g.id } as CompatTarget, text: g.name, hint: "Group" })),
      ...mg.models.filter((m) => m.isActive !== false).map((m) => ({ t: { kind: "model", id: m.id } as CompatTarget, text: modelLabel(m), hint: `Model · ${m.vehicleType}` })),
    ];
    return all.filter((h) => words.every((w) => `${h.text} ${h.hint}`.toLowerCase().includes(w))).slice(0, 20);
  }, [q, typeOptions, mg.groups, mg.models]);

  if (target) {
    return (
      <span className={`${chip(true)} inline-flex items-center gap-1.5`}>
        Compatible with: {label(target)}
        <button type="button" aria-label="Clear compatible-with filter" onClick={() => setFilter({ ...filter, compatibleWith: null })}><X className="w-3 h-3" /></button>
      </span>
    );
  }
  return (
    <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        className="w-52 bg-[#0B1120] border border-white/10 rounded-lg pl-8 pr-2 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#F97316]"
        placeholder={mg.loaded ? "Compatible with… (type, group, model)" : "Loading vehicles…"}
        aria-label="Filter by compatible vehicle" value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
      />
      {open && q.trim() && (
        <div className="absolute z-30 mt-1 w-72 max-h-60 overflow-y-auto bg-[#162032] border border-white/10 rounded-xl shadow-xl">
          {hits.map((h) => (
            <button type="button" key={`${h.t.kind}:${h.t.id}`} onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setFilter({ ...filter, compatibleWith: h.t }); setQ(""); setOpen(false); }}
              className="w-full text-left px-3 py-2 hover:bg-white/5 flex items-center justify-between gap-2">
              <span className="text-sm text-white truncate">{h.text}</span>
              <span className="text-[11px] text-gray-500 flex-shrink-0">{h.hint}</span>
            </button>
          ))}
          {hits.length === 0 && <p className="px-3 py-2.5 text-sm text-gray-500">Nothing matches.</p>}
        </div>
      )}
    </div>
  );
}

// ── Preview helpers ──────────────────────────────────────────────────────────

function NameList({ items, label }: { items: { name: string }[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <ul className="text-sm text-gray-300 space-y-0.5">
        {items.slice(0, PREVIEW_ROWS).map((i, k) => <li key={k} className="truncate">• {i.name}</li>)}
        {items.length > PREVIEW_ROWS && <li className="text-xs text-gray-500">…and {items.length - PREVIEW_ROWS} more</li>}
      </ul>
    </div>
  );
}

function ProgressBar({ p }: { p: BulkProgress }) {
  const pct = p.total === 0 ? 100 : Math.round((p.done / p.total) * 100);
  return (
    <div className="space-y-1" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-[#F97316] transition-all" style={{ width: `${pct}%` }} /></div>
      <p className="text-xs text-gray-400">{p.done} of {p.total} updated</p>
    </div>
  );
}

// ── Bulk: set compatibility ──────────────────────────────────────────────────

function BulkCompatibilitySheet({ tools, centerId, items, onClose }: { tools: Tools; centerId: string; items: InventoryItem[]; onClose: () => void }) {
  const { mg, typeOptions } = tools;
  const [form, setForm] = useState<CompatForm>(ALL_VEHICLES);
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const [failedAt, setFailedAt] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [running, setRunning] = useState(false);

  const target = compatFromForm(form);
  const plan = useMemo(() => (target ? planSetCompatibility(items, target) : null), [items, target]);
  // Chunks are fixed once a run starts, so a retry resumes the same split.
  const [fixed, setFixed] = useState<string[] | null>(null);

  async function start(resumeAt?: number) {
    if (!target || !plan) return;
    setRunning(true);
    const ids = fixed ?? plan.toChange.map((i) => i.id);
    setFixed(ids);
    const res = await setCompatibilityBulk(centerId, ids, target, { startAt: resumeAt, onProgress: setProgress });
    setFailedAt(res.failedAt);
    setDone(res.failedAt === null);
    setRunning(false);
    if (res.failedAt === null) tools.clearSelection();
  }

  const locked = running || done || fixed !== null;

  return (
    <Sheet
      title="Set compatibility"
      onClose={running ? () => {} : onClose}
      footer={done ? (
        <button type="button" className={primaryBtn} onClick={onClose}>Done</button>
      ) : (
        <>
          <button type="button" className={ghostBtn} disabled={running} onClick={onClose}>Cancel</button>
          <button type="button" className={primaryBtn} disabled={running || !plan || (failedAt === null && plan.toChange.length === 0)}
            onClick={() => start(failedAt ?? undefined)}>
            {running ? "Saving…" : failedAt !== null ? "Retry" : plan ? `Apply to ${plan.toChange.length} item${plan.toChange.length === 1 ? "" : "s"}` : "Apply"}
          </button>
        </>
      )}
    >
      <p className="text-sm text-gray-300">What should the {items.length} selected item{items.length === 1 ? "" : "s"} fit?</p>
      <fieldset disabled={locked} className="disabled:opacity-60">
        <CompatibilityPicker idPrefix="bulk" value={form} onChange={setForm} models={mg.models} groups={mg.groups} typeOptions={typeOptions} loading={!mg.loaded} />
      </fieldset>

      {!plan ? (
        <p className="text-xs text-gray-500">Pick at least one type, group or model to see what will change.</p>
      ) : (
        <div className="rounded-xl border border-white/10 bg-[#0B1120] p-3 space-y-3">
          <p className="text-sm text-white">
            {plan.toChange.length} item{plan.toChange.length === 1 ? "" : "s"} will change
            {plan.fromUnclassified > 0 && <span className="text-gray-400"> ({plan.fromUnclassified} currently unclassified)</span>}.
            {plan.unchanged.length > 0 && <span className="text-gray-400"> {plan.unchanged.length} already match and are skipped.</span>}
          </p>
          <p className="text-[11px] text-gray-500">
            Replaces each item's current compatibility with the choice above. Nothing else on the items changes
            {plan.toChange.length > WRITE_CHUNK ? `; saved in ${chunk(plan.toChange, WRITE_CHUNK).length} steps` : ""}.
          </p>
          <NameList items={plan.toChange} label="Will change" />
        </div>
      )}

      {progress && <ProgressBar p={progress} />}
      {failedAt !== null && <p className="text-sm text-red-400">Stopped part-way — check your connection and press Retry. Items already done stay done.</p>}
      {done && <p className="text-sm text-emerald-400">Done. {progress?.done ?? 0} item{progress?.done === 1 ? "" : "s"} updated.</p>}
    </Sheet>
  );
}

// ── Bulk: link to a repair ───────────────────────────────────────────────────

function BulkLinkSheet({ tools, centerId, items, actor, onClose }: { tools: Tools; centerId: string; items: InventoryItem[]; actor: Actor; onClose: () => void }) {
  const { catalog } = tools;
  const [q, setQ] = useState("");
  const [repair, setRepair] = useState<RepairItem | null>(null);
  const [qty, setQty] = useState("1");
  const [conflict, setConflict] = useState<{ fresh: RepairItem; fields: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<number | null>(null);

  const options = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return catalog.repairs.filter((r) => r.isActive !== false && words.every((w) => `${r.name} ${r.category ?? ""}`.toLowerCase().includes(w))).slice(0, 12);
  }, [q, catalog.repairs]);

  const qtyNum = parseQty(qty);
  // The preview is judged against the newest copy we know of.
  const basis = conflict?.fresh ?? repair;
  const plan = useMemo(() => (basis && qtyNum != null ? planLinkToRepair(items, basis, qtyNum) : null), [basis, items, qtyNum]);

  async function confirm() {
    if (!repair || !plan || qtyNum == null) return;
    setBusy(true); setError("");
    try {
      let base = conflict?.fresh;
      if (!base) {
        const check = await checkRepairForLink(centerId, repair);
        if (check.conflict === "gone") { setError(`“${repair.name}” no longer exists.`); return; }
        if (check.conflict) { setConflict({ fresh: check.fresh, fields: check.fields }); return; }
        base = check.fresh;
      }
      // One repair document: a single write, merged by item id, so repeating it adds nothing twice.
      const next = planLinkToRepair(items, base, qtyNum);
      const saved = next.toAdd.length === 0 ? base : await saveSuggestedParts(centerId, base, next.nextParts, actor);
      catalog.setRepairs((prev) => [...prev.filter((r) => r.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setDone(next.toAdd.length);
      tools.clearSelection();
    } catch {
      setError("Couldn't save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Link to a repair"
      onClose={busy ? () => {} : onClose}
      footer={done !== null ? (
        <button type="button" className={primaryBtn} onClick={onClose}>Done</button>
      ) : (
        <>
          <button type="button" className={ghostBtn} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className={primaryBtn} disabled={busy || !plan || plan.toAdd.length === 0} onClick={confirm}>
            {busy ? "Saving…" : conflict ? "Add on top of their changes" : plan ? `Add ${plan.toAdd.length} part${plan.toAdd.length === 1 ? "" : "s"}` : "Add"}
          </button>
        </>
      )}
    >
      {catalog.error ? (
        <p className="text-sm text-gray-400">Couldn't load repairs. <button type="button" className="text-[#F97316] hover:underline" onClick={catalog.retry}>Try again</button></p>
      ) : !catalog.loaded ? (
        <p className="text-sm text-gray-500">Loading repairs…</p>
      ) : (
        <>
          {repair ? (
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 text-sm text-white truncate">{repair.name}</p>
              {done === null && !busy && <button type="button" className="text-xs text-gray-400 hover:text-white" onClick={() => { setRepair(null); setConflict(null); }}>Change</button>}
            </div>
          ) : (
            <div className="relative">
              <input className={fieldClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for the repair" aria-label="Search repairs" />
              {q.trim() && (
                <div className="mt-1 max-h-56 overflow-y-auto bg-[#0B1120] border border-white/10 rounded-xl">
                  {options.map((r) => (
                    <button type="button" key={r.id} onClick={() => setRepair(r)} className="w-full text-left px-3 py-2 hover:bg-white/5">
                      <span className="block text-sm text-white truncate">{r.name}</span>
                      {r.category && <span className="block text-[11px] text-gray-500">{r.category}</span>}
                    </button>
                  ))}
                  {options.length === 0 && <p className="px-3 py-2.5 text-sm text-gray-500">No matching repair.</p>}
                </div>
              )}
            </div>
          )}

          {repair && (
            <label className="flex items-center gap-2 text-sm text-gray-300">
              Default quantity per repair
              <input type="number" min="0" step="any" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} disabled={done !== null}
                className="w-20 bg-[#0B1120] border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white text-right" />
            </label>
          )}
          {repair && qtyNum == null && <p className="text-xs text-red-400">Enter a quantity above 0.</p>}

          {conflict && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200 space-y-1">
              <p>
                “{repair?.name}” was saved{conflict.fresh.updatedByName ? ` by ${conflict.fresh.updatedByName}` : " by someone else"} after you opened this list
                {conflict.fields.length > 0 && <> (changed: {conflict.fields.join(", ")})</>}.
              </p>
              <p className="text-xs text-amber-200/80">The preview below is against their version. Only the new parts are added; nothing else on the repair changes.</p>
            </div>
          )}

          {plan && done === null && (
            <div className="rounded-xl border border-white/10 bg-[#0B1120] p-3 space-y-3">
              <p className="text-sm text-white">
                {plan.toAdd.length} part{plan.toAdd.length === 1 ? "" : "s"} will be added to “{basis?.name}” at {qtyNum} each.
                {plan.alreadyLinked.length > 0 && <span className="text-gray-400"> {plan.alreadyLinked.length} already linked and left as they are.</span>}
              </p>
              <NameList items={plan.toAdd} label="Will be added" />
              <NameList items={plan.alreadyLinked} label="Already linked" />
            </div>
          )}
        </>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {done !== null && (
        <p className="text-sm text-emerald-400">{done === 0 ? "Nothing to add: every part was already linked." : `Done. ${done} part${done === 1 ? "" : "s"} linked to “${repair?.name}”.`}</p>
      )}
    </Sheet>
  );
}
