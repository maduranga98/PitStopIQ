import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  ArrowLeft, ChevronDown, ChevronUp, Eye, EyeOff, Plus, RotateCcw, ListChecks, AlertCircle,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { useInspectionReportsEnabled } from "../../hooks/useInspectionReportsEnabled";
import { useInspectionReportsSettingsStore } from "../../store/inspectionReportsSlice";
import { LoadingBlock } from "../../components/LoadingProgress";
import InlineText from "../../components/inspectionReports/InlineText";
import { MAX_TEMPLATE_LABEL_LENGTH } from "../../constants/inspectionReports";
import { ensureTemplate, saveTemplateSections } from "../../lib/inspectionReports/templates";
import {
  addItem, addSection, countRemovedDefaults, moveItem, moveSection, renameItem, renameSection,
  restoreRemovedDefaults, setItemHidden, setSectionHidden, sortedSections,
} from "../../lib/inspectionReports/templateOps";
import type { InspectionTemplateSection } from "../../types/inspectionReports";

const iconBtn =
  "p-1.5 sm:p-2 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-500 transition-colors";

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (label: string) => void }) {
  const [value, setValue] = useState("");
  function submit() {
    if (!value.trim()) return;
    onAdd(value);
    setValue("");
  }
  return (
    <div className="flex gap-2">
      <input
        value={value}
        maxLength={MAX_TEMPLATE_LABEL_LENGTH}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder={placeholder}
        className="flex-1 min-w-0 bg-[#0B1120] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#F97316]/60"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!value.trim()}
        aria-label={placeholder}
        className="px-3 rounded-lg bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-40 text-white"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

export default function InspectionTemplatePage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const centerId = currentUser?.centerId;
  const role = currentUser?.role;
  const mayManage = usePermission("inspectionReports.manageTemplate");
  const canManage = (role === "Owner" || role === "Manager") && mayManage;

  const enabled = useInspectionReportsEnabled(centerId);
  const flagLoaded = useInspectionReportsSettingsStore((s) => s.centerId === centerId && s.loaded);

  const [sections, setSections] = useState<InspectionTemplateSection[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState("");
  const loadedFor = useRef<string | null>(null);

  // Seeds the center's copy on first open (the other trigger is switching the
  // module on in Settings), then loads it once. No listener: one Owner/Manager
  // edits at a time and local state is the source of truth while editing.
  useEffect(() => {
    if (!centerId || !enabled || !canManage || loadedFor.current === centerId) return;
    loadedFor.current = centerId;
    let active = true;
    ensureTemplate(centerId)
      .then((t) => { if (active) setSections(sortedSections(t.sections)); })
      .catch((e: unknown) => {
        loadedFor.current = null;
        if (active) setError(e instanceof Error ? e.message : "Couldn't load your checklist.");
      });
    return () => { active = false; };
  }, [centerId, enabled, canManage]);

  const apply = useCallback((next: InspectionTemplateSection[]) => {
    if (!centerId) return;
    setSections(next);
    setNotice("");
    saveTemplateSections(centerId, next).catch(() => setError("Couldn't save that change. Check your connection."));
  }, [centerId]);

  const removedDefaults = useMemo(() => (sections ? countRemovedDefaults(sections) : 0), [sections]);

  if (!centerId || !flagLoaded) return <LoadingBlock />;
  if (!canManage || !enabled) return <Navigate to="/" replace />;

  const toggleOpen = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  function handleRestore() {
    if (!sections) return;
    const { sections: next, restored } = restoreRemovedDefaults(sections);
    apply(next);
    setNotice(`Restored ${restored} default ${restored === 1 ? "entry" : "entries"}.`);
  }

  function handleAddSection(title: string) {
    if (!sections) return;
    const { sections: next, id } = addSection(sections, title);
    if (!id) return;
    apply(next);
    setOpen((o) => ({ ...o, [id]: true }));
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white pb-16">
      <div className="border-b border-white/10 bg-[#0B1120]/90 backdrop-blur sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <button onClick={() => navigate("/settings?tab=services")} aria-label="Back" className={iconBtn}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <ListChecks className="w-5 h-5 text-[#F97316] flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <h1 className="text-base sm:text-lg font-bold leading-tight whitespace-nowrap">Checklist template</h1>
            <p className="hidden sm:block text-xs text-gray-500">Your copy. Edits apply to new reports only.</p>
          </div>
          <button
            onClick={handleRestore}
            aria-label="Restore removed defaults"
            disabled={!sections || removedDefaults === 0}
            className="flex flex-shrink-0 items-center gap-1.5 text-xs px-2.5 sm:px-3 py-2 rounded-lg border border-white/10 text-gray-300 hover:text-white hover:border-white/20 disabled:opacity-40 disabled:hover:text-gray-300"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Restore removed defaults</span>
            {removedDefaults > 0 && <span className="text-[#F97316]">({removedDefaults})</span>}
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 space-y-3">
        {error && (
          <div className="flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}
          </div>
        )}
        {notice && <p className="text-xs text-green-400">{notice}</p>}

        {!sections && !error && <LoadingBlock />}

        {sections?.map((section, si) => {
          const isOpen = open[section.id] === true;
          const hiddenCount = section.items.filter((i) => i.hidden).length;
          return (
            <div
              key={section.id}
              className={`bg-[#162032] border border-white/10 rounded-xl ${section.hidden ? "opacity-60" : ""}`}
            >
              <div className="flex items-center gap-0.5 sm:gap-1 p-2 pl-3 sm:pl-4">
                <button
                  type="button"
                  onClick={() => toggleOpen(section.id)}
                  aria-label={isOpen ? "Collapse section" : "Expand section"}
                  className={iconBtn}
                >
                  <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
                <div className="flex-1 min-w-0">
                  <InlineText
                    value={section.title}
                    onSave={(t) => apply(renameSection(sections, section.id, t))}
                    className="text-sm font-semibold text-gray-100 break-words leading-snug block w-full"
                  />
                  <p className="text-[11px] text-gray-500">
                    {section.items.length - hiddenCount} item{section.items.length - hiddenCount === 1 ? "" : "s"}
                    {hiddenCount > 0 && ` · ${hiddenCount} hidden`}
                    {section.hidden && " · section hidden"}
                  </p>
                </div>
                <button type="button" aria-label="Move section up" disabled={si === 0}
                  onClick={() => apply(moveSection(sections, section.id, -1))} className={iconBtn}>
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button type="button" aria-label="Move section down" disabled={si === sections.length - 1}
                  onClick={() => apply(moveSection(sections, section.id, 1))} className={iconBtn}>
                  <ChevronDown className="w-4 h-4" />
                </button>
                <button type="button" aria-label={section.hidden ? "Show section" : "Hide section"}
                  onClick={() => apply(setSectionHidden(sections, section.id, !section.hidden))} className={iconBtn}>
                  {section.hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {isOpen && (
                <div className="border-t border-white/5 p-3 pl-4 space-y-0.5">
                  {section.items.map((item, ii) => (
                    <div key={item.id} className={`flex items-center gap-0.5 sm:gap-1 ${item.hidden ? "opacity-50" : ""}`}>
                      <InlineText
                        value={item.label}
                        onSave={(l) => apply(renameItem(sections, section.id, item.id, l))}
                        className="flex-1 text-sm text-gray-300 py-1.5 break-words leading-snug"
                      />
                      <button type="button" aria-label="Move item up" disabled={ii === 0}
                        onClick={() => apply(moveItem(sections, section.id, item.id, -1))} className={iconBtn}>
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button type="button" aria-label="Move item down" disabled={ii === section.items.length - 1}
                        onClick={() => apply(moveItem(sections, section.id, item.id, 1))} className={iconBtn}>
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      <button type="button" aria-label={item.hidden ? "Show item" : "Hide item"}
                        onClick={() => apply(setItemHidden(sections, section.id, item.id, !item.hidden))} className={iconBtn}>
                        {item.hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  ))}
                  {section.items.length === 0 && <p className="text-xs text-gray-600 py-1">No items yet.</p>}
                  <div className="pt-2">
                    <AddRow
                      placeholder="Add item"
                      onAdd={(label) => apply(addItem(sections, section.id, label).sections)}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {sections && (
          <div className="pt-2">
            <AddRow placeholder="Add section" onAdd={handleAddSection} />
          </div>
        )}
      </div>
    </div>
  );
}
