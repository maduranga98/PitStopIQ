// The body of the Post-Service Checklist module card in Settings → Services &
// Modules. The master toggle itself lives on the card (same as every other
// module); this is what sits underneath it once the module is on.
//
// The template library is Owner-only, so a Manager who can otherwise edit the
// service library sees why the section is locked rather than an empty list.
import { Lock } from "lucide-react";
import ChecklistTemplateManager from "./ChecklistTemplateManager";

export default function PostServiceChecklistSettings({ centerId, isOwner }: {
  centerId: string;
  isOwner: boolean;
}) {
  if (!isOwner) {
    return (
      <div className="border-t border-white/5 pt-4">
        <div className="flex items-start gap-2 text-xs text-gray-400 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
          <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            Only the Owner can add or change checklists — the same as Staff &amp; Roles. Jobs
            are still gated by whichever checklists they've set up.
          </span>
        </div>
      </div>
    );
  }
  return <ChecklistTemplateManager centerId={centerId} />;
}
