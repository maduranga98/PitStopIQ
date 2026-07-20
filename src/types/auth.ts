import type { Timestamp } from "firebase/firestore";

export type UserRole = "Owner" | "Manager" | "Technician" | "Cashier" | "Receptionist";

export interface ServiceCenter {
  id: string;
  name: string;
  phone: string;
  address: string;
  district: string;
  logoUrl?: string;
  businessRegistrationNumber?: string;
  smsSenderName: string;
  reminderThresholdKm?: number;
  reminderCooldownDays: number;
  plan: "basic" | "pro";
  createdAt: Date;
  ownerId: string;
  // Multi-branch: the owner's Firebase Auth uid, shared across every branch
  // document that owner has (primary + additional branches).
  ownerUid: string;
  // false = primary branch (the one created at registration, centerId == uid).
  // true = an additional branch provisioned later by the super admin.
  isBranch: boolean;
  // The primary branch's centerId. null for the primary itself.
  primaryCenterId: string | null;
  // Friendly label for additional branches (falls back to `name` if unset).
  branchName?: string;
  // Monthly billing rate for this specific branch document:
  // 7999 primary-pro / 4999 primary-basic / 4000 additional branch.
  monthlyRate: number;
  // Soft-delete flag distinct from `status` (billing state). false = the
  // super admin has closed this branch; data is retained, billing stops.
  isActive: boolean;
  // Payment reference code (short unique code for bank transfers)
  paymentCode?: string;
  // Super admin managed fields
  // active: payment current; grace_period: overdue but within 7-day grace;
  // pending_payment: slip uploaded, awaiting verification; blocked: access cut off
  status: "active" | "grace_period" | "pending_payment" | "blocked";
  ownerName?: string;
  ownerPhone?: string;
  registeredByAdminId?: string;
  // Subscription period
  currentPeriodStart?: Timestamp;
  currentPeriodEnd?: Timestamp;
  graceDeadline?: Timestamp;
  lastPaymentVerifiedAt?: Timestamp;
  lastPaymentAmount?: number;
  // SMS quota
  smsQuotaUsed: number;
  smsQuotaLimit: number; // 200 basic / 1000 pro
  // SMS templates (stored as strings; undefined = use default)
  completionSmsTemplate?: string;
  reminderSmsTemplate?: string;
  // Inspection module (Pro only, off by default)
  inspectionEnabled?: boolean;
  // Multi-user settings (Pro only)
  multiUser?: boolean;
  maxStaff?: number;
  // Account deletion
  isDeleted?: boolean;
  deletionScheduledAt?: Timestamp;
}

export interface SuperAdmin {
  id: string;
  email: string;
  displayName: string;
  createdAt: Timestamp;
}

export type PaymentStatus = "pending" | "paid";
export type PaymentPeriod = "monthly" | "yearly";

export interface ServiceCenterPayment {
  id: string;
  centerId: string;
  amount: number;
  plan: "basic" | "pro";
  period: PaymentPeriod;
  status: PaymentStatus;
  paidAt?: Timestamp;
  markedBy: string; // super admin uid
  markedByName: string;
  notes?: string;
  upgradeRequestId?: string;
  createdAt: Timestamp;
}

export type UpgradeRequestStatus = "pending" | "approved" | "rejected";
export type PaymentSlipRequestStatus = "pending" | "confirmed" | "rejected";

export interface PaymentSlipRequest {
  id: string;
  centerId: string;
  centerName: string;
  paymentCode: string;
  plan: "basic" | "pro";
  period: PaymentPeriod;
  amount: number;
  slipUrl: string;
  status: PaymentSlipRequestStatus;
  notes?: string;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
  reviewedByName?: string;
  createdAt: Timestamp;
}

export interface UpgradeRequest {
  id: string;
  centerId: string;
  centerName: string;
  paymentCode: string;
  requestedPlan: "pro";
  period: PaymentPeriod;
  amount: number;
  slipUrl: string;
  status: UpgradeRequestStatus;
  notes?: string;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
  reviewedByName?: string;
  createdAt: Timestamp;
}

