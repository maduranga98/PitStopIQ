import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../config/firebase";

// ── Short links for SMS ──────────────────────────────────────────────────────
// The customer self-service link is the single biggest chunk of a Sinhala/Tamil
// SMS: the full "/c/{centerId}/{customerId}" URL is ~70 characters, and in the
// UCS-2 encoding those messages use it can eat a whole extra segment. A short
// link maps a 7-character code back to the customer view, cutting ~50 characters.
//
// Host is the apex domain WITHOUT a scheme — phones auto-linkify a bare
// "pitstopiq.com/v/…", and the apex is 4 chars shorter than "app.pitstopiq.com".
// NOTE: the apex domain must be pointed at the same Firebase Hosting site that
// serves app.pitstopiq.com for these links to resolve.
export const SHORTLINK_HOST = "pitstopiq.com";
export const SHORTLINK_PATH = "/v/"; // resolver route registered in App.tsx

// Placeholder code (real length) so segment previews are accurate before a code
// has actually been minted.
export const SAMPLE_SHORT_CODE = "0000000";

const CODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const CODE_LENGTH = 7; // 62^7 ≈ 3.5e12 combinations — collisions are negligible

function randomCode(): string {
  const bytes = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

/** Scheme-less short link for embedding in an SMS body, e.g. pitstopiq.com/v/aB3xK9q */
export function smsShortLink(code: string): string {
  return `${SHORTLINK_HOST}${SHORTLINK_PATH}${code}`;
}

/** Full clickable short link (with scheme) for hrefs, clipboard and on-screen display. */
export function fullShortLink(code: string): string {
  return `https://${SHORTLINK_HOST}${SHORTLINK_PATH}${code}`;
}

/**
 * Return a stable short code for a customer, minting one on first use.
 * Reuses the code cached on the customer doc when present; otherwise creates a
 * `links/{code}` → { centerId, customerId } mapping and best-effort caches the
 * code back on the customer so later sends reuse it. Throws only if the mapping
 * cannot be written — callers should fall back to the long link.
 */
export async function getOrCreateShortLink(centerId: string, customerId: string): Promise<string> {
  const custRef = doc(db, "servicecenters", centerId, "customers", customerId);

  try {
    const snap = await getDoc(custRef);
    const existing = snap.exists() ? (snap.data().shortCode as string | undefined) : undefined;
    if (existing) return existing;
  } catch {
    // Reading the customer failed — fall through and try to mint anyway.
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const linkRef = doc(db, "links", code);
    const linkSnap = await getDoc(linkRef);
    if (linkSnap.exists()) continue; // astronomically unlikely collision — retry
    await setDoc(linkRef, { centerId, customerId, createdAt: serverTimestamp() });
    // Best-effort back-reference; ignored if the sender lacks customer-write access.
    updateDoc(custRef, { shortCode: code }).catch(() => {});
    return code;
  }
  throw new Error("Could not mint a short link");
}
