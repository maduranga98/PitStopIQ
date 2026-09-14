// Shown at delivery time when more than one active checklist fits the person
// delivering and none of them is the center's default. Only role-eligible
// templates ever reach this list — the gate filters before it opens.
import { ClipboardCheck, X } from "lucide-react";
import type { PostServiceChecklistTemplate } from "../../types/auth";

export default function ChecklistTemplateSelector({ templates, onPick, onClose }: {
  templates: PostServiceChecklistTemplate[];
  onPick: (template: PostServiceChecklistTemplate) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-white">Which checklist?</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Pick the quality check this job has to pass before it's handed back.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => onPick(t)}
              className="w-full flex items-center gap-3 text-left bg-white/5 hover:bg-white/10 border border-white/10 hover:border-orange-500/40 rounded-lg px-3 py-3 transition"
            >
              <ClipboardCheck className="w-4 h-4 text-[#F97316] flex-shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-white truncate">{t.name}</span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  {t.items.length} {t.items.length === 1 ? "check" : "checks"}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
