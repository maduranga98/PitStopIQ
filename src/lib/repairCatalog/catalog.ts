// Catalog-level helpers: categories, search, duplicates, edit conflicts. Pure.
import type { RepairItem } from "../../types/repairCatalog";
import { DEFAULT_REPAIR_CATEGORIES } from "../../constants/repairCatalog.ts";
import { collapseSpaces } from "./keys.ts";

const key = (s: string | null | undefined) => collapseSpaces(s).toLowerCase();

// ── Categories ───────────────────────────────────────────────────────────────

/**
 * The categories to offer, in the owner's order. A center that never set a list
 * sees the suggested defaults; any category a repair already uses (imported, or
 * left over from a rename elsewhere) is appended so it can still be filtered on.
 */
export function categoryList(stored: string[] | undefined, repairs: Pick<RepairItem, "category">[]): string[] {
  const base = (stored && stored.length > 0 ? stored : [...DEFAULT_REPAIR_CATEGORIES]).map(collapseSpaces).filter(Boolean);
  const seen = new Set(base.map(key));
  const extra: string[] = [];
  for (const r of repairs) {
    const c = collapseSpaces(r.category);
    if (c && !seen.has(key(c))) { seen.add(key(c)); extra.push(c); }
  }
  return [...base, ...extra.sort((a, b) => a.localeCompare(b))];
}

/** Add a category. Returns the new list, or an error when blank or already there. */
export function addCategory(list: string[], name: string): { list: string[] } | { error: string } {
  const n = collapseSpaces(name);
  if (!n) return { error: "Enter a name." };
  if (list.some((c) => key(c) === key(n))) return { error: `“${n}” already exists.` };
  return { list: [...list, n] };
}

/** Rename a category in the list. Errors when the new name collides with another one. */
export function renameCategory(list: string[], from: string, to: string): { list: string[] } | { error: string } {
  const n = collapseSpaces(to);
  if (!n) return { error: "Enter a name." };
  if (list.some((c) => key(c) === key(n) && key(c) !== key(from))) return { error: `“${n}” already exists.` };
  return { list: list.map((c) => (key(c) === key(from) ? n : c)) };
}

export function moveInList<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [m] = next.splice(from, 1);
  next.splice(to, 0, m);
  return next;
}

/** Repairs filed under a category (case-insensitive), for a rename cascade. */
export function repairsInCategory<T extends Pick<RepairItem, "category">>(repairs: T[], category: string): T[] {
  return repairs.filter((r) => key(r.category) === key(category));
}

// ── Search, filter, duplicates ───────────────────────────────────────────────

export interface RepairFilter { q?: string; category?: string; showInactive?: boolean }

export function filterRepairs(repairs: RepairItem[], f: RepairFilter): RepairItem[] {
  const words = key(f.q).split(" ").filter(Boolean);
  return repairs.filter((r) => {
    if (!f.showInactive && r.isActive === false) return false;
    if (f.category && key(r.category) !== key(f.category)) return false;
    if (words.length === 0) return true;
    const hay = `${r.name} ${r.description ?? ""} ${r.category ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Another repair with exactly this name (ignoring case and spacing) in the same category. */
export function findDuplicateRepair(
  repairs: Pick<RepairItem, "id" | "name" | "category">[],
  name: string,
  category: string | undefined,
  ignoreId?: string,
): Pick<RepairItem, "id" | "name" | "category"> | undefined {
  const n = key(name);
  if (!n) return undefined;
  return repairs.find((r) => r.id !== ignoreId && key(r.name) === n && key(r.category) === key(category));
}

/** "Brake pad replacement (copy)", "(copy 2)", ... unique within the category. */
export function copyName(
  repairs: Pick<RepairItem, "id" | "name" | "category">[],
  name: string,
  category: string | undefined,
): string {
  const base = collapseSpaces(name);
  let candidate = `${base} (copy)`;
  for (let i = 2; findDuplicateRepair(repairs, candidate, category); i++) candidate = `${base} (copy ${i})`;
  return candidate;
}

// ── Concurrent edits (best effort, no transactions) ──────────────────────────

/** Millis of a Firestore-ish timestamp, or null when there is none. */
export function stampMillis(t: unknown): number | null {
  if (!t) return null;
  const anyT = t as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
  if (typeof anyT.toMillis === "function") return anyT.toMillis();
  if (typeof anyT.seconds === "number") return anyT.seconds * 1000 + Math.floor((anyT.nanoseconds ?? 0) / 1e6);
  return null;
}

/**
 * Someone else saved this repair after the editor opened. Compares the
 * `updatedAt` seen when the sheet opened with the one on the document now.
 * Equality, not ordering: no clock comparison between devices is involved.
 */
export function detectEditConflict(openedAt: unknown, currentAt: unknown): boolean {
  return stampMillis(openedAt) !== stampMillis(currentAt);
}

const FIELD_LABELS: Record<string, string> = {
  name: "name", description: "description", category: "category", unit: "unit",
  estimatedMinutes: "estimated time", defaultPrice: "default price", priceOverrides: "price overrides",
  appliesTo: "applies to", suggestedParts: "suggested parts", isActive: "active state",
};

/** Human names of the editable fields that differ between two versions of a repair. */
export function changedFieldNames(a: Partial<RepairItem>, b: Partial<RepairItem>): string[] {
  const out: string[] = [];
  for (const [field, label] of Object.entries(FIELD_LABELS)) {
    const x = (a as Record<string, unknown>)[field] ?? null;
    const y = (b as Record<string, unknown>)[field] ?? null;
    if (JSON.stringify(x) !== JSON.stringify(y)) out.push(label);
  }
  return out;
}

/** "All vehicles", or "2 types · 1 group · 3 models". */
export function appliesSummary(a: RepairItem["appliesTo"] | undefined): string {
  if (!a) return "No vehicles";
  if (a.all) return "All vehicles";
  const parts: string[] = [];
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (a.types.length) parts.push(plural(a.types.length, "type"));
  if (a.groupIds.length) parts.push(plural(a.groupIds.length, "group"));
  if (a.modelIds.length) parts.push(plural(a.modelIds.length, "model"));
  return parts.length ? parts.join(" · ") : "No vehicles";
}
