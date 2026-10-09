import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import Sheet, { fieldClass, ghostBtn, primaryBtn } from "./Sheet";
import AppliesToEditor from "./AppliesToEditor";
import ScopeTargetField from "./ScopeTargetField";
import SuggestedPartsEditor from "./SuggestedPartsEditor";
import { changedFieldNames, detectEditConflict } from "../../lib/repairCatalog/catalog.ts";
import { emptyForm, formFromRepair, REPAIR_UNITS, validateForm, type RepairForm } from "../../lib/repairCatalog/form.ts";
import { createRepair, fetchRepairFresh, updateRepair, type Actor } from "../../lib/repairCatalog/repairWrites";
import type { InventoryItem } from "../../types/auth";
import type { RepairItem, VehicleGroup, VehicleModel } from "../../types/repairCatalog";

interface Props {
  centerId: string;
  actor: Actor;
  /** Editing this repair; omit to create. */
  repair?: RepairItem;
  /** Starting values for a new repair. */
  seed?: RepairForm;
  readOnly?: boolean;
  repairs: RepairItem[];
  categories: string[];
  models: VehicleModel[];
  groups: VehicleGroup[];
  typeOptions: string[];
  /** False for roles that cannot read inventory: the parts section is not shown. */
  canSeeParts: boolean;
  inventory: { items: InventoryItem[]; loaded: boolean };
  onClose: () => void;
  onSaved: (repair: RepairItem, created: boolean) => void;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{title}</h3>
        {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export default function RepairEditorSheet({
  centerId, actor, repair, seed, readOnly, repairs, categories, models, groups, typeOptions,
  canSeeParts, inventory, onClose, onSaved,
}: Props) {
  const [base, setBase] = useState<RepairItem | undefined>(repair);
  const [form, setForm] = useState<RepairForm>(() => (repair ? formFromRepair(repair) : seed ?? emptyForm()));
  // What `updatedAt` was when this sheet opened (or was last reloaded): the
  // best-effort guard against overwriting someone else's newer save.
  const openedAt = useRef<unknown>(repair?.updatedAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tried, setTried] = useState(false);
  const [conflict, setConflict] = useState<{ fresh: RepairItem; fields: string[] } | null>(null);

  const issues = useMemo(() => validateForm(form, repairs, base?.id), [form, repairs, base?.id]);
  const set = <K extends keyof RepairForm>(k: K, v: RepairForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const showErr = (k: string) => (tried ? issues.errors[k] : undefined);
  const hasErrors = Object.keys(issues.errors).length > 0;

  async function persist() {
    setBusy(true);
    setError("");
    try {
      const saved = base ? await updateRepair(centerId, base, form, actor) : await createRepair(centerId, form, actor);
      onSaved(saved, !base);
    } catch {
      setError("Couldn't save. Check your connection and try again.");
      setBusy(false);
    }
  }

  async function save() {
    setTried(true);
    if (hasErrors) return;
    if (base) {
      // Look at the stored copy before overwriting it. Offline this reads this
      // device's cache, so a conflict can't be seen: best effort, as designed.
      setBusy(true);
      try {
        const fresh = await fetchRepairFresh(centerId, base.id);
        if (fresh && detectEditConflict(openedAt.current, fresh.updatedAt)) {
          setConflict({ fresh, fields: changedFieldNames(base, fresh) });
          setBusy(false);
          return;
        }
      } catch {
        /* couldn't check; carry on rather than block the save */
      }
    }
    await persist();
  }

  function loadTheirs() {
    if (!conflict) return;
    setBase(conflict.fresh);
    openedAt.current = conflict.fresh.updatedAt;
    setForm(formFromRepair(conflict.fresh));
    setConflict(null);
  }

  async function overwrite() {
    // The user chose to keep their version over the newer one.
    if (conflict) setBase(conflict.fresh);
    setConflict(null);
    await persist();
  }

  const title = readOnly ? (repair?.name ?? "Repair") : base ? "Edit repair" : "New repair";

  return (
    <Sheet
      wide
      title={title}
      onClose={onClose}
      footer={
        readOnly ? (
          <button type="button" className={ghostBtn} onClick={onClose}>Close</button>
        ) : (
          <>
            <button type="button" className={ghostBtn} onClick={onClose}>Cancel</button>
            <button type="button" className={primaryBtn} disabled={busy} onClick={save}>
              {busy ? "Saving…" : base ? "Save" : "Add repair"}
            </button>
          </>
        )
      }
    >
      <fieldset disabled={readOnly} className="space-y-6 min-w-0">
        {conflict && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
            <p className="flex items-start gap-2 text-sm text-amber-100">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                This repair was changed
                {conflict.fresh.updatedByName ? ` by ${conflict.fresh.updatedByName}` : ""}
                {conflict.fresh.updatedAt ? ` at ${conflict.fresh.updatedAt.toDate().toLocaleString()}` : ""} since you opened it
                {conflict.fields.length > 0 ? ` (${conflict.fields.join(", ")})` : ""}. Saving now would replace their changes.
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={ghostBtn} onClick={loadTheirs}>Load their version (drops my edits)</button>
              <button type="button" className={primaryBtn} onClick={overwrite}>Overwrite with mine</button>
            </div>
          </div>
        )}

        <Section title="Repair">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-gray-300">Name</span>
            <input className={fieldClass} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Front brake pad replacement" autoFocus={!readOnly && !base} />
            {showErr("name") && <span className="text-xs text-red-400">{showErr("name")}</span>}
          </label>
          {issues.warnings.map((w) => (
            <p key={w} className="flex items-start gap-2 text-xs text-amber-300"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />{w}</p>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-gray-300">Category</span>
              <input className={fieldClass} list="rc-categories" value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="Brakes" />
              <datalist id="rc-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-gray-300">Unit</span>
              <select className={fieldClass} value={form.unit} onChange={(e) => set("unit", e.target.value)}>
                <option value="">None</option>
                {REPAIR_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                {form.unit && !(REPAIR_UNITS as readonly string[]).includes(form.unit) && <option value={form.unit}>{form.unit}</option>}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-gray-300">Default price (LKR)</span>
              <input className={fieldClass} type="number" min="0" step="any" inputMode="decimal" value={form.defaultPrice} onChange={(e) => set("defaultPrice", e.target.value)} placeholder="0" />
              {showErr("defaultPrice") && <span className="text-xs text-red-400">{showErr("defaultPrice")}</span>}
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-gray-300">Time <span className="text-gray-500 font-normal">(minutes, optional)</span></span>
              <input className={fieldClass} type="number" min="1" step="1" inputMode="numeric" value={form.estimatedMinutes} onChange={(e) => set("estimatedMinutes", e.target.value)} />
              {showErr("estimatedMinutes") && <span className="text-xs text-red-400">{showErr("estimatedMinutes")}</span>}
            </label>
          </div>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-gray-300">Description <span className="text-gray-500 font-normal">(optional)</span></span>
            <textarea className={`${fieldClass} min-h-[64px]`} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </label>
        </Section>

        <Section title="Offered for" hint="Which vehicles see this repair on a job.">
          <AppliesToEditor value={form.appliesTo} onChange={(v) => set("appliesTo", v)} models={models} groups={groups} typeOptions={typeOptions} error={showErr("appliesTo")} />
        </Section>

        <Section title="Prices for specific vehicles" hint="A model price beats a group price, which beats a type price, which beats the default. Among groups, the lower priority number wins.">
          {form.priceOverrides.map((o, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-start gap-2">
                <ScopeTargetField scope={o.scope} scopeId={o.scopeId} models={models} groups={groups} typeOptions={typeOptions}
                  onChange={(scope, scopeId) => set("priceOverrides", form.priceOverrides.map((x, j) => (j === i ? { ...x, scope, scopeId } : x)))} />
                <input type="number" min="0" step="any" inputMode="decimal" aria-label="Price"
                  className="w-28 bg-[#0B1120] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white text-right"
                  value={o.price} onChange={(e) => set("priceOverrides", form.priceOverrides.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
                <button type="button" className="p-2.5 text-gray-400 hover:text-red-400" aria-label="Remove price"
                  onClick={() => set("priceOverrides", form.priceOverrides.filter((_, j) => j !== i))}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              {showErr(`override.${i}`) && <p className="text-xs text-red-400">{showErr(`override.${i}`)}</p>}
            </div>
          ))}
          {!readOnly && (
            <button type="button" className="inline-flex items-center gap-1 text-sm text-[#F97316] hover:underline"
              onClick={() => set("priceOverrides", [...form.priceOverrides, { scope: "model", scopeId: "", price: form.defaultPrice }])}>
              <Plus className="w-4 h-4" /> Add a price
            </button>
          )}
        </Section>

        {canSeeParts ? (
          <Section title="Suggested parts" hint="Offered, ticked by default, when this repair is added to a job.">
            <SuggestedPartsEditor
              value={form.suggestedParts} onChange={(v) => set("suggestedParts", v)}
              items={inventory.items} loaded={inventory.loaded}
              models={models} groups={groups} typeOptions={typeOptions}
              errors={tried ? issues.errors : {}}
            />
          </Section>
        ) : form.suggestedParts.length > 0 ? (
          <p className="text-xs text-gray-500">{form.suggestedParts.length} suggested part{form.suggestedParts.length === 1 ? "" : "s"} (not shown for your role).</p>
        ) : null}

        {base && (
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" className="accent-[#F97316] w-4 h-4" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} />
            <span className="text-sm text-white">Active <span className="text-gray-500">(switched-off repairs are not offered on jobs)</span></span>
          </label>
        )}
      </fieldset>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </Sheet>
  );
}
