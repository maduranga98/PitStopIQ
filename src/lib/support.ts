/**
 * Support contact details shown on the Help & Support page (and anywhere else
 * we tell an owner how to reach us). Single source of truth — update here to
 * change it everywhere.
 *
 * ⚠️ Fill these in before release. Any channel left blank is simply not shown
 * on the Help page, and if all of them are blank the page tells the user that
 * support details are not configured yet.
 */
export const SUPPORT_CONTACT = {
  /** Dial format, used for the tel: link. e.g. "+94771234567" */
  phone: "",
  /** Human-readable version of the same number. e.g. "+94 77 123 4567" */
  phoneDisplay: "",
  /** Digits only, no leading "+", as wa.me expects. e.g. "94771234567" */
  whatsapp: "",
  /** e.g. "support@lumoraventures.com" */
  email: "",
  company: "Lumora Ventures PVT LTD",
} as const;

/** wa.me link with an optional pre-filled first message. */
export function whatsappLink(message?: string): string {
  const base = `https://wa.me/${SUPPORT_CONTACT.whatsapp}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

/** True when at least one contact channel has been configured. */
export function hasSupportContact(): boolean {
  return Boolean(SUPPORT_CONTACT.phone || SUPPORT_CONTACT.whatsapp || SUPPORT_CONTACT.email);
}
