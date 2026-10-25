// Sending a signed-off post-service checklist to the customer: who may, the
// WhatsApp message, and the link. Pure — the IO (making the PDF, marking the
// record sent) lives in standaloneChecklists.ts / postServiceChecklistPdf.ts.
//
// WhatsApp, not SMS, on purpose: it opens the existing wa.me share pattern and
// never touches the center's SMS quota or the smsLogs pipeline.
import { whatsAppNumber, whatsAppUrl } from "./inspectionReports/shareText.ts";

/**
 * Sending a report outside the building is Owner / Manager work, like billing
 * and staff — Technicians fill and sign checklists but don't send them. The
 * record has to be signed off, and the Owner's "Send to customer" switch on.
 * (firestore.rules holds the same line for marking a record as sent.)
 */
export function canSendChecklist(i: {
  role: string | undefined; sendEnabled: boolean; signedOff: boolean;
}): boolean {
  return (i.role === "Owner" || i.role === "Manager") && i.sendEnabled && i.signedOff;
}

export function buildChecklistWhatsAppMessage(i: {
  customerName?: string; plate?: string; centerName?: string; link: string; centerPhone?: string;
}): string {
  const who = i.customerName?.trim() ? `Dear ${i.customerName.trim()}, your` : "Your";
  const vehicle = i.plate?.trim() ? ` for ${i.plate.trim()}` : "";
  const from = i.centerName?.trim() ? ` from ${i.centerName.trim()}` : "";
  return `${who} post-service checklist report${vehicle}${from} is ready. View & download: ${i.link}` +
    (i.centerPhone?.trim() ? ` — ${i.centerPhone.trim()}` : "");
}

/** True when the text has enough digits to be a phone number wa.me can open. */
export function isDialable(phone: string): boolean {
  const n = whatsAppNumber(phone);
  return n.length >= 9 && n.length <= 15;
}

/**
 * The WhatsApp link. With a usable number it opens that chat; without one it
 * opens WhatsApp's own contact picker with the message filled in, so a customer
 * who was typed in by hand (no phone on file) can still be sent the report.
 */
export function checklistWhatsAppUrl(phone: string, message: string): string {
  return isDialable(phone)
    ? whatsAppUrl(phone, message)
    : `https://wa.me/?text=${encodeURIComponent(message)}`;
}
