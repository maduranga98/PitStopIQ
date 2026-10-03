// ── Share text (pure) ────────────────────────────────────────────────────────
// Links and messages for WhatsApp / SMS / copy. No Firebase here, so it is
// unit-tested directly (shareText.test.ts).

export const PUBLIC_APP_BASE = "https://app.pitstopiq.com";
/** Scheme-less host for SMS bodies (phones linkify it; saves characters). */
export const SMS_LINK_HOST = "app.pitstopiq.com";

/** The report's own page. Works whatever the portal visibility setting. */
export const publicReportUrl = (shareToken: string) => `${PUBLIC_APP_BASE}/i/${shareToken}`;

/** Short-link code for a report: the first 7 characters of its (random) share
 *  token. Deterministic, so re-sending reuses the same `links/{code}` document
 *  instead of needing to store a code on a locked report. The token already
 *  grants access to the report, and the link resolves to it, so the code gives
 *  away nothing the link doesn't. */
export const shortCodeForToken = (shareToken: string) => shareToken.slice(0, 7);
export const smsShortLink = (shareToken: string) => `${SMS_LINK_HOST}/v/${shortCodeForToken(shareToken)}`;

/** wa.me wants digits only, country code first: "+94771234567" / "0771234567" -> "94771234567". */
export function whatsAppNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0094")) return digits.slice(2);
  return digits.startsWith("0") ? `94${digits.slice(1)}` : digits;
}

export function buildWhatsAppMessage(i: {
  customerName: string; reportNumber: string; plate: string; link: string; centerPhone?: string;
}): string {
  return `Dear ${i.customerName}, your vehicle inspection report ${i.reportNumber} for ${i.plate} is ready. View & download: ${i.link}` +
    (i.centerPhone ? ` — ${i.centerPhone}` : "");
}

export const whatsAppUrl = (phone: string, message: string) =>
  `https://wa.me/${whatsAppNumber(phone)}?text=${encodeURIComponent(message)}`;

/** Plain ASCII so it bills as one GSM-7 segment where it can. */
export function buildSmsMessage(i: {
  customerName: string; reportNumber: string; centerName: string; shareToken: string;
  /** Scheme-less link to use instead of the short one (e.g. when a short code clashes). */
  link?: string;
}): string {
  return `Dear ${i.customerName}, your vehicle inspection report ${i.reportNumber} from ${i.centerName} is ready: ${i.link ?? smsShortLink(i.shareToken)}`;
}
