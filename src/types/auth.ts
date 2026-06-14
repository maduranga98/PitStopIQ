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
}

export interface StaffMember {
  id: string;
  email: string;
  displayName?: string;
  role: UserRole;
  centerId: string;
  active: boolean;
  createdAt: Date;
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
  make?: string;
  model?: string;
  year?: number;
  currentMileageKm?: number;
  nextServiceMileageKm?: number;
  createdAt: Timestamp;
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
  phone: string;
  messageType: "Completion" | "Reminder";
  deliveryStatus: "sent" | "delivered" | "failed";
  message: string;
  sentAt: Timestamp;
}

export const SRI_LANKA_DISTRICTS = [
  "Ampara", "Anuradhapura", "Badulla", "Batticaloa", "Colombo",
  "Galle", "Gampaha", "Hambantota", "Jaffna", "Kalutara",
  "Kandy", "Kegalle", "Kilinochchi", "Kurunegala", "Mannar",
  "Matale", "Matara", "Monaragala", "Mullaitivu", "Nuwara Eliya",
  "Polonnaruwa", "Puttalam", "Ratnapura", "Trincomalee", "Vavuniya",
] as const;
