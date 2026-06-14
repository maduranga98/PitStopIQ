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

export const SRI_LANKA_DISTRICTS = [
  "Ampara", "Anuradhapura", "Badulla", "Batticaloa", "Colombo",
  "Galle", "Gampaha", "Hambantota", "Jaffna", "Kalutara",
  "Kandy", "Kegalle", "Kilinochchi", "Kurunegala", "Mannar",
  "Matale", "Matara", "Monaragala", "Mullaitivu", "Nuwara Eliya",
  "Polonnaruwa", "Puttalam", "Ratnapura", "Trincomalee", "Vavuniya",
] as const;
