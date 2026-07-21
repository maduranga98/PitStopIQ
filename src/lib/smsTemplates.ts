export const PUBLIC_VIEW_BASE = "https://app.pitstopiq.com";

export function buildViewLink(centerId: string, customerId: string): string {
  return `${PUBLIC_VIEW_BASE}/c/${centerId}/${customerId}`;
}

export const DEFAULT_COMPLETION_TEMPLATE =
  "Hi {CustomerName}, your vehicle {Plate} is ready!\n\nServices: {ServicesList}\nTotal: LKR {InvoiceTotal}\nNext service: {NextServiceMileage} km\n\nView your service history & invoice:\n{ViewLink}\n\n— {CenterName}";

export const DEFAULT_REMINDER_TEMPLATE =
  "Hi {CustomerName}, your vehicle {Plate} is due for a service soon!\n\nCurrent: {CurrentKm} km | Next service: {NextServiceMileage} km\n\nView your service history:\n{ViewLink}\n\n— {CenterName}";

// ── Multi-language defaults ──────────────────────────────────────────────────
// The SMS sent to a customer uses the template for that customer's preferred
// language (Customer.smsLanguage). Owners can customise each language in
// Settings → SMS; if left blank the defaults below are used.
export type SmsLang = "english" | "sinhala" | "tamil";

export const DEFAULT_COMPLETION_TEMPLATES: Record<SmsLang, string> = {
  english: DEFAULT_COMPLETION_TEMPLATE,
  sinhala:
    "ආයුබෝවන් {CustomerName}, ඔබගේ වාහනය {Plate} සූදානම්!\n\nසේවා: {ServicesList}\nඑකතුව: රු. {InvoiceTotal}\nඊළඟ සේවාව: {NextServiceMileage} km\n\nසේවා ඉතිහාසය හා බිල්පත බලන්න:\n{ViewLink}\n\n— {CenterName}",
  tamil:
    "வணக்கம் {CustomerName}, உங்கள் வாகனம் {Plate} தயாராக உள்ளது!\n\nசேவைகள்: {ServicesList}\nமொத்தம்: ரூ. {InvoiceTotal}\nஅடுத்த சேவை: {NextServiceMileage} km\n\nசேவை வரலாறு & பில்லைப் பார்க்க:\n{ViewLink}\n\n— {CenterName}",
};

export const DEFAULT_REMINDER_TEMPLATES: Record<SmsLang, string> = {
  english: DEFAULT_REMINDER_TEMPLATE,
  sinhala:
    "ආයුබෝවන් {CustomerName}, ඔබගේ වාහනය {Plate} ඉක්මනින් සේවාවට නියමිතයි!\n\nවර්තමාන: {CurrentKm} km | ඊළඟ සේවාව: {NextServiceMileage} km\n\nසේවා ඉතිහාසය බලන්න:\n{ViewLink}\n\n— {CenterName}",
  tamil:
    "வணக்கம் {CustomerName}, உங்கள் வாகனம் {Plate} விரைவில் சேவைக்கு உரியது!\n\nதற்போதைய: {CurrentKm} km | அடுத்த சேவை: {NextServiceMileage} km\n\nசேவை வரலாற்றைப் பார்க்க:\n{ViewLink}\n\n— {CenterName}",
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

export function smsCredits(length: number): number {
  if (length <= 160) return 1;
  if (length <= 320) return 2;
  return Math.ceil(length / 153);
}

export const SAMPLE_COMPLETION: CompletionData = {
  customerName: "Ashan Perera",
  plate: "ABC-1234",
  centerName: "Silva Auto Care",
  centerPhone: "+94771234567",
  servicesList: "Oil Change, Air Filter, Brake Inspection",
  mileageOut: "52500",
  nextServiceMileage: "57500",
};

export const SAMPLE_REMINDER: ReminderData = {
  customerName: "Ashan Perera",
  plate: "ABC-1234",
  centerName: "Silva Auto Care",
  centerPhone: "+94771234567",
  currentKm: "56800",
  nextServiceMileage: "57500",
};

export function smsQuotaLimit(plan: "basic" | "pro"): number {
  return plan === "pro" ? 1000 : 200;
}
