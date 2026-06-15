import type { Timestamp } from "firebase/firestore";

export type UserRole = "Owner" | "Manager" | "Technician" | "Cashier" | "Receptionist";

export interface ServiceCenter {
  id: string;
  name: string;
  phone: string;
  address: string;
  district: string;
  logoUrl?: string;
  smsSenderName: string;
  reminderThresholdKm: number;
  reminderCooldownDays: number;
  plan: "basic" | "pro";
  trialEndsAt: Date;
  createdAt: Date;
  ownerId: string;
  // SMS quota
  smsQuotaUsed: number;
  smsQuotaLimit: number; // 200 basic / 1000 pro
  // SMS templates (stored as strings; undefined = use default)
  completionSmsTemplate?: string;
  reminderSmsTemplate?: string;
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
  employeeId?: string;
  dateJoined?: Timestamp;
  notes?: string;
  inviteSent?: boolean;
  branchIds?: string[];
}

export interface Branch {
  id: string;
  name: string;
  address: string;
  phone: string;
  smsSenderName?: string;
  district?: string;
  reminderThresholdKm?: number;
  active: boolean;
  createdAt: Timestamp;
}

export interface VehicleTransferLog {
  fromBranchId: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchName: string;
  transferredBy: string;
  transferredAt: Timestamp;
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
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  nic?: string;
  notes?: string;
  isDeleted: boolean;
  vehicleCount: number;
  lastServiceDate: Timestamp | null;
  createdAt: Timestamp;
  centerId: string;
}

export interface Vehicle {
  id: string;
  plateNumber: string;
  customerId: string;
  customerName: string;
  make: string;
  model: string;
  year: number;
  colour?: string;
  currentMileageKm: number;
  nextServiceMileageKm: number;
  oilBrand?: string;
  oilGrade?: string;
  oilViscosityNotes?: string;
  qrCodeUrl?: string;
  photoUrls?: string[];
  centerId: string;
  branchId?: string;
  isDeleted: boolean;
  lastServiceDate?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
  transferLog?: VehicleTransferLog[];
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
  deliveryStatus: "sent" | "delivered" | "failed";
  message: string;
  sentAt: Timestamp;
  errorCode?: string;
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
  serviceId: string;
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
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const SRI_LANKA_DISTRICTS = [
  "Ampara", "Anuradhapura", "Badulla", "Batticaloa", "Colombo",
  "Galle", "Gampaha", "Hambantota", "Jaffna", "Kalutara",
  "Kandy", "Kegalle", "Kilinochchi", "Kurunegala", "Mannar",
  "Matale", "Matara", "Monaragala", "Mullaitivu", "Nuwara Eliya",
  "Polonnaruwa", "Puttalam", "Ratnapura", "Trincomalee", "Vavuniya",
] as const;
