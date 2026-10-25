// The body of the Post-Service Checklist module card in Settings → Services &
// Modules. The master toggle itself lives on the card (same as every other
// module); this is what sits underneath it once the module is on.
//
// The template library is Owner-only, so a Manager who can otherwise edit the
// service library sees why the section is locked rather than an empty list.
import { useState } from "react";
import { Lock } from "lucide-react";
import ChecklistTemplateManager from "./ChecklistTemplateManager";

export default function PostServiceChecklistSettings({
  centerId, isOwner, sendToCustomerEnabled, onToggleSendToCustomer,
}: {
  centerId: string;
  isOwner: boolean;
  /** Whether a completed checklist can be sent on to the customer. */
  sendToCustomerEnabled: boolean;
  onToggleSendToCustomer: () => void | Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  async function toggleSend() {
    if (saving) return;
    setSaving(true);
    try { await onToggleSendToCustomer(); } finally { setSaving(false); }
  }

  if (!isOwner) {
    return (
      <div className="border-t border-white/5 pt-4">
        <div className="flex items-start gap-2 text-xs text-gray-400 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
          <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            Only the Owner can add or change checklists — the same as Staff &amp; Roles. Finished jobs
            remind staff about whichever checklists they've set up.
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {/* Independent of the module switch above: this only decides whether the
          "Send to customer" action is offered on a completed checklist. */}
      <div className="border-t border-white/5 pt-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-white">Send to customer</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Lets the Owner or a Manager send a completed checklist to the customer as a PDF over
            WhatsApp. Off by default; it does not use SMS credits.
          </p>
        </div>
        <button
          onClick={toggleSend}
          disabled={saving}
          role="switch"
          aria-checked={sendToCustomerEnabled}
          aria-label="Send to customer"
          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
            sendToCustomerEnabled ? "bg-[#F97316]" : "bg-white/10"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
              sendToCustomerEnabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>
      <ChecklistTemplateManager centerId={centerId} />
    </div>
  );
}
