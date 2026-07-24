export const PUBLIC_VIEW_BASE = "https://app.pitstopiq.com";

export function buildViewLink(centerId: string, customerId: string): string {
  return `${PUBLIC_VIEW_BASE}/c/${centerId}/${customerId}`;
}

// ── Default templates (cost-optimised) ───────────────────────────────────────
// Carriers bill SMS per *segment*, and the segment size depends on encoding:
//   • GSM-7 (plain English/Latin): 160 chars single / 153 per joined segment.
//   • UCS-2 (Sinhala, Tamil, emoji, smart quotes): only 70 / 67 chars.
// A single non-GSM-7 character (even a "—" em-dash) switches the WHOLE message
// to UCS-2, more than doubling the cost. The defaults below therefore:
//   • use a plain "-" instead of "—" so English stays GSM-7,
//   • are kept short and single-line, and
//   • drop the itemised services list from the body (the full invoice is one
//     tap away via {ViewLink}), which alone saves a segment on Unicode sends.
// See analyzeSms() for the exact segmentation used across the UI.
export const DEFAULT_COMPLETION_TEMPLATE =
  "Hi {CustomerName}, {Plate} is ready. Total LKR {InvoiceTotal}, next service {NextServiceMileage} km. View invoice & history: {ViewLink} - {CenterName}";

export const DEFAULT_REMINDER_TEMPLATE =
  "Hi {CustomerName}, {Plate} is due for service (now {CurrentKm} km, next {NextServiceMileage} km). History: {ViewLink} - {CenterName}";

// ── Multi-language defaults ──────────────────────────────────────────────────
// The SMS sent to a customer uses the template for that customer's preferred
// language (Customer.smsLanguage). Owners can customise each language in
// Settings → SMS; if left blank the defaults below are used.
export type SmsLang = "english" | "sinhala" | "tamil";

export const DEFAULT_COMPLETION_TEMPLATES: Record<SmsLang, string> = {
  english: DEFAULT_COMPLETION_TEMPLATE,
  sinhala:
    "{CustomerName}, ඔබගේ {Plate} සූදානම්. එකතුව රු.{InvoiceTotal}, ඊළඟ සේවාව {NextServiceMileage} km. බිල්පත බලන්න: {ViewLink} - {CenterName}",
  tamil:
    "{CustomerName}, {Plate} தயார். மொத்தம் ரூ.{InvoiceTotal}, அடுத்த சேவை {NextServiceMileage} km. பில் & வரலாறு: {ViewLink} - {CenterName}",
};

export const DEFAULT_REMINDER_TEMPLATES: Record<SmsLang, string> = {
  english: DEFAULT_REMINDER_TEMPLATE,
  sinhala:
    "{CustomerName}, ඔබගේ {Plate} සේවාවට නියමිතයි (දැන් {CurrentKm} km, ඊළඟ {NextServiceMileage} km). {ViewLink} - {CenterName}",
  tamil:
    "{CustomerName}, {Plate} சேவைக்கு உரியது (இப்போது {CurrentKm} km, அடுத்து {NextServiceMileage} km). {ViewLink} - {CenterName}",
};

export const SMS_LANGUAGES: { value: SmsLang; label: string }[] = [
  { value: "english", label: "English" },
  { value: "sinhala", label: "සිංහල (Sinhala)" },
  { value: "tamil", label: "தமிழ் (Tamil)" },
];

/** Firestore field name holding the completion template for a given language. */
export function completionTemplateField(lang: SmsLang): string {
  return lang === "sinhala" ? "completionSmsTemplateSi"
    : lang === "tamil" ? "completionSmsTemplateTa"
    : "completionSmsTemplate";
}

/** Firestore field name holding the reminder template for a given language. */
export function reminderTemplateField(lang: SmsLang): string {
  return lang === "sinhala" ? "reminderSmsTemplateSi"
    : lang === "tamil" ? "reminderSmsTemplateTa"
    : "reminderSmsTemplate";
}

