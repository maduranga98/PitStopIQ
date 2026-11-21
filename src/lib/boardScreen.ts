import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../config/firebase";
import { generatePosToken } from "./outletsPos";
import { SHORTLINK_HOST } from "./shortLinks";

// ── Shared Kanban board screen ──────────────────────────────────────────────
// A workshop may put the service board on a separate monitor (with a mouse) so
// technicians never need a phone on the floor. The screen carries no staff
// login: its URL holds a secret token, checked by the getBoardScreen callable.
// The token and the owner's on/off switch live in
// servicecenters/{c}/settings/boardScreen — NOT on the center doc, which anyone
// can read. Regenerating the token revokes a lost or leaked link.

export interface BoardScreenSettings {
  enabled: boolean;
  token: string;
}

export function boardScreenRef(centerId: string) {
  return doc(db, "servicecenters", centerId, "settings", "boardScreen");
}

export function boardScreenPath(centerId: string, token: string): string {
  return `/board/${centerId}/${token}`;
}

export function boardScreenUrl(centerId: string, token: string): string {
  return `https://${SHORTLINK_HOST}${boardScreenPath(centerId, token)}`;
}

/** Switch sharing on/off. The first switch-on mints the token; later ones keep it. */
export function setBoardScreenEnabled(centerId: string, enabled: boolean, existingToken?: string) {
  return setDoc(
    boardScreenRef(centerId),
    {
      enabled,
      token: existingToken || generatePosToken(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/** Mint a fresh token — the old link stops working immediately. */
export function regenerateBoardScreenToken(centerId: string) {
  return setDoc(
    boardScreenRef(centerId),
    { token: generatePosToken(), updatedAt: serverTimestamp() },
    { merge: true },
  );
}
