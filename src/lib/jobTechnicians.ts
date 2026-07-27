import type { ServiceJob, StaffMember } from "../types/auth";

/** The shape these helpers need — a full ServiceJob, or any subset of a job
 *  document that carries the technician fields (reports read narrower types). */
export interface TechnicianIdFields {
  technicianId?: string;
  technicianIds?: string[];
}

export interface TechnicianNameFields {
  technicianName?: string;
  technicianNames?: string[];
}

// A job card can carry a crew. One car in a bay is often three people's work —
// the mechanic, whoever did the wash, whoever regassed the AC — and each of
// them needs the job to show up in their own list.
//
// The crew lives in `technicianIds` / `technicianNames`; `technicianId` and
// `technicianName` mirror the first entry. Every job saved before crews existed
// has only the singular pair, so read through these helpers rather than the
// fields directly and both shapes behave the same.

/** The staff ids on a job, oldest shape included. Never contains blanks. */
export function jobTechnicianIds(
  job: TechnicianIdFields | null | undefined,
): string[] {
  if (!job) return [];
  const list = job.technicianIds?.filter(Boolean) ?? [];
  if (list.length > 0) return list;
  return job.technicianId ? [job.technicianId] : [];
}

/** The technician names on a job, in the order they were assigned. */
export function jobTechnicianNames(
  job: TechnicianNameFields | null | undefined,
): string[] {
  if (!job) return [];
  const list = job.technicianNames?.filter(Boolean) ?? [];
  if (list.length > 0) return list;
  return job.technicianName ? [job.technicianName] : [];
}

/** "Nuwan, Kasun +1" — the crew in the space a list row has for it. */
export function jobTechnicianLabel(
  job: TechnicianNameFields | null | undefined,
  max = 2,
): string {
  const names = jobTechnicianNames(job);
  if (names.length === 0) return "";
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} +${names.length - max}`;
}

export function isJobTechnician(
  job: TechnicianIdFields,
  uid: string | undefined,
): boolean {
  return !!uid && jobTechnicianIds(job).includes(uid);
}

export function jobHasTechnicianName(
  job: TechnicianNameFields,
  name: string,
): boolean {
  return jobTechnicianNames(job).includes(name);
}

/** What a staff member is called on a job card. */
export function staffDisplayName(staff: StaffMember): string {
  return staff.fullName || staff.displayName || staff.email?.split("@")[0] || "Technician";
}

export interface JobTechnician {
  id: string;
  name: string;
}

/**
 * The fields a write should set for a crew. Both shapes are always written so
 * an older build (and every existing query on `technicianId`) still resolves
 * the job to its lead technician.
 */
export function technicianFields(crew: JobTechnician[]): {
  technicianId: string;
  technicianName: string;
  technicianIds: string[];
  technicianNames: string[];
} {
  const clean = crew.filter(t => t.id);
  return {
    technicianId: clean[0]?.id ?? "",
    technicianName: clean[0]?.name ?? "",
    technicianIds: clean.map(t => t.id),
    technicianNames: clean.map(t => t.name),
  };
}

/** The crew of a job as pairs, for editing. */
export function jobCrew(job: ServiceJob): JobTechnician[] {
  const ids = jobTechnicianIds(job);
  const names = jobTechnicianNames(job);
  return ids.map((id, i) => ({ id, name: names[i] ?? "" }));
}

/**
 * Merge two job lists into one, de-duplicated by id. A technician's jobs come
 * from two queries — the legacy `technicianId ==` one and the `technicianIds
 * array-contains` one — because Firestore can't OR them without an index.
 */
export function mergeJobLists(...lists: ServiceJob[][]): ServiceJob[] {
  const byId = new Map<string, ServiceJob>();
  for (const list of lists) for (const job of list) byId.set(job.id, job);
  return Array.from(byId.values());
}