export interface StaffMember {
  id: string;
  email: string;
  displayName?: string;
  fullName: string;
  phone: string;
  role: UserRole;
  centerId: string;
  active: boolean;
  createdAt: Timestamp;
  lastLoginAt?: Timestamp;
  employeeId?: string;
  dateJoined?: Timestamp;
  notes?: string;
  inviteSent?: boolean;
  hasLogin?: boolean;
  authUid?: string;
  loginPhone?: string;
}

export type AttendanceStatus = "present" | "absent" | "half_day" | "holiday";

export interface AttendanceMonth {
  days: Record<string, AttendanceStatus>; // key = "YYYY-MM-DD"
}

export interface PendingInvite {
  id: string;
  email: string;
  role: UserRole;
  centerId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  createdBy: string;
}

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  centerId?: string;
  role?: UserRole;
  centerPlan?: "basic" | "pro";
}

export type SmsLanguage = "sinhala" | "tamil" | "english";

export interface Customer {
  id: string;
  name: string;
  phone: string;
  nic?: string;
  notes?: string;
  smsLanguage?: SmsLanguage;
  isDeleted: boolean;
  vehicleCount: number;
  lastServiceDate: Timestamp | null;
  createdAt: Timestamp;
  centerId: string;
}

// Built-in categories; centers can also add their own custom categories,
// so vehicleType is stored as a plain string.
export type VehicleType = string;

export type ServiceLibraryCategory =
  | "Engine"
  | "Brakes"
  | "Tyres"
  | "Suspension"
  | "Electrical"
  | "Body"
  | "AC"
  | "General"
  | "Other";

export type ServiceLibraryUnit =
  | "per service"
  | "per litre"
  | "per item"
  | "per hour";

export interface ServicePriceItem {
  id: string;
  name: string;
  description?: string;
  category?: ServiceLibraryCategory;
  defaultPrice: number;
  /** @deprecated Use defaultPrice */
  price?: number;
  unit?: ServiceLibraryUnit;
  isActive?: boolean;
  centerId: string;
  createdAt: Timestamp;
}

