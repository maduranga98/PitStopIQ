// Working hours: the time a job actually spent on the tools.
//
// A job's created → completed span is useless as a measure of work at a
// center that parks a car for three days waiting on a part. So a job that
// opts in (ServiceJob.workingHoursEnabled, offered only while the center has
// `workingHoursTrackingEnabled` on) carries a start/pause/resume/stop event
// log, and the working time is derived from it.
//
// The log is the only source of truth. Nothing ever counts minutes up in the
// document: `totalWorkingMinutes` is re-derived from the whole log on every
// write, and the live figure on screen is re-derived on every render. That is
// what keeps it right under offline-first persistence — two tablets, or one
// that was offline for an hour, append their events and the total simply
// follows from whatever the log ends up holding.
//
// Three opt-ins, deliberately independent (see ServiceCenter/ServiceJob/
// InvoiceLineItem in types/auth.ts):
//   center  → workingHoursTrackingEnabled / workingHoursInvoiceBillingEnabled
//   job     → workingHoursEnabled
//   invoice → one line's billingType = "hourly"
import { arrayUnion, serverTimestamp, Timestamp } from "firebase/firestore";
import { isJobTechnician } from "./jobTechnicians";
import type {
  InvoiceLineItem, ServiceCenter, ServiceJob, UserRole,
  WorkingPauseReason, WorkingTimeEvent, WorkingTimeLogEntry,
} from "../types/auth";

export const PAUSE_REASON_LABELS: Record<WorkingPauseReason, string> = {
  parts_unavailable: "Parts unavailable",
  customer_hold: "Customer on hold",
  other: "Other",
};

export const PAUSE_REASONS = Object.keys(PAUSE_REASON_LABELS) as WorkingPauseReason[];

export const TIMER_EVENT_LABELS: Record<WorkingTimeEvent, string> = {
  start: "Started",
  pause: "Paused",
  resume: "Resumed",
  stop: "Stopped",
};

/** idle: never started · running · paused · stopped (job completed). */
export type TimerState = "idle" | "running" | "paused" | "stopped";

export interface WorkingTimeSummary {
  state: TimerState;
  /** Closed intervals only — what `totalWorkingMinutes` stores. */
  closedMs: number;
  /** Closed intervals plus the running one up to `now`. */
  totalMs: number;
  /** When the running interval began, while `state` is "running". */
  runningSince: number | null;
}

function tsMillis(ts: WorkingTimeLogEntry["timestamp"] | null | undefined): number | null {
  if (!ts) return null;
  if (typeof (ts as Timestamp).toMillis === "function") return (ts as Timestamp).toMillis();
  return null;
}

/**
 * The log in time order. Entries are appended with arrayUnion, so two devices
 * syncing late can land out of order in the array; the timestamps are what
 * actually say which came first. Entries without a readable timestamp (never
 * written by this app) are dropped rather than guessed at.
 */
export function orderedLog(log: WorkingTimeLogEntry[] | undefined): WorkingTimeLogEntry[] {
  return (log ?? [])
    .filter((e) => tsMillis(e.timestamp) != null)
    .slice()
    .sort((a, b) => tsMillis(a.timestamp)! - tsMillis(b.timestamp)!);
}

/**
 * Reduce the log into working time: every start/resume opens an interval,
 * every pause/stop closes the open one. Events that don't change anything
 * (a pause while already paused, a second start) are ignored, so a doubled
 * tap or a racing device can never inflate the figure.
 */
export function summarizeTimeLog(
  log: WorkingTimeLogEntry[] | undefined,
  now: number = Date.now(),
): WorkingTimeSummary {
  let closedMs = 0;
  let openAt: number | null = null;
  let state: TimerState = "idle";

  for (const entry of orderedLog(log)) {
    const t = tsMillis(entry.timestamp)!;
    switch (entry.event) {
      case "start":
      case "resume":
        if (openAt == null) openAt = t;
        state = "running";
        break;
      case "pause":
        if (openAt != null) closedMs += Math.max(0, t - openAt);
        openAt = null;
        if (state !== "stopped") state = "paused";
        break;
      case "stop":
        if (openAt != null) closedMs += Math.max(0, t - openAt);
        openAt = null;
        state = "stopped";
        break;
    }
  }

  const runningMs = openAt != null ? Math.max(0, now - openAt) : 0;
  return { state, closedMs, totalMs: closedMs + runningMs, runningSince: openAt };
}

export const msToMinutes = (ms: number) => Math.round(ms / 60_000);

/** "2h 15m", "45m", "0m". */
export function formatWorkingDuration(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return h > 0 ? `${h}h ${rem}m` : `${rem}m`;
}

