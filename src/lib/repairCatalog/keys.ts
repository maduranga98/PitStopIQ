// Normalised keys for vehicle models and types.
//
// "Honda  Dio", " honda dio" and "HONDA DIO" are one model. The key is what
// duplicate detection compares, and (hashed) what a new model's document id is
// built from, so two devices creating the same model offline converge on ONE
// document instead of writing two.

/** Trim and collapse any run of whitespace to one space. */
export function collapseSpaces(s: string | null | undefined): string {
  return (s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** Case-insensitive, whitespace-insensitive key for a vehicle type. */
export function normalizeTypeKey(type: string | null | undefined): string {
  return collapseSpaces(type).toLowerCase();
}

/** The key for a model: make + model, trimmed, lowercased, spaces collapsed. */
export function normalizeModelKey(
  make: string | null | undefined,
  model: string | null | undefined,
): string {
  return collapseSpaces(`${collapseSpaces(make)} ${collapseSpaces(model)}`).toLowerCase();
}

/** cyrb53: a small, fast, well-distributed 53-bit string hash. */
function cyrb53(str: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Deterministic document id for a model key. Created offline on two tablets,
 * the same model lands on the same document. The stored `key` field, not the
 * id, is what duplicate detection trusts (a renamed model keeps its old id).
 */
export function modelIdForKey(key: string): string {
  return `m_${cyrb53(key).toString(36)}`;
}

/** "Honda Dio": how a model reads in lists and pickers. */
export function modelLabel(m: { make: string; model: string }): string {
  return collapseSpaces(`${m.make} ${m.model}`);
}