export interface Vehicle {
  id: string;
  plateNumber: string;
  customerId: string;
  customerName: string;
  make?: string;
  model?: string;
  year?: number;
  vehicleType?: VehicleType;
  colour?: string;
  currentMileageKm: number;
  nextServiceMileageKm: number;
  oilBrand?: string;
  oilGrade?: string;
  oilViscosityNotes?: string;
  qrCodeUrl?: string;
  photoUrls?: string[];
  centerId: string;
  isDeleted: boolean;
  lastServiceDate?: Timestamp | null;
  // Time-based reminder scheduling (derived once a vehicle is serviced twice)
  serviceIntervalDays?: number;
  nextServiceDate?: Timestamp | null;
  reminderSent?: boolean;
  reminderSentAt?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface ServiceRecord {
  id: string;
  vehicleId: string;
  plateNumber: string;
  customerId: string;
  serviceType: string;
  status: "pending" | "in_progress" | "done" | "delivered";
  technicianName?: string;
  totalAmount?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SmsLog {
  id: string;
  customerId: string;
  customerName: string;
  phone: string;
  vehicleId?: string;
  plateNumber?: string;
  jobId?: string;
  messageType: "Completion" | "Reminder";
  status: "sent" | "delivered" | "failed" | "pending_blackout";
  message: string;
  sentAt: Timestamp;
  errorCode?: string;
  errorMessage?: string;
  providerResponse?: unknown;
  deliveredAt?: Timestamp;
  senderMask?: string;
  /** Optional sender mask override, checked against an approved allowlist server-side. */
  mask?: string;
  esmsTransactionId?: number;
  esmsCampaignId?: string | null;
}

export interface PartUsed {
  itemId: string;
  itemName: string;
  quantity: number;
  unitCost?: number;
}

export interface RestockEntry {
  addedQty: number;
  addedBy: string;
  timestamp: Timestamp;
  note?: string;
}

export interface DeductionEntry {
  serviceId: string;
  vehicleId: string;
  date: Timestamp;
  qtyDeducted: number;
  remainingQty: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: "Lubricants" | "Filters" | "Brake Parts" | "Tyres" | "Electrical" | "Consumables" | "Other";
  unit: "Litres" | "Pieces" | "Kits" | "Sets" | "Metres" | "Pairs" | "Packets";
  currentQty: number;
  threshold: number;
  unitCost?: number;
  supplierName?: string;
  supplierPhone?: string;
  notes?: string;
  isArchived?: boolean;
  restockLog?: RestockEntry[];
  deductionLog?: DeductionEntry[];
  centerId: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface ServiceJob {
  id: string;
  jobNumber: string;
  vehicleId: string;
  plateNumber: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  make: string;
  model: string;
  year: number;
  mileageIn: number;
  mileageOut?: number;
  nextServiceMileageKm?: number;
  oilBrand?: string;
  oilGrade?: string;
  oilViscosityNotes?: string;
  technicianId: string;
  technicianName: string;
  services: string[];
  customServices: string[];
  internalNotes?: string;
  status: "pending" | "in_progress" | "done" | "delivered";
  partsUsed: PartUsed[];
  smsSent: boolean;
  startedAt?: Timestamp;
  completedAt?: Timestamp;
  deliveredAt?: Timestamp;
  centerId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface InvoiceLineItem {
  description: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export type InvoiceStatus = "pending" | "partial" | "paid";
export type DiscountType = "amount" | "percent";

export interface Invoice {
  id: string;
  invoiceNumber: string;
  serviceId?: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  vehicleId: string;
  plateNumber: string;
  serviceDate: Timestamp;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  discount: number;
  discountType: DiscountType;
  tax: number;
  grandTotal: number;
  status: InvoiceStatus;
  paidAmount: number;
  balanceDue: number;
  pdfUrl?: string;
  pdfGeneratedAt?: Timestamp;
  centerId: string;
  finalized?: boolean;
  finalizedAt?: Timestamp;
  smsSent?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ── Vehicle Inspection (Pro only) ────────────────────────────────────────────

export type FuelLevel = "empty" | "quarter" | "half" | "three_quarter" | "full";
export type OverallCondition = "good" | "minor_damage" | "major_damage";
export type ChecklistStatus = "ok" | "needs_attention" | "damaged";

export interface ChecklistItem {
  item: string;
  status: ChecklistStatus;
}

export interface DamageReport {
  id: string;
  location: string;
  description: string;
  photoUrl: string | null;
  photoDeleteAt: Timestamp;
  photosDeleted: boolean;
}

export interface VehicleInspection {
  conductedBy: string;
  completedAt: Timestamp;
  fuelLevel: FuelLevel;
  odometerReading: number;
  overallCondition: OverallCondition;
  checklistItems: ChecklistItem[];
  damageReports: DamageReport[];
  notes: string | null;
  skipped: boolean;
  nextPhotoDeleteAt?: Timestamp;
  photosDeleted?: boolean;
}

export const INSPECTION_CHECKLIST_ITEMS = [
  "Front Left Tyre",
  "Front Right Tyre",
  "Rear Left Tyre",
  "Rear Right Tyre",
  "Windscreen",
  "Front Bumper",
  "Rear Bumper",
  "Left Side Panels",
  "Right Side Panels",
  "Front Lights",
  "Rear Lights",
  "Left Mirror",
  "Right Mirror",
  "Interior / Seats",
  "Dashboard",
] as const;

export const SRI_LANKA_DISTRICTS = [
  "Ampara", "Anuradhapura", "Badulla", "Batticaloa", "Colombo",
  "Galle", "Gampaha", "Hambantota", "Jaffna", "Kalutara",
  "Kandy", "Kegalle", "Kilinochchi", "Kurunegala", "Mannar",
  "Matale", "Matara", "Monaragala", "Mullaitivu", "Nuwara Eliya",
  "Polonnaruwa", "Puttalam", "Ratnapura", "Trincomalee", "Vavuniya",
] as const;
