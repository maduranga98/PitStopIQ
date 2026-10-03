import { useRef, useState } from "react";
import { Camera, ChevronDown, MessageSquare, Plus } from "lucide-react";
import ResultButtons from "./ResultButtons";
import MediaThumb from "./MediaThumb";
import { MAX_TEMPLATE_LABEL_LENGTH } from "../../constants/inspectionReports";
import type {
  InspectionItemResult, InspectionMediaItem, InspectionReportOnlyItem, InspectionResultStatus,
  InspectionTemplateSection,
} from "../../types/inspectionReports";

interface RowItem { id: string; label: string; reportOnly: boolean }

export interface ChecklistSectionCardProps {
  section: InspectionTemplateSection;
  extraItems: InspectionReportOnlyItem[];
  results: Record<string, InspectionItemResult>;
  media: Record<string, InspectionMediaItem>;
  previews: Record<string, string>;
  readOnly: boolean;
  defaultOpen?: boolean;
  onStatus: (itemId: string, status: InspectionResultStatus | null) => void;
  onRemark: (itemId: string, text: string) => void;
  onAddPhotos: (itemId: string, files: File[]) => void;
  onRemovePhoto: (itemId: string, mediaId: string) => void;
  /** Omitted when the viewer can't add items to this report. */
  onAddReportOnlyItem?: (sectionId: string, label: string, saveToChecklist: boolean) => void;
  /** Owner/Manager only — a technician can't edit the center's template. */
  canSaveToChecklist: boolean;
}

export default function ChecklistSectionCard(p: ChecklistSectionCardProps) {
  const { section, results, media, previews, readOnly } = p;
  const [open, setOpen] = useState(p.defaultOpen === true);
  const [remarkOpen, setRemarkOpen] = useState<Record<string, boolean>>({});
  const [newLabel, setNewLabel] = useState("");
  const [saveToChecklist, setSaveToChecklist] = useState(false);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const items: RowItem[] = [
    ...section.items.map((i) => ({ id: i.id, label: i.label, reportOnly: false })),
    ...p.extraItems.filter((e) => e.sectionId === section.id).map((e) => ({ id: e.id, label: e.label, reportOnly: true })),
  ];
  const answered = items.filter((i) => results[i.id]?.status).length;
  const repairs = items.filter((i) => results[i.id]?.status === "needs_repair").length;

  function addItem() {
    if (!newLabel.trim() || !p.onAddReportOnlyItem) return;
    p.onAddReportOnlyItem(section.id, newLabel, p.canSaveToChecklist && saveToChecklist);
    setNewLabel("");
    setSaveToChecklist(false);
  }

  return (
    <div className="bg-[#162032] border border-white/10 rounded-xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-100">{section.title}</p>
          <p className="text-[11px] text-gray-500">{answered} of {items.length} answered</p>
        </div>
        {repairs > 0 && (
          <span className="text-[11px] font-semibold text-red-300 bg-red-500/10 border border-red-500/25 rounded-full px-2 py-0.5">
            {repairs} repair
          </span>
        )}
        <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-white/5 divide-y divide-white/5">
          {items.map((item) => {
            const r = results[item.id];
            const photoIds = r?.photoIds ?? [];
            const showRemark = remarkOpen[item.id] || !!r?.remark;
            return (
              <div key={item.id} className={`px-4 py-3 space-y-2.5 ${r?.status === "needs_repair" ? "bg-red-500/[0.04]" : ""}`}>
                <p className="text-sm text-gray-200 leading-snug">
                  {item.label}
                  {item.reportOnly && <span className="ml-1.5 text-[10px] text-gray-500">(this report only)</span>}
                </p>
                <ResultButtons value={r?.status ?? null} disabled={readOnly} onChange={(s) => p.onStatus(item.id, s)} />

                <div className="flex items-center gap-1.5">
                  {!readOnly && (
                    <>
                      <button
                        type="button"
                        onClick={() => setRemarkOpen((o) => ({ ...o, [item.id]: !o[item.id] }))}
                        className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] text-gray-400 hover:text-white hover:bg-white/5"
                      >
                        <MessageSquare className="w-3.5 h-3.5" /> Remark
                      </button>
                      <button
                        type="button"
                        onClick={() => fileRefs.current[item.id]?.click()}
                        className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] text-gray-400 hover:text-white hover:bg-white/5"
                      >
                        <Camera className="w-3.5 h-3.5" /> Photo
                      </button>
                      <input
                        ref={(el) => { fileRefs.current[item.id] = el; }}
                        type="file"
                        accept="image/*"
                        multiple
                        hidden
                        onChange={(e) => {
                          const files = Array.from(e.target.files ?? []);
                          e.target.value = "";
                          if (files.length) p.onAddPhotos(item.id, files);
                        }}
                      />
                    </>
                  )}
                </div>

                {showRemark && (
                  <textarea
                    value={r?.remark ?? ""}
                    readOnly={readOnly}
                    onChange={(e) => p.onRemark(item.id, e.target.value)}
                    rows={2}
                    maxLength={1000}
                    placeholder="Remark"
                    className="w-full bg-[#0B1120] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#F97316]/60 resize-y"
                  />
                )}

                {photoIds.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {photoIds.map((id) => media[id] && (
                      <MediaThumb
                        key={id}
                        item={media[id]}
                        preview={previews[id]}
                        disabled={readOnly}
                        onRemove={() => p.onRemovePhoto(item.id, id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {p.onAddReportOnlyItem && !readOnly && (
            <div className="px-4 py-3 space-y-2">
              <div className="flex gap-2">
                <input
                  value={newLabel}
                  maxLength={MAX_TEMPLATE_LABEL_LENGTH}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addItem()}
                  placeholder="Add an item to this report"
                  className="flex-1 min-w-0 bg-[#0B1120] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#F97316]/60"
                />
                <button
                  type="button"
                  onClick={addItem}
                  disabled={!newLabel.trim()}
                  aria-label="Add item"
                  className="px-3 rounded-lg bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-40 text-white"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              {p.canSaveToChecklist && newLabel.trim() && (
                <label className="flex items-center gap-2 text-xs text-gray-400">
                  <input type="checkbox" checked={saveToChecklist} onChange={(e) => setSaveToChecklist(e.target.checked)} className="accent-[#F97316]" />
                  Also save to my checklist
                </label>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
