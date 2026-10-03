import { useState } from "react";
import { AlertCircle, CheckCircle2, Download, Loader2, Lock, RotateCcw } from "lucide-react";
import { callableErrorMessage } from "../../lib/callableError";
import { logVehicleEvent } from "../../lib/vehicleLogs";
import { useAuth } from "../../contexts/AuthContext";
import { useNetworkStore } from "../../store/networkSlice";
import {
  finalizeReport, regenerateReportPdf, reopenReport, reportFinalizeBlockers,
} from "../../lib/inspectionReports/finalize";
import type { InspectionReport } from "../../types/inspectionReports";

/**
 * The draft's Finalize action and the finalized report's PDF / Reopen actions.
 * Owner and Manager only. Finalizing, the PDF and reopening need a connection;
 * a draft never does, so while offline this explains rather than disables work.
 */
export default function FinalizeBar({ report, centerId }: { report: InspectionReport; centerId: string }) {
  const online = useNetworkStore((s) => s.status) !== "offline";
  const { currentUser } = useAuth();
  const [confirm, setConfirm] = useState<"finalize" | "reopen" | null>(null);
  const [busy, setBusy] = useState<"finalize" | "reopen" | "pdf" | null>(null);
  const [error, setError] = useState("");

  async function run(kind: "finalize" | "reopen" | "pdf") {
    setBusy(kind); setError(""); setConfirm(null);
    try {
      if (kind === "finalize") {
        const firstTime = !report.reportNumber;
        const done = await finalizeReport(centerId, report.id);
        // Into the vehicle's history, once — not again when a reopened report is re-finalized.
        if (firstTime) {
          void logVehicleEvent(centerId, report.vehicleId, {
            type: "system", message: `Inspection report ${done.reportNumber} finalized`, actor: currentUser,
          });
        }
      }
      else if (kind === "reopen") await reopenReport(centerId, report.id);
      else await regenerateReportPdf(centerId, report.id);
    } catch (e) {
      setError(callableErrorMessage(e, kind === "pdf" ? "Couldn't generate the PDF." : "Couldn't complete that. Please try again."));
    } finally { setBusy(null); }
  }

  if (report.status === "finalized") {
    return (
      <div className="bg-[#162032] border border-green-500/20 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-green-400" />
          <p className="text-sm font-semibold flex-1">{report.reportNumber}</p>
          <span className="text-[11px] text-gray-500">Finalized</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {report.pdfUrl ? (
            <a href={report.pdfUrl} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 rounded-lg bg-[#F97316] hover:bg-[#ea6c0f] px-3 py-2 text-xs font-semibold text-white">
              <Download className="w-3.5 h-3.5" /> Download PDF
            </a>
          ) : (
            <button type="button" disabled={!online || busy === "pdf"} onClick={() => run("pdf")}
              className="flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs text-gray-200 hover:text-white disabled:opacity-50">
              {busy === "pdf" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              {busy === "pdf" ? "Preparing PDF…" : "PDF not ready — generate it"}
            </button>
          )}
          <button type="button" disabled={!online || busy !== null} onClick={() => setConfirm("reopen")}
            className="rounded-lg border border-white/15 px-3 py-2 text-xs text-gray-300 hover:text-white disabled:opacity-50">
            Reopen
          </button>
        </div>
        {!online && <p className="text-[11px] text-amber-300">Reopening and the PDF need a connection.</p>}
        {confirm === "reopen" && (
          <div className="rounded-lg border border-white/10 bg-[#0B1120] p-3 space-y-2">
            <p className="text-xs text-gray-300">Reopen as a draft? It keeps its number and any link already sent. The PDF is rebuilt when you finalize again.</p>
            <div className="flex gap-3 text-xs">
              <button onClick={() => run("reopen")} className="text-[#F97316] font-semibold">Reopen</button>
              <button onClick={() => setConfirm(null)} className="text-gray-500">Cancel</button>
            </div>
          </div>
        )}
        {error && <p className="flex items-start gap-1.5 text-xs text-red-300"><AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />{error}</p>}
      </div>
    );
  }

  const blockers = reportFinalizeBlockers(report);
  const ready = blockers.length === 0;
  return (
    <div className="bg-[#162032] border border-white/10 rounded-xl p-4 space-y-3">
      {ready ? (
        <p className="flex items-center gap-1.5 text-xs text-green-300"><CheckCircle2 className="w-4 h-4" /> Everything is answered. Ready to finalize.</p>
      ) : (
        <ul className="space-y-1">
          {blockers.map((b) => <li key={b} className="text-xs text-gray-400">• {b}</li>)}
        </ul>
      )}
      <button type="button" disabled={!ready || !online || busy !== null} onClick={() => setConfirm("finalize")}
        className="w-full rounded-xl bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-40 py-3 text-sm font-semibold text-white flex items-center justify-center gap-2">
        {busy === "finalize" && <Loader2 className="w-4 h-4 animate-spin" />}
        {busy === "finalize" ? "Finalizing…" : "Finalize report"}
      </button>
      {!online && <p className="text-[11px] text-amber-300">Finalizing needs a connection. Your draft is safe and keeps saving on this device.</p>}
      {confirm === "finalize" && (
        <div className="rounded-lg border border-white/10 bg-[#0B1120] p-3 space-y-2">
          <p className="text-xs text-gray-300">Finalize? This gives the report its number, locks it, and creates the PDF. You can reopen it later.</p>
          <div className="flex gap-3 text-xs">
            <button onClick={() => run("finalize")} className="text-[#F97316] font-semibold">Finalize</button>
            <button onClick={() => setConfirm(null)} className="text-gray-500">Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="flex items-start gap-1.5 text-xs text-red-300"><AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />{error}</p>}
    </div>
  );
}
