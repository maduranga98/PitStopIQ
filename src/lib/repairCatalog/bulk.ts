// Bulk inventory actions: previews, chunking and a retry-safe runner. Pure.
//
// No transactions anywhere. Every write sets a field to a fixed value (the
// compatibility object) or merges a part into one repair, so running a chunk
// twice leaves the same result as running it once. A failed run can simply be
// started again, from the first chunk or from where it stopped.
import type { InventoryCompatibility, RepairItem, RepairSuggestedPart } from "../../types/repairCatalog";
import { addPartLink } from "./partLinks.ts";
import { compatibilityEquals, normalizeCompatibility, type CompatItem } from "./compatibility.ts";

/** Writes per Firestore batch. The hard limit is 500; this leaves headroom. */
export const WRITE_CHUNK = 400;

export function chunk<T>(list: T[], size = WRITE_CHUNK): T[][] {
  if (size < 1) throw new Error("chunk size must be at least 1");
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export interface BulkProgress { done: number; total: number }
export interface BulkResult extends BulkProgress {
  /** Index of the chunk that failed, or null when every chunk was written. */
  failedAt: number | null;
  error?: unknown;
}

/**
 * Write chunk by chunk, reporting progress after each. Stops at the first
 * failure and says where, so "Retry" can pass that index as `startAt`
 * (re-running earlier chunks would also be safe, just wasteful).
 */
export async function runChunked<T>(
  chunks: T[][],
  write: (chunk: T[], index: number) => Promise<void>,
  opts: { startAt?: number; onProgress?: (p: BulkProgress) => void } = {},
): Promise<BulkResult> {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  let done = chunks.slice(0, opts.startAt ?? 0).reduce((n, c) => n + c.length, 0);
  opts.onProgress?.({ done, total });
  for (let i = opts.startAt ?? 0; i < chunks.length; i++) {
    try {
      await write(chunks[i], i);
    } catch (error) {
      return { done, total, failedAt: i, error };
    }
    done += chunks[i].length;
    opts.onProgress?.({ done, total });
  }
  return { done, total, failedAt: null };
}

// ── Set compatibility ────────────────────────────────────────────────────────

export interface CompatPlan<T> {
  /** Items whose stored compatibility differs from the new value. */
  toChange: T[];
  /** Items already holding exactly this value: skipped, not rewritten. */
  unchanged: T[];
  /** Of `toChange`, how many are currently unclassified. */
  fromUnclassified: number;
}

export function planSetCompatibility<T extends CompatItem>(items: T[], target: InventoryCompatibility): CompatPlan<T> {
  const toChange: T[] = [];
  const unchanged: T[] = [];
  let fromUnclassified = 0;
  for (const i of items) {
    const current = normalizeCompatibility(i.compatibility);
    if (compatibilityEquals(current, target)) unchanged.push(i);
    else { toChange.push(i); if (!current) fromUnclassified++; }
  }
  return { toChange, unchanged, fromUnclassified };
}

// ── Link to a repair ─────────────────────────────────────────────────────────

export interface LinkPlan<T> {
  /** Items that will be added, each at the default quantity. */
  toAdd: T[];
  /** Items the repair already lists: left exactly as they are (quantity and overrides kept). */
  alreadyLinked: T[];
  /** The repair's full part list after the change. */
  nextParts: RepairSuggestedPart[];
}

export function planLinkToRepair<T extends { id: string }>(
  items: T[], repair: Pick<RepairItem, "suggestedParts">, defaultQty: number,
): LinkPlan<T> {
  const current = repair.suggestedParts ?? [];
  const toAdd: T[] = [];
  const alreadyLinked: T[] = [];
  let nextParts = current;
  for (const i of items) {
    const next = addPartLink(nextParts, i.id, defaultQty);
    if (next === nextParts) alreadyLinked.push(i);
    else { toAdd.push(i); nextParts = next; }
  }
  return { toAdd, alreadyLinked, nextParts };
}
