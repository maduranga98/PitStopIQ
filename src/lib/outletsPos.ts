import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../config/firebase";
import { SHORTLINK_HOST } from "./shortLinks";

// ── POS terminal share links ────────────────────────────────────────────────
// The real POS — the register that rings up a sale and moves stock — lives on
// its own device at the counter and carries no staff login. The owner shares a
// link carrying the center id, the outlet id and a secret token; the terminal
// page and the callables behind it refuse to work unless the token matches the
// one stored on the outlet. Regenerating the token is how a lost or leaked
// link gets revoked, exactly like a distributor's portal link.

const TOKEN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const TOKEN_LENGTH = 24;
const SHORT_CODE_LENGTH = 7;

function randomString(length: number): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  return out;
}

export function generatePosToken(): string {
  return randomString(TOKEN_LENGTH);
}

export function posTerminalPath(centerId: string, outletId: string, token: string): string {
  return `/pos-terminal/${centerId}/${outletId}/${token}`;
}

export function posTerminalUrl(centerId: string, outletId: string, token: string): string {
  return `https://${SHORTLINK_HOST}${posTerminalPath(centerId, outletId, token)}`;
}

export function shortPosTerminalUrl(code: string): string {
  return `https://${SHORTLINK_HOST}/v/${code}`;
}

/**
 * Mint a `links/{code}` mapping for a POS terminal link, mirroring
 * mintDistributorShortLink. Link documents are immutable, so a regenerated
 * token always gets a fresh code. Returns null when the mapping can't be
 * written; callers fall back to the long link.
 */
export async function mintPosShortLink(
  centerId: string,
  outletId: string,
  token: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomString(SHORT_CODE_LENGTH);
    try {
      const linkRef = doc(db, "links", code);
      const existing = await getDoc(linkRef);
      if (existing.exists()) continue; // astronomically unlikely — retry
      await setDoc(linkRef, {
        type: "pos",
        centerId,
        outletId,
        token,
        createdAt: serverTimestamp(),
      });
      return code;
    } catch {
      return null;
    }
  }
  return null;
}
