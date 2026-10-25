// "Send to customer" on a signed-off checklist: makes the report PDF, then opens
// WhatsApp with the message and the link filled in. Owner / Manager only, and
// only while the Owner's switch is on (see canSendChecklist).
//
// WhatsApp hands the message to the person to press send, so there is no way to
// know it was actually delivered. A standalone record is therefore marked sent
// the moment WhatsApp is opened — from then on it can't be deleted, because the
// customer may already be holding the link.
import { useEffect, useState } from "react";
import { Loader2, Lock, Send, X } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { useWorkshopModules } from "../../hooks/useWorkshopModules";
import { fetchCenter } from "../../lib/refData";
import { fetchChecklistPdfUrl, type ChecklistPdfKind } from "../../lib/postServiceChecklistPdf";
import { markChecklistSent } from "../../lib/standaloneChecklists";
import {
  buildChecklistWhatsAppMessage, canSendChecklist, checklistWhatsAppUrl, isDialable,
} from "../../lib/checklistShare";

interface Props {
  centerId: string;
  /** A job's checklist is addressed by the job id, a standalone record by its own id. */
  kind: ChecklistPdfKind;
  id: string;
  customerName?: string;
  /** Prefilled; editable, since a typed-in customer has none on file. */
  customerPhone?: string;
  plate?: string;
  /** Standalone only: already marked sent (a resend doesn't write again). */
  alreadySent?: boolean;
  /** Standalone only: called once the record has been marked sent. */
  onSent?: () => void;
}

export default function ChecklistSendButton({
  centerId, kind, id, customerName, customerPhone, plate, alreadySent, onSent,
}: Props) {
  const { currentUser } = useAuth();
  const { postServiceChecklistSendEnabled } = useWorkshopModules(centerId);
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(customerPhone ?? "");
  const [center, setCenter] = useState<{ name: string; phone: string }>({ name: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Only read once the dialog is wanted; cached by refData either way.
  useEffect(() => {
    if (!open) return;
    let live = true;
    fetchCenter(centerId).then((c) => {
      if (live && c) setCenter({ name: c.name ?? "", phone: c.phone ?? "" });
    }).catch(() => {});
    return () => { live = false; };
  }, [open, centerId]);

  if (!canSendChecklist({ role: currentUser?.role, sendEnabled: postServiceChecklistSendEnabled, signedOff: true })) {
    return null;
  }

  const lockWarning = kind === "standalone" && !alreadySent;
  const phoneProblem = phone.trim() !== "" && !isDialable(phone);

  async function send() {
    if (busy || phoneProblem || !currentUser) return;
    setBusy(true);
    setError("");
    // Opened inside the click and pointed at WhatsApp afterwards: a window opened
    // after an await is treated as a pop-up and blocked on phones and Safari.
    const tab = window.open("", "_blank");
    try {
      const link = await fetchChecklistPdfUrl(centerId, kind, id);
      if (kind === "standalone" && !alreadySent) {
        await markChecklistSent(centerId, id, currentUser.uid);
        onSent?.();
      }
      const message = buildChecklistWhatsAppMessage({
        customerName, plate, centerName: center.name, centerPhone: center.phone, link,
      });
      const url = checklistWhatsAppUrl(phone, message);
      if (tab) tab.location.href = url;
      else window.location.assign(url);
      setOpen(false);
    } catch {
      tab?.close();
      setError("Couldn't prepare the report. Sending needs a connection — check it and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => { setPhone(customerPhone ?? ""); setError(""); setOpen(true); }}
        className="flex items-center gap-1.5 text-sm text-white bg-[#F97316] hover:bg-[#ea6c0f] rounded-lg px-3 py-1.5"
      >
        <Send className="w-4 h-4" /> {alreadySent ? "Send again" : "Send to customer"}
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={busy ? undefined : () => setOpen(false)} />
          <div role="dialog" aria-label="Send to customer" className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 text-left">
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-base font-semibold text-white">Send to customer</h3>
              <button onClick={() => setOpen(false)} disabled={busy} aria-label="Close" className="text-gray-500 hover:text-gray-300 disabled:opacity-40">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-400">
              Opens WhatsApp with the report's PDF link ready to send. It doesn't use any SMS credits.
            </p>

            <div className="space-y-1.5">
              <label htmlFor="send-phone" className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                Customer's WhatsApp number
              </label>
              <input
                id="send-phone"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0771234567 — or leave blank to pick a contact"
                aria-invalid={phoneProblem}
                className={`w-full bg-white/5 border text-white rounded-lg px-3 py-2 text-sm focus:outline-none ${phoneProblem ? "border-red-500/60" : "border-white/10 focus:border-orange-500"}`}
              />
              {phoneProblem && <p className="text-xs text-red-400">That doesn't look like a phone number.</p>}
            </div>

            {lockWarning && (
              <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>Once sent, this checklist can't be deleted — the customer may already have the link.</span>
              </div>
            )}

            {error && <p role="alert" className="text-xs text-red-400">{error}</p>}

            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setOpen(false)} disabled={busy} className="text-sm text-gray-400 hover:text-white px-4 py-2 disabled:opacity-40">Cancel</button>
              <button
                onClick={send}
                disabled={busy || phoneProblem}
                className="bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-2"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                Open WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