/** Effective completion template for a language (custom override or default). */
export function getCompletionTemplate(center: Record<string, unknown> | null | undefined, lang: SmsLang): string {
  const custom = center?.[completionTemplateField(lang)];
  return (typeof custom === "string" && custom.trim()) ? custom : DEFAULT_COMPLETION_TEMPLATES[lang];
}

/** Effective reminder template for a language (custom override or default). */
export function getReminderTemplate(center: Record<string, unknown> | null | undefined, lang: SmsLang): string {
  const custom = center?.[reminderTemplateField(lang)];
  return (typeof custom === "string" && custom.trim()) ? custom : DEFAULT_REMINDER_TEMPLATES[lang];
}

export const VALID_PLACEHOLDERS = [
  "{CustomerName}",
  "{Plate}",
  "{CenterName}",
  "{CenterPhone}",
  "{ServicesList}",
  "{MileageOut}",
  "{NextServiceMileage}",
  "{CurrentKm}",
  "{InvoiceNumber}",
  "{InvoiceTotal}",
  "{ViewLink}",
] as const;

export type Placeholder = (typeof VALID_PLACEHOLDERS)[number];

export interface CompletionData {
  customerName: string;
  plate: string;
  centerName: string;
  centerPhone: string;
  servicesList: string;
  mileageOut: string;
  nextServiceMileage: string;
  invoiceNumber?: string;
  invoiceTotal?: string;
  viewLink?: string;
}

export interface ReminderData {
  customerName: string;
  plate: string;
  centerName: string;
  centerPhone: string;
  currentKm: string;
  nextServiceMileage: string;
  viewLink?: string;
}

export function resolveCompletionTemplate(template: string, data: CompletionData): string {
  return template
    .replace(/{CustomerName}/g, data.customerName)
    .replace(/{Plate}/g, data.plate.toUpperCase())
    .replace(/{CenterName}/g, data.centerName)
    .replace(/{CenterPhone}/g, data.centerPhone)
    .replace(/{ServicesList}/g, data.servicesList)
    .replace(/{MileageOut}/g, data.mileageOut)
    .replace(/{NextServiceMileage}/g, data.nextServiceMileage)
    .replace(/{InvoiceNumber}/g, data.invoiceNumber ?? "")
    .replace(/{InvoiceTotal}/g, data.invoiceTotal ?? "")
    .replace(/{ViewLink}/g, data.viewLink ?? PUBLIC_VIEW_BASE);
}

export function resolveReminderTemplate(template: string, data: ReminderData): string {
  return template
    .replace(/{CustomerName}/g, data.customerName)
    .replace(/{Plate}/g, data.plate.toUpperCase())
    .replace(/{CenterName}/g, data.centerName)
    .replace(/{CenterPhone}/g, data.centerPhone)
    .replace(/{CurrentKm}/g, data.currentKm)
    .replace(/{NextServiceMileage}/g, data.nextServiceMileage)
    .replace(/{ViewLink}/g, data.viewLink ?? PUBLIC_VIEW_BASE);
}

export function validateTemplate(template: string): string[] {
  const found = template.match(/\{[^}]+\}/g) ?? [];
  return found.filter((p) => !VALID_PLACEHOLDERS.includes(p as Placeholder));
}

// ── SMS segmentation & cost ─────────────────────────────────────────────────
// Segment size depends on the encoding the carrier picks for the message:
//   • GSM-7  — 160 chars for a single SMS, 153 per segment once it splits.
//   • UCS-2  — only 70 chars single, 67 per segment. Used the moment ANY
//              character falls outside GSM-7 (Sinhala, Tamil, emoji, "…", "—").
// So one stray Unicode character can more than double the price of an otherwise
// English message. normalizeSmsBody() below maps the common typographic
// offenders back to GSM-7 so that only genuinely non-Latin text pays the
// Unicode premium — the same normalisation the sending Cloud Function applies.
export type SmsEncoding = "gsm7" | "unicode";