/** Hours to bill, from minutes, to two decimals (2h 15m → 2.25). */
export function minutesToHours(minutes: number): number {
  return Math.round((Math.max(0, minutes) / 60) * 100) / 100;
}

/** Which buttons a state offers. A stopped timer can only be resumed on a re-opened job. */
export function allowedTimerEvents(state: TimerState): WorkingTimeEvent[] {
  switch (state) {
    case "idle": return ["start"];
    case "running": return ["pause"];
    case "paused": return ["resume"];
    case "stopped": return ["resume"];
  }
}

// ── Permissions ──────────────────────────────────────────────────────────────

/**
 * Whether this user may press Start/Pause/Resume on this job. Same shape as
 * every other job action: the role permission, plus — for a Technician — the
 * job has to be one they're on. The Owner always may (hasPermission already
 * returns true for the Owner). firestore.rules enforces the same check.
 */
export function canOperateTimer(
  job: Pick<ServiceJob, "workingHoursEnabled" | "status" | "technicianId" | "technicianIds">,
  user: { uid: string; role?: UserRole } | null | undefined,
  hasTrackPermission: boolean,
): boolean {
  if (!user || job.workingHoursEnabled !== true || !hasTrackPermission) return false;
  if (job.status === "done" || job.status === "delivered") return false;
  if (user.role === "Technician" && !isJobTechnician(job, user.uid)) return false;
  return true;
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * A new log entry. Client time, not serverTimestamp(): Firestore does not
 * allow serverTimestamp() inside an array element, and a client Timestamp is
 * also what keeps the event readable (and the live total correct) while the
 * write is still queued offline — the same trade the rest of the app makes
 * with Timestamp.now() on documents that must be visible offline.
 */
export function buildLogEntry(
  event: WorkingTimeEvent,
  uid: string,
  reason: WorkingPauseReason | null = null,
): WorkingTimeLogEntry {
  if (event === "pause" && !reason) throw new Error("A pause needs a reason");
  return { event, reason: event === "pause" ? reason : null, timestamp: Timestamp.now(), by: uid };
}

export interface TimerWrite {
  /** Fields for safeUpdateDoc on the job. */
  fields: Record<string, unknown>;
  /** The job's timer fields as they will read once the write lands. */
  next: Pick<ServiceJob, "timeLog" | "totalWorkingMinutes" | "isCurrentlyPaused">;
}

/**
 * The update that appends one event. arrayUnion rather than rewriting the
 * array, so an event another device appended meanwhile is never overwritten;
 * the denormalised total is computed from the log as this device knows it
 * plus the new entry — the next write from anywhere re-derives it again.
 */
export function timerEventWrite(
  currentLog: WorkingTimeLogEntry[] | undefined,
  entry: WorkingTimeLogEntry,
): TimerWrite {
  const nextLog = [...(currentLog ?? []), entry];
  const summary = summarizeTimeLog(nextLog, tsMillis(entry.timestamp) ?? Date.now());
  const next = {
    timeLog: nextLog,
    totalWorkingMinutes: msToMinutes(summary.closedMs),
    isCurrentlyPaused: summary.state === "paused",
  };
  return {
    fields: {
      timeLog: arrayUnion(entry),
      totalWorkingMinutes: next.totalWorkingMinutes,
      isCurrentlyPaused: next.isCurrentlyPaused,
      updatedAt: serverTimestamp(),
    },
    next,
  };
}

/**
 * Closing the log when a job is marked done. Returns null when there is
 * nothing to close (not a tracked job, never started, already stopped), so
 * the caller spreads nothing and the completion write is exactly what it was.
 * A paused timer is stopped too — the pause already closed the interval, the
 * stop just records that the work is over.
 */
export function autoStopWrite(
  job: Pick<ServiceJob, "workingHoursEnabled" | "timeLog">,
  uid: string,
): TimerWrite | null {
  if (job.workingHoursEnabled !== true) return null;
  const { state } = summarizeTimeLog(job.timeLog);
  if (state !== "running" && state !== "paused") return null;
  const write = timerEventWrite(job.timeLog, buildLogEntry("stop", uid));
  // The completion write sets its own updatedAt.
  const { updatedAt: _ignored, ...fields } = write.fields;
  void _ignored;
  return { fields, next: write.next };
}

// ── Center settings ──────────────────────────────────────────────────────────

export interface WorkingHoursSettings {
  trackingEnabled: boolean;
  /** Never true while tracking is off, whatever the document says. */
  invoiceBillingEnabled: boolean;
  defaultHourlyRate: number | null;
}

export function workingHoursSettingsOf(
  center: Pick<ServiceCenter, "workingHoursTrackingEnabled" | "workingHoursInvoiceBillingEnabled" | "defaultHourlyRate"> | null | undefined,
): WorkingHoursSettings {
  const trackingEnabled = center?.workingHoursTrackingEnabled === true;
  const rate = center?.defaultHourlyRate;
  return {
    trackingEnabled,
    invoiceBillingEnabled: trackingEnabled && center?.workingHoursInvoiceBillingEnabled === true,
    defaultHourlyRate: typeof rate === "number" && rate > 0 ? rate : null,
  };
}

// ── Hourly invoice lines ─────────────────────────────────────────────────────

const money = (n: number) => Math.round(n * 100) / 100;

export function hourlyTotal(rate: number, hours: number): number {
  return money(Math.max(0, rate) * Math.max(0, hours));
}

export const isHourlyLine = (item: InvoiceLineItem) => item.billingType === "hourly";

/**
 * A line priced by the hour. qty stays 1 and unitPrice follows lineTotal, so
 * every reader that only knows qty × unit price (the totals, line discounts,
 * commission, reports) keeps reading the right money off it.
 */
export function asHourlyLine(
  item: InvoiceLineItem,
  rate: number,
  hours: number,
  totalOverride?: number,
): InvoiceLineItem {
  const total = totalOverride != null ? money(Math.max(0, totalOverride)) : hourlyTotal(rate, hours);
  const discount = item.discount != null ? Math.min(item.discount, total) : undefined;
  return {
    ...item,
    billingType: "hourly",
    hourlyRate: money(Math.max(0, rate)),
    workingHours: money(Math.max(0, hours)),
    qty: 1,
    unitPrice: total,
    lineTotal: total,
    ...(discount != null ? { discount } : {}),
  };
}

/** Back to a fixed-price line at `unitPrice` (the service's list price, where known). */
export function asFixedLine(item: InvoiceLineItem, unitPrice: number): InvoiceLineItem {
  const { hourlyRate: _r, workingHours: _h, ...rest } = item;
  void _r; void _h;
  const price = money(Math.max(0, unitPrice));
  const discount = rest.discount != null ? Math.min(rest.discount, price) : undefined;
  return {
    ...rest,
    billingType: "fixed",
    qty: 1,
    unitPrice: price,
    lineTotal: price,
    ...(discount != null ? { discount } : {}),
  };
}

/**
 * Whether a line may be offered "Bill by Hour": a service line (never a part)
 * on a bill raised from a job that tracked its working hours, at a center that
 * bills them. A line that is already hourly always keeps its controls, so a
 * bill made hourly before a setting changed still reads and edits the same.
 */
export function isHourlyEligible(
  item: InvoiceLineItem,
  ctx: { jobTracksHours: boolean; billingEnabled: boolean },
): boolean {
  if (isHourlyLine(item)) return true;
  return item.type !== "part" && ctx.jobTracksHours && ctx.billingEnabled;
}

/**
 * Re-applies the hourly line when a job's draft bill is re-synced from the
 * job card (which rewrites every line from the catalog). The line keeps its
 * rate; its hours are refreshed from the job's log, as the rest of the bill
 * is refreshed from the job. Only one line is ever hourly, matched by name.
 */
export function carryHourlyLine(
  freshLines: InvoiceLineItem[],
  previousLines: InvoiceLineItem[] | undefined,
  job: Pick<ServiceJob, "workingHoursEnabled" | "totalWorkingMinutes" | "hourlyRate">,
): InvoiceLineItem[] {
  const prev = (previousLines ?? []).find(isHourlyLine);
  if (!prev) return freshLines;
  const key = prev.description.trim().toLowerCase();
  const idx = freshLines.findIndex(
    (l) => l.type !== "part" && l.description.trim().toLowerCase() === key,
  );
  if (idx < 0) return freshLines;
  const rate = prev.hourlyRate ?? job.hourlyRate ?? 0;
  const hours = job.workingHoursEnabled === true
    ? minutesToHours(job.totalWorkingMinutes ?? 0)
    : prev.workingHours ?? 0;
  return freshLines.map((l, i) => (i === idx ? asHourlyLine(l, rate, hours) : l));
}

/** "2.25 hrs @ LKR 1,500.00/hr" — how an hourly line reads on the printed bill. */
export function hourlyLineCaption(item: InvoiceLineItem): string {
  const hours = item.workingHours ?? 0;
  const rate = (item.hourlyRate ?? 0).toLocaleString("en-LK", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return `${hours} ${hours === 1 ? "hr" : "hrs"} @ LKR ${rate}/hr`;
}
