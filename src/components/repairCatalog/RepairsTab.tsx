import { useMemo, useState } from "react";
import { Copy, Eye, Pencil, Plus, Power, Tags } from "lucide-react";
import RepairEditorSheet from "./RepairEditorSheet";
import CategoriesSheet from "./CategoriesSheet";
import { fieldClass, ghostBtn, primaryBtn } from "./Sheet";
import { appliesSummary, categoryList, filterRepairs } from "../../lib/repairCatalog/catalog.ts";
import { emptyForm, type RepairForm } from "../../lib/repairCatalog/form.ts";
import { duplicateRepair, setRepairActive, type Actor } from "../../lib/repairCatalog/repairWrites";
import { formatLKR } from "../../lib/reportFormat";
import type { RepairCatalogData } from "../../hooks/useRepairCatalog";
import type { ModelsAndGroups } from "../../hooks/useRepairModels";
import type { InventoryItem } from "../../types/auth";
import type { RepairItem } from "../../types/repairCatalog";

const PAGE_STEP = 50;

interface Props {
  centerId: string;
  actor: Actor;
  catalog: RepairCatalogData;
  mg: ModelsAndGroups;
  typeOptions: string[];
  canCreate: boolean;
  canEdit: boolean;
  canSeeParts: boolean;
  inventory: { items: InventoryItem[]; loaded: boolean };
}

type EditorState = { repair?: RepairItem; seed?: RepairForm; readOnly?: boolean } | null;

export default function RepairsTab({ centerId, actor, catalog, mg, typeOptions, canCreate, canEdit, canSeeParts, inventory }: Props) {
  const { repairs, storedCategories, setRepairs, setStoredCategories } = catalog;
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [visible, setVisible] = useState(PAGE_STEP);
  const [editor, setEditor] = useState<EditorState>(null);
  const [cats, setCats] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const categories = useMemo(() => categoryList(storedCategories, repairs), [storedCategories, repairs]);
  const filtered = useMemo(() => filterRepairs(repairs, { q, category, showInactive }), [repairs, q, category, showInactive]);
  const page = filtered.slice(0, visible);

  const upsert = (r: RepairItem) =>
    setRepairs((prev) => {
      const without = prev.filter((x) => x.id !== r.id);
      return [...without, r].sort((a, b) => a.name.localeCompare(b.name));
    });

  async function toggleActive(r: RepairItem) {
    setError(""); setBusyId(r.id);
    try { upsert(await setRepairActive(centerId, r, r.isActive === false, actor)); }
    catch { setError("Couldn't update the repair. Try again."); }
    setBusyId(null);
  }

  async function duplicate(r: RepairItem) {
    setError(""); setBusyId(r.id);
    try {
      const copy = await duplicateRepair(centerId, r, repairs, actor);
      upsert(copy);
      setEditor({ repair: copy }); // open the copy so it can be renamed straight away
    } catch { setError("Couldn't duplicate the repair. Try again."); }
    setBusyId(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <input className={fieldClass} value={q} onChange={(e) => { setQ(e.target.value); setVisible(PAGE_STEP); }} placeholder="Search repairs" />
        <select className={`${fieldClass} sm:w-44`} value={category} onChange={(e) => { setCategory(e.target.value); setVisible(PAGE_STEP); }}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {canEdit && (
          <button type="button" className={`${ghostBtn} flex items-center justify-center gap-1.5 whitespace-nowrap`} onClick={() => setCats(true)}>
            <Tags className="w-4 h-4" /> Categories
          </button>
        )}
        {canCreate && (
          <button type="button" className={`${primaryBtn} flex items-center justify-center gap-1.5 whitespace-nowrap`}
            onClick={() => setEditor({ seed: emptyForm(category) })}>
            <Plus className="w-4 h-4" /> Add repair
          </button>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{filtered.length} repair{filtered.length === 1 ? "" : "s"}</span>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" className="accent-[#F97316]" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show switched-off
        </label>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {repairs.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-[#162032] p-8 text-center">
          <p className="text-sm text-gray-300">No repairs yet.</p>
          <p className="text-xs text-gray-500 mt-1">Add the repairs your shop does, with a default price and which vehicles they are for.</p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-500">No repairs match.</p>
      ) : (
        <ul className="space-y-2">
          {page.map((r) => {
            const off = r.isActive === false;
            return (
              <li key={r.id} className={`rounded-xl border border-white/10 bg-[#162032] px-4 py-3 ${off ? "opacity-60" : ""}`}>
                <div className="flex items-start gap-3">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditor({ repair: r, readOnly: !canEdit })}>
                    <p className="text-sm font-semibold text-white truncate">{r.name}</p>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {r.category && <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-gray-300">{r.category}</span>}
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#F97316]/15 text-orange-200">{formatLKR(r.defaultPrice)}</span>
                      {r.priceOverrides.length > 0 && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-gray-300">+{r.priceOverrides.length} price{r.priceOverrides.length === 1 ? "" : "s"}</span>
                      )}
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-gray-400">{appliesSummary(r.appliesTo)}</span>
                      {canSeeParts && r.suggestedParts.length > 0 && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-gray-400">{r.suggestedParts.length} part{r.suggestedParts.length === 1 ? "" : "s"}</span>
                      )}
                      {off && <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-700/50 text-gray-300">Off</span>}
                    </div>
                  </button>
                  <div className="flex gap-0.5 flex-shrink-0">
                    {canEdit ? (
                      <>
                        <button type="button" className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/5" aria-label={`Edit ${r.name}`} onClick={() => setEditor({ repair: r })}><Pencil className="w-4 h-4" /></button>
                        {canCreate && <button type="button" disabled={busyId === r.id} className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/5" aria-label={`Duplicate ${r.name}`} onClick={() => duplicate(r)}><Copy className="w-4 h-4" /></button>}
                        <button type="button" disabled={busyId === r.id} className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/5" aria-label={off ? "Switch on" : "Switch off"} onClick={() => toggleActive(r)}><Power className="w-4 h-4" /></button>
                      </>
                    ) : (
                      <button type="button" className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/5" aria-label={`View ${r.name}`} onClick={() => setEditor({ repair: r, readOnly: true })}><Eye className="w-4 h-4" /></button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {filtered.length > visible && (
        <button type="button" className={`${ghostBtn} w-full`} onClick={() => setVisible((v) => v + PAGE_STEP)}>
          Show more ({filtered.length - visible} left)
        </button>
      )}

      {editor && (
        <RepairEditorSheet
          key={editor.repair?.id ?? "new"}
          centerId={centerId} actor={actor}
          repair={editor.repair} seed={editor.seed} readOnly={editor.readOnly}
          repairs={repairs} categories={categories}
          models={mg.models} groups={mg.groups} typeOptions={typeOptions}
          canSeeParts={canSeeParts} inventory={inventory}
          onClose={() => setEditor(null)}
          onSaved={(r) => { upsert(r); setEditor(null); }}
        />
      )}
      {cats && (
        <CategoriesSheet
          centerId={centerId} actor={actor} list={categories} repairs={repairs}
          onClose={() => setCats(false)}
          onChanged={(list, renamed) => {
            setStoredCategories(list);
            if (renamed) {
              setRepairs((prev) => prev.map((r) =>
                (r.category ?? "").trim().toLowerCase() === renamed.from.trim().toLowerCase() ? { ...r, category: renamed.to } : r));
              if (category.trim().toLowerCase() === renamed.from.trim().toLowerCase()) setCategory(renamed.to);
            }
          }}
        />
      )}
    </div>
  );
}
