export const PUBLIC_VIEW_BASE = "https://pitstopiq.web.app";

export function buildViewLink(centerId: string, customerId: string): string {
  return `${PUBLIC_VIEW_BASE}/c/${centerId}/${customerId}`;
}

export const DEFAULT_COMPLETION_TEMPLATE =
  "Dear {CustomerName}, invoice {InvoiceNumber} for {Plate} is ready at {CenterName}. Services: {ServicesList}. Total: LKR {InvoiceTotal}. Next service: {NextServiceMileage}km. View & download: {ViewLink} — {CenterPhone}";

export const DEFAULT_REMINDER_TEMPLATE =
  "Dear {CustomerName}, your vehicle {Plate} is due for service at {CenterName}. Current km: {CurrentKm}km. Next service at: {NextServiceMileage}km. View history: {ViewLink} — {CenterPhone}";

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
