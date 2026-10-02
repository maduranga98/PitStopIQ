import { useCallback, useEffect, useRef, useState } from "react";
import { watchDoc } from "../lib/listeners";
import { inspectionReportDoc } from "../lib/inspectionReports/paths";
import { patchReport } from "../lib/inspectionReports/reports";
import type { InspectionReport } from "../types/inspectionReports";

export type DraftLoad = "loading" | "ready" | "missing" | "error";
export type DraftSave = "saved" | "saving" | "error";

const DEBOUNCE_MS = 700;

/** Fields the server/queue changes while the editor is open; everything else is
 *  the editor's own and is never overwritten by an incoming snapshot (which
 *  would move the cursor under someone who is typing). */
const LIVE_KEYS = ["media", "status", "reportNumber", "finalizedAt", "pdfUrl"] as const;

/**
 * One open report: a per-document listener (never a collection listener), local
 * state that updates instantly, and debounced dotted-path patches back to
 * Firestore. Works offline — safeUpdateDoc resolves once committed locally.
 *
 * `edit(local, patch)` — a typing-speed change: state now, write after a pause.
 * `editNow(local, patch)` — a discrete change (photo, answer): write immediately.
 * Patches for the same key coalesce (last value wins), so don't route a change
 * through `edit` if it uses arrayUnion/arrayRemove — use `editNow`.
 */
export function useReportDraft(centerId: string | undefined, reportId: string | undefined) {
  const [report, setReport] = useState<InspectionReport | null>(null);
  const [load, setLoad] = useState<DraftLoad>("loading");
  const [save, setSave] = useState<DraftSave>("saved");
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const patch = pending.current;
    if (!centerId || !reportId || Object.keys(patch).length === 0) return;
    pending.current = {};
    setSave("saving");
    patchReport(centerId, reportId, patch).then(() => setSave("saved")).catch(() => setSave("error"));
  }, [centerId, reportId]);

  useEffect(() => {
    if (!centerId || !reportId) return;
    first.current = true;
    const unsub = watchDoc(
      inspectionReportDoc(centerId, reportId),
      (snap) => {
        if (!snap.exists()) { setLoad("missing"); return; }
        const incoming = { id: snap.id, ...snap.data() } as InspectionReport;
        if (first.current) {
          first.current = false;
          setReport(incoming);
        } else {
          setReport((prev) => {
            if (!prev) return incoming;
            const next = { ...prev };
            for (const k of LIVE_KEYS) (next as Record<string, unknown>)[k] = incoming[k];
            return next;
          });
        }
        setLoad("ready");
      },
      () => setLoad("error"),
    );
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      flush(); // leaving the page must not drop the last second of typing
      unsub();
    };
  }, [centerId, reportId, flush]);

  const edit = useCallback((local: (r: InspectionReport) => InspectionReport, patch: Record<string, unknown>) => {
    setReport((r) => (r ? local(r) : r));
    Object.assign(pending.current, patch);
    setSave("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, DEBOUNCE_MS);
  }, [flush]);

  const editNow = useCallback((local: (r: InspectionReport) => InspectionReport, patch: Record<string, unknown>) => {
    setReport((r) => (r ? local(r) : r));
    Object.assign(pending.current, patch);
    flush();
  }, [flush]);

  return { report, load, save, edit, editNow, flush };
}
