// Writes for vehicle models and groups.
//
// Offline-first: only safeSetDoc / safeUpdateDoc / safeWriteBatch, no
// transactions. Duplicate checks run against the cached list the caller holds
// (the lists are small), and a new model's document id is derived from its
// normalised key, so two devices creating the same model offline write the SAME
// document instead of two.
import { arrayRemove, arrayUnion, collection, doc, Timestamp } from "firebase/firestore";
import { db } from "../../config/firebase";
import { safeSetDoc, safeUpdateDoc, safeWriteBatch } from "../firestoreWrite";
import { invalidateVehicleGroups, invalidateVehicleModels } from "./data";
import { collapseSpaces, modelIdForKey, normalizeModelKey } from "./keys.ts";
import { findDuplicateModel, nextGroupPriority } from "./models.ts";
import type { VehicleGroup, VehicleModel } from "../../types/repairCatalog";

const modelsCol = (centerId: string) => collection(db, "servicecenters", centerId, "vehicleModels");
const groupsCol = (centerId: string) => collection(db, "servicecenters", centerId, "vehicleGroups");

export interface ModelInput {
  make: string;
  model: string;
  vehicleType: string;
  notes?: string;
}

/**
 * `created`: a new model was written. `exists`: that make + model is already
 * on file, so the caller should OFFER it (and reactivate it if inactive)
 * rather than create a second one. Nothing is written in that case.
 */
export type CreateModelResult =
  | { status: "created"; model: VehicleModel }
  | { status: "exists"; model: VehicleModel };

export async function createVehicleModel(
  centerId: string,
  input: ModelInput,
  existing: VehicleModel[],
): Promise<CreateModelResult> {
  const make = collapseSpaces(input.make);
  const model = collapseSpaces(input.model);
  const dup = findDuplicateModel(existing, make, model);
  if (dup) return { status: "exists", model: dup };

  const key = normalizeModelKey(make, model);
  const now = Timestamp.now();
  const data = {
    make,
    model,
    vehicleType: collapseSpaces(input.vehicleType),
    key,
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    isActive: true,
    centerId,
    createdAt: now,
    updatedAt: now,
  };
  const id = modelIdForKey(key);
  await safeSetDoc(doc(modelsCol(centerId), id), data);
  return { status: "created", model: { id, ...data } as VehicleModel };
}

/** Edit a model. Renaming into another model's make + model reports that model instead. */
export async function updateVehicleModel(
  centerId: string,
  id: string,
  input: ModelInput,
  existing: VehicleModel[],
): Promise<{ status: "updated" } | { status: "exists"; model: VehicleModel }> {
  const make = collapseSpaces(input.make);
  const model = collapseSpaces(input.model);
  const dup = findDuplicateModel(existing, make, model, id);
  if (dup) return { status: "exists", model: dup };
  await safeUpdateDoc(doc(modelsCol(centerId), id), {
    make,
    model,
    vehicleType: collapseSpaces(input.vehicleType),
    key: normalizeModelKey(make, model),
    notes: input.notes?.trim() ?? "",
    updatedAt: Timestamp.now(),
  });
  return { status: "updated" };
}

/** Deactivate (or reactivate) a model. Models are never deleted: repairs and groups may point at them. */
export async function setVehicleModelActive(centerId: string, id: string, isActive: boolean): Promise<void> {
  await safeUpdateDoc(doc(modelsCol(centerId), id), { isActive, updatedAt: Timestamp.now() });
}

export interface GroupInput {
  name: string;
  types: string[];
  modelIds: string[];
  notes?: string;
}

export async function createVehicleGroup(
  centerId: string,
  input: GroupInput,
  existing: VehicleGroup[],
): Promise<string> {
  const ref = doc(groupsCol(centerId));
  const now = Timestamp.now();
  await safeSetDoc(ref, {
    name: collapseSpaces(input.name),
    types: input.types,
    modelIds: input.modelIds,
    priority: nextGroupPriority(existing),
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    isActive: true,
    centerId,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

export async function updateVehicleGroup(centerId: string, id: string, input: GroupInput): Promise<void> {
  await safeUpdateDoc(doc(groupsCol(centerId), id), {
    name: collapseSpaces(input.name),
    types: input.types,
    modelIds: input.modelIds,
    notes: input.notes?.trim() ?? "",
    updatedAt: Timestamp.now(),
  });
}

/** Groups are deactivated, not deleted: a repair's price override may point at one. */
export async function setVehicleGroupActive(centerId: string, id: string, isActive: boolean): Promise<void> {
  await safeUpdateDoc(doc(groupsCol(centerId), id), { isActive, updatedAt: Timestamp.now() });
}

/** Apply a priority renumbering (from `reorderPriorities`) in one batch. */
export async function saveGroupPriorities(
  centerId: string,
  changes: { id: string; priority: number }[],
): Promise<void> {
  if (changes.length === 0) return;
  const now = Timestamp.now();
  await safeWriteBatch(`vehicleGroups priority ${centerId}`, (batch) => {
    for (const c of changes) batch.update(doc(groupsCol(centerId), c.id), { priority: c.priority, updatedAt: now });
  });
  // A batch does not invalidate the cache by itself (see safeWriteBatch).
  invalidateVehicleGroups(centerId);
}

/**
 * Add models to, or remove them from, several groups at once. arrayUnion /
 * arrayRemove on plain id strings, so concurrent edits merge instead of
 * overwriting each other.
 */
export async function bulkAssignModels(
  centerId: string,
  groupIds: string[],
  modelIds: string[],
  mode: "add" | "remove",
): Promise<void> {
  if (groupIds.length === 0 || modelIds.length === 0) return;
  const now = Timestamp.now();
  await safeWriteBatch(`vehicleGroups bulk ${mode} ${centerId}`, (batch) => {
    for (const gid of groupIds) {
      batch.update(doc(groupsCol(centerId), gid), {
        modelIds: mode === "add" ? arrayUnion(...modelIds) : arrayRemove(...modelIds),
        updatedAt: now,
      });
    }
  });
  invalidateVehicleGroups(centerId);
}

/** Link one vehicle to a model the owner confirmed. Touches modelId (and updatedAt) only. */
export async function linkVehicleToModel(centerId: string, vehicleId: string, modelId: string): Promise<void> {
  await safeUpdateDoc(doc(db, "servicecenters", centerId, "vehicles", vehicleId), {
    modelId,
    updatedAt: Timestamp.now(),
  });
}

export { invalidateVehicleModels };
