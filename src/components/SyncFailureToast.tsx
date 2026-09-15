import { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";
import { registerWriteFailureHandler } from "../lib/firestoreWrite";
import { useWriteFailuresStore } from "../store/writeFailuresSlice";

/**
 * Tells the user when a write the app already showed as saved was rejected by
 * the server.
 *
 * Writes resolve as soon as they are committed locally (lib/firestoreWrite.ts),
 * which is what stops the app hanging offline — but it also means the screen has
 * already moved on by the time a rejection arrives. That is the one case where
 * the user has been shown a success that did not happen, and until now it was a
 * console.error nobody would ever read.
 *
 * Deliberately not auto-dismissed: a lost write is not a passing notification,
 * and on a counter tablet nobody is watching the screen when it would fade.
 */
export default function SyncFailureToast() {
  const failures = useWriteFailuresStore((s) => s.failures);
  const dismiss = useWriteFailuresStore((s) => s.dismiss);
  const report = useWriteFailuresStore((s) => s.report);

  useEffect(() => registerWriteFailureHandler(report), [report]);

  if (failures.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-[calc(100%-2rem)] sm:w-auto">
      {failures.map((f) => (
        <div
          key={f.id}
          role="alert"
          className="bg-[#2A1215] border border-red-500/40 rounded-xl shadow-lg px-4 py-3 flex items-start gap-3"
        >
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-white font-medium">Could not save that change</p>
            {/* The path is the only thing that identifies WHICH change, and staff
                do read it out to support. The message underneath is the server's
                own words, which is what makes a rules problem diagnosable. */}
            <p className="text-xs text-red-300/90 mt-0.5 break-words">{f.message}</p>
            <p className="text-[11px] text-gray-500 mt-1 font-mono break-all">{f.path}</p>
          </div>
          <button
            onClick={() => dismiss(f.id)}
            aria-label="Dismiss"
            className="text-gray-500 hover:text-white flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
