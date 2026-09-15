import { useEffect, useMemo, useState } from "react";
import { collection, query, where } from "firebase/firestore";
import { watchQuery } from "../lib/listeners";
import { db } from "../config/firebase";

/**
 * The "somebody is waiting on you" counts the sidebar puts a dot on.
 *
 * A booking request and a complaint both arrive from the customer's portal
 * while nobody is looking at the page they land on, so without a mark in the
 * sidebar they sit unanswered until somebody happens to open the tab. Both
 * queues already have a state that means untouched — a booking is `requested`
 * until staff confirm or reject it, feedback is `new` until it is reviewed —
 * so that is what is counted, rather than a separate read/unread flag nobody
 * would maintain.
 *
 * Keyed by the nav item's own path so the sidebar can look a count up without
 * knowing where it came from.
 */

export const NAV_BADGE_PATHS = {
  bookings: "/bookings",
  feedback: "/customers/feedback",
} as const;

export interface NavBadgeOptions {
  /** Subscribe to pending booking requests (only when the item is visible). */
  bookings?: boolean;
  /** Subscribe to new complaints & suggestions. */
  feedback?: boolean;
}

/** Nothing pending — a stable object, so an idle sidebar doesn't re-render. */
const NO_BADGES: Record<string, number> = {};

export function useNavBadges(
  centerId: string | undefined,
  options: NavBadgeOptions,
): Record<string, number> {
  const wantBookings = options.bookings === true;
  const wantFeedback = options.feedback === true;
  const [bookings, setBookings] = useState(0);
  const [feedback, setFeedback] = useState(0);

  useEffect(() => {
    if (!centerId || !wantBookings) return;
    // Equality-only, so no composite index and only the untouched requests
    // are ever fetched — never the center's whole booking history.
    return watchQuery(
      query(
        collection(db, "servicecenters", centerId, "bookings"),
        where("status", "==", "requested"),
      ),
      (snap) => setBookings(snap.size), () => setBookings(0));
  }, [centerId, wantBookings]);

  useEffect(() => {
    if (!centerId || !wantFeedback) return;
    return watchQuery(
      query(
        collection(db, "servicecenters", centerId, "customerFeedback"),
        where("status", "==", "new"),
      ),
      (snap) => setFeedback(snap.size), () => setFeedback(0));
  }, [centerId, wantFeedback]);

  const pendingBookings = wantBookings ? bookings : 0;
  const newFeedback = wantFeedback ? feedback : 0;
  return useMemo(() => {
    if (pendingBookings === 0 && newFeedback === 0) return NO_BADGES;
    return {
      ...(pendingBookings > 0 ? { [NAV_BADGE_PATHS.bookings]: pendingBookings } : {}),
      ...(newFeedback > 0 ? { [NAV_BADGE_PATHS.feedback]: newFeedback } : {}),
    };
  }, [pendingBookings, newFeedback]);
}

export default useNavBadges;
