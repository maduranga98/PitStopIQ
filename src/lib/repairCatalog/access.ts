import type { UserRole } from "../../types/auth";

/**
 * Roles firestore.rules lets read `inventory` (Owner, Manager, Cashier,
 * Technician). The Receptionist cannot, so anything that lists parts or stock
 * is hidden for them rather than allowed to fail.
 */
export function canReadInventory(role: UserRole | undefined): boolean {
  return role === "Owner" || role === "Manager" || role === "Cashier" || role === "Technician";
}
