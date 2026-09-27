import { formatWorkingDuration, msToMinutes, summarizeTimeLog } from "../../lib/workingHours";
import { useLiveTick } from "../../hooks/useLiveTick";
import type { ServiceJob } from "../../types/auth";

/**
 * "⏱ 2h 15m (Paused)" on a job list row. Renders nothing for a job that
 * doesn't track working hours, so every other row is untouched. Ticks once a
 * minute while running — a list has no need for anything finer.
 */
export default function WorkingHoursBadge({
  job,
}: { job: Pick<ServiceJob, "workingHoursEnabled" | "timeLog" | "isCurrentlyPaused"> }) {
  const summary = summarizeTimeLog(job.workingHoursEnabled === true ? job.timeLog : undefined);
  useLiveTick(job.workingHoursEnabled === true && summary.state === "running", 60_000);
  if (job.workingHoursEnabled !== true) return null;

  const paused = summary.state === "paused" || (summary.state === "idle" && job.isCurrentlyPaused === true);
  const tone = summary.state === "running"
    ? "bg-green-500/15 text-green-300 border-green-500/30"
    : paused
      ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
      : "bg-white/5 text-gray-400 border-white/10";

  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full border whitespace-nowrap tabular-nums ${tone}`}>
      <span aria-hidden>⏱</span>
      {formatWorkingDuration(msToMinutes(summary.totalMs))}
      {paused && <span className="opacity-80">(Paused)</span>}
    </span>
  );
}
