import { useState } from "react";
import { doc, serverTimestamp } from "firebase/firestore";
import { Timer, Play, Pause, RotateCcw, X, ChevronDown, ChevronUp } from "lucide-react";
import { db } from "../../config/firebase";
import { safeUpdateDoc } from "../../lib/firestoreWrite";
import AmountInput from "../common/AmountInput";
import {
  PAUSE_REASONS, PAUSE_REASON_LABELS, TIMER_EVENT_LABELS,
  allowedTimerEvents, formatWorkingDuration, msToMinutes, orderedLog, summarizeTimeLog,
  type TimerState,
} from "../../lib/workingHours";
import { useWorkingHoursStore } from "../../store/workingHoursSlice";
import { useLiveTick } from "../../hooks/useLiveTick";
import type { ServiceJob, WorkingPauseReason } from "../../types/auth";

const STATE_CHIP: Record<TimerState, { label: string; cls: string }> = {
  idle:    { label: "Not started", cls: "bg-white/5 text-gray-400 border-white/10" },
  running: { label: "Running",     cls: "bg-green-500/15 text-green-300 border-green-500/30" },
  paused:  { label: "Paused",      cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  stopped: { label: "Stopped",     cls: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
};

function formatEventTime(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

interface Props {
  job: ServiceJob;
  centerId: string;
  uid: string;
  /** Role permission + assignment + job still open — see canOperateTimer. */
  canOperate: boolean;
  /** Owner only: the job's hourly rate. */
  canEditRate: boolean;
  /** Names for the "by" column, where the page already has them. */
  staffNameOf?: (uid: string) => string | undefined;
}

/**
 * The working-hours timer on a job card. Only mounted for a job that opted in
 * (`workingHoursEnabled`). Every figure here is derived from the job's
 * `timeLog` on render — nothing counts up in the document.
 */
export default function WorkingHoursTimer({ job, centerId, uid, canOperate, canEditRate, staffNameOf }: Props) {
  const logTimerEvent = useWorkingHoursStore((s) => s.logTimerEvent);
  const pending = useWorkingHoursStore((s) => !!s.pendingJobIds[job.id]);

  const [pauseOpen, setPauseOpen] = useState(false);
  const [reason, setReason] = useState<WorkingPauseReason | "">("");
  const [error, setError] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [rateDraft, setRateDraft] = useState<number | null>(null);
  const [savingRate, setSavingRate] = useState(false);

  const summary = summarizeTimeLog(job.timeLog);
  useLiveTick(summary.state === "running");
  const minutes = msToMinutes(summary.totalMs);
  const actions = canOperate ? allowedTimerEvents(summary.state) : [];
  const chip = STATE_CHIP[summary.state];
  const log = orderedLog(job.timeLog);
  const lastPause = [...log].reverse().find((e) => e.event === "pause");

  async function run(action: "start" | "pause" | "resume", why?: WorkingPauseReason) {
    setError("");
    try {
      await logTimerEvent(centerId, job, action, uid, why ?? null);
      setPauseOpen(false);
      setReason("");
    } catch {
      setError("Couldn't update the timer. Check your connection and try again.");
    }
  }

  async function saveRate() {
    if (rateDraft == null) return;
    const next = rateDraft > 0 ? Math.round(rateDraft * 100) / 100 : null;
    if (next === (job.hourlyRate ?? null)) { setRateDraft(null); return; }
    setSavingRate(true);
    try {
      await safeUpdateDoc(doc(db, "servicecenters", centerId, "jobs", job.id), {
        hourlyRate: next,
        updatedAt: serverTimestamp(),
      });
      setRateDraft(null);
    } catch {
      setError("Couldn't save the hourly rate.");
    }
    setSavingRate(false);
  }

  const btn = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors";

  return (
    <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wider font-semibold">
          <Timer className="w-3.5 h-3.5 text-[#F97316]" />
          Working Hours
        </div>
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${chip.cls}`}>{chip.label}</span>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-3xl font-bold text-white tabular-nums">{formatWorkingDuration(minutes)}</div>
          <p className="text-xs text-gray-500 mt-0.5">
            {summary.state === "paused" && lastPause?.reason
              ? `Paused — ${PAUSE_REASON_LABELS[lastPause.reason]}`
              : summary.state === "idle"
                ? "Time on the tools, excluding pauses"
                : "Actual working time, pauses excluded"}
          </p>
        </div>

        {actions.length > 0 && (
          <div className="flex items-center gap-2">
            {actions.includes("start") && (
              <button onClick={() => run("start")} disabled={pending} className={`${btn} bg-[#F97316] hover:bg-orange-600 text-white`}>
                <Play className="w-4 h-4" /> Start
              </button>
            )}
            {actions.includes("pause") && (
              <button onClick={() => { setError(""); setPauseOpen(true); }} disabled={pending} className={`${btn} bg-white/10 hover:bg-white/20 text-white`}>
                <Pause className="w-4 h-4" /> Pause
              </button>
            )}
            {actions.includes("resume") && (
              <button onClick={() => run("resume")} disabled={pending} className={`${btn} bg-[#F97316] hover:bg-orange-600 text-white`}>
                <RotateCcw className="w-4 h-4" /> Resume
              </button>
            )}
          </div>
        )}
      </div>

      {(job.status === "done" || job.status === "delivered") && summary.state === "stopped" && (
        <p className="text-[11px] text-gray-500 mt-2">The timer stopped automatically when the job was marked done.</p>
      )}

      {/* Hourly rate — prefilled from Settings when the job was opened. Only
          the Owner sets it; everyone else just sees it. */}
      <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between gap-3">
        <span className="text-xs text-gray-400">Hourly rate</span>
        {canEditRate ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">LKR</span>
            <AmountInput
              value={rateDraft ?? job.hourlyRate ?? 0}
              onChange={(v) => setRateDraft(parseFloat(v) || 0)}
              disabled={savingRate}
              className="w-28 bg-white/5 border border-white/10 text-white rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:border-orange-500 disabled:opacity-60"
            />
            {rateDraft != null && (
              <button onClick={saveRate} disabled={savingRate} className="text-xs text-orange-400 hover:text-orange-300 disabled:opacity-50">
                Save
              </button>
            )}
          </div>
        ) : (
          <span className="text-sm text-white">
            {job.hourlyRate ? `LKR ${job.hourlyRate.toLocaleString("en-LK", { minimumFractionDigits: 2 })}/hr` : "—"}
          </span>
        )}
      </div>

      {log.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowLog((v) => !v)} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white">
            {showLog ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {showLog ? "Hide" : "Show"} time log ({log.length})
          </button>
          {showLog && (
            <div className="mt-2 divide-y divide-white/5 text-xs">
              {log.map((e, i) => (
                <div key={i} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-white">
                    {TIMER_EVENT_LABELS[e.event]}
                    {e.reason && <span className="text-gray-500"> · {PAUSE_REASON_LABELS[e.reason]}</span>}
                  </span>
                  <span className="text-gray-500 text-right">
                    {formatEventTime(e.timestamp.toMillis())}
                    {staffNameOf?.(e.by) && <span className="block">{staffNameOf(e.by)}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}

      {pauseOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setPauseOpen(false)}>
          <div className="bg-[#162032] border border-white/10 rounded-xl p-5 max-w-sm w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white text-sm">Pause the timer</h3>
              <button onClick={() => setPauseOpen(false)} className="text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1.5">Why is work stopping?</label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as WorkingPauseReason)}
                className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
              >
                <option value="" disabled className="bg-[#162032]">Select a reason…</option>
                {PAUSE_REASONS.map((r) => (
                  <option key={r} value={r} className="bg-[#162032]">{PAUSE_REASON_LABELS[r]}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setPauseOpen(false)} className="text-xs text-gray-400 hover:text-white px-3 py-1.5">
                Cancel
              </button>
              <button
                onClick={() => reason && run("pause", reason)}
                disabled={!reason || pending}
                className="text-xs bg-[#F97316] hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
              >
                Pause
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