// GSM 03.38 basic set. Anything here encodes as a single 7-bit septet.
const GSM7_BASIC = new Set(
  [
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?",
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
  ].join(""),
);
// GSM 03.38 extension set. Each of these costs TWO septets (an escape + char).
const GSM7_EXTENDED = new Set([..."\f^{}\\[~]|€"]);

// Common non-GSM punctuation → GSM-7 equivalents. Keeps English messages out of
// UCS-2 when a template or a customer name carries a smart quote / em-dash / etc.
const GSM7_SUBSTITUTIONS: Record<string, string> = {
  "—": "-", "–": "-", "‒": "-", "−": "-", // — – ‒ −
  "‘": "'", "’": "'", "‚": "'", "′": "'", // ‘ ’ ‚ ′
  "“": '"', "”": '"', "„": '"', "″": '"', // “ ” „ ″
  "…": "...",                                            // …
  " ": " ", " ": " ", " ": " ",                // no-break spaces
  "•": "*", "·": ".", "×": "x",                // • · ×
};

/** Replace typographic characters with GSM-7-safe equivalents. */
export function normalizeSmsBody(text: string): string {
  let out = "";
  for (const ch of text) out += GSM7_SUBSTITUTIONS[ch] ?? ch;
  return out;
}

export interface SmsSegmentInfo {
  encoding: SmsEncoding;
  /** Visible characters typed. */
  chars: number;
  /** Billable code units (GSM septets or UTF-16 units). */
  units: number;
  /** Number of SMS segments (credits) the carrier will bill. */
  segments: number;
  /** Characters that fit in a single-segment message for this encoding. */
  singleMax: number;
  /** Characters per segment once the message splits. */
  multiMax: number;
}

/** Encoding-aware segmentation matching how carriers actually bill an SMS. */
export function analyzeSms(text: string): SmsSegmentInfo {
  const normalized = normalizeSmsBody(text);
  let isGsm7 = true;
  let septets = 0;
  for (const ch of normalized) {
    if (GSM7_BASIC.has(ch)) septets += 1;
    else if (GSM7_EXTENDED.has(ch)) septets += 2;
    else { isGsm7 = false; break; }
  }
  const chars = [...normalized].length;
  if (isGsm7) {
    const segments = septets <= 160 ? 1 : Math.ceil(septets / 153);
    return { encoding: "gsm7", chars, units: septets, segments, singleMax: 160, multiMax: 153 };
  }
  const units = normalized.length; // UTF-16 code units == UCS-2 code units
  const segments = units <= 70 ? 1 : Math.ceil(units / 67);
  return { encoding: "unicode", chars, units, segments, singleMax: 70, multiMax: 67 };
}

/** Number of billed SMS segments (credits) for a resolved message body. */
export function smsSegments(text: string): number {
  return analyzeSms(text).segments;
}

export const SAMPLE_COMPLETION: CompletionData = {
  customerName: "Ashan Perera",
  plate: "ABC-1234",
  centerName: "Silva Auto Care",
  centerPhone: "+94771234567",
  servicesList: "Oil Change, Air Filter, Brake Inspection",
  mileageOut: "52500",
  nextServiceMileage: "57500",
  invoiceTotal: "12,500.00",
  viewLink: "https://app.pitstopiq.com/c/svc0000000000000000/cus0000000000000000",
};

export const SAMPLE_REMINDER: ReminderData = {
  customerName: "Ashan Perera",
  plate: "ABC-1234",
  centerName: "Silva Auto Care",
  centerPhone: "+94771234567",
  currentKm: "56800",
  nextServiceMileage: "57500",
  viewLink: "https://app.pitstopiq.com/c/svc0000000000000000/cus0000000000000000",
};

export function smsQuotaLimit(plan: "basic" | "pro"): number {
  return plan === "pro" ? 1000 : 200;
}
