import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../config/firebase";
import { normaliseLocalPhone, isMobileLocalPhone } from "../lib/phone";

export type PhoneAvailabilityReason =
  | "invalid"
  | "not-mobile"
  | "owner-of-this-center"
  | "center-owner-phone"
  | "another-account"
  | "taken";

export interface PhoneAvailability {
  /** null while unknown (empty, still checking, or the check failed). */
  available: boolean | null;
  reason: PhoneAvailabilityReason | null;
  checking: boolean;
  /** Ready-to-show message, or "" when there's nothing to say. */
  message: string;
}

const MESSAGES: Record<PhoneAvailabilityReason, string> = {
  "invalid": "Enter a valid Sri Lankan mobile number (07XXXXXXXX).",
  "not-mobile": "This is not a mobile number. A mobile is required — the login credentials are sent there by SMS.",
  "owner-of-this-center":
    "This is the service center owner's own login number. Using it here would take over the owner's account — enter a different mobile for this staff member.",
  "center-owner-phone": "This mobile number is already registered as a service center owner.",
  "another-account": "This mobile number already belongs to another account.",
  "taken": "This mobile number is already registered.",
};

interface RemoteResult {
  /** Which input this answer belongs to; a mismatch means it's stale. */
  key: string;
  available: boolean | null;
  reason: PhoneAvailabilityReason | null;
}

const IDLE: PhoneAvailability = { available: null, reason: null, checking: false, message: "" };

function verdict(available: boolean | null, reason: PhoneAvailabilityReason | null): PhoneAvailability {
  return {
    available,
    reason,
    checking: false,
    message: available === false && reason ? MESSAGES[reason] : "",
  };
}

/**
 * Live "is this mobile free?" check for the registration forms, debounced so it
 * fires once the user stops typing rather than on every keystroke.
 *
 * Shape problems (not a number, not a mobile) are decided locally and shown
 * instantly. Only a well-formed mobile costs a round trip.
 *
 * This is a courtesy check for the UI — the callables it fronts enforce the
 * same rules server-side, so a stale or skipped result can never let a bad
 * number through. When the check itself fails (offline, not deployed) it
 * reports unknown rather than blocking the form.
 */
export function usePhoneAvailability(
  phone: string,
  opts: { centerId?: string; staffId?: string; enabled?: boolean } = {},
): PhoneAvailability {
  const { centerId, staffId, enabled = true } = opts;
  const [result, setResult] = useState<RemoteResult | null>(null);

  const trimmed = phone.trim();
  const local = normaliseLocalPhone(phone);
  const needsServer = enabled && trimmed !== "" && local !== null && isMobileLocalPhone(local);
  const key = `${local ?? trimmed}|${centerId ?? ""}|${staffId ?? ""}`;

  // An answer only counts when it was computed for exactly this input.
  const fresh = result && result.key === key ? result : null;
  const hasFresh = fresh !== null;

  useEffect(() => {
    if (!needsServer || hasFresh) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const fn = httpsCallable<
          { phone: string; centerId?: string; staffId?: string },
          { available: boolean; reason: PhoneAvailabilityReason | null }
        >(functions, "checkPhoneAvailability");
        const { data } = await fn({ phone, centerId, staffId });
        if (!cancelled) setResult({ key, available: data.available, reason: data.reason });
      } catch {
        // Unknown, not unavailable — never block the form on our own outage.
        if (!cancelled) setResult({ key, available: null, reason: null });
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, needsServer, hasFresh, phone, centerId, staffId]);

  if (!enabled || trimmed === "") return IDLE;
  if (local === null) return verdict(false, "invalid");
  if (!isMobileLocalPhone(local)) return verdict(false, "not-mobile");
  if (fresh) return verdict(fresh.available, fresh.reason);
  return { available: null, reason: null, checking: true, message: "" };
}
