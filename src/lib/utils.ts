import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Normalize a phone number to bare local digits so search works regardless
 * of how the number was typed or stored.
 * "+94771234567", "0771234567" and "77 123 4567" all normalize to "0771234567".
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  // "0094…" international dialing prefix → local
  if (digits.startsWith("0094") && digits.length === 13) return "0" + digits.slice(4);
  // Sri Lankan international format 94XXXXXXXXX → local 0XXXXXXXXX
  if (digits.startsWith("94") && digits.length === 11) return "0" + digits.slice(2);
  return digits;
}

/**
 * True when the search query matches the stored phone number, tolerating
 * leading 0 / +94 differences on either side.
 */
export function phoneMatches(storedPhone: string, query: string): boolean {
  const q = query.replace(/\D/g, "");
  if (!q) return false;
  const stored = storedPhone.replace(/\D/g, "");
  return stored.includes(q) || normalizePhone(storedPhone).includes(normalizePhone(query));
}
