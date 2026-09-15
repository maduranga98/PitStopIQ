import { CloudOff } from "lucide-react";
import { persistenceAvailable } from "../config/firebase";

/**
 * Shown when Firestore could not open IndexedDB and fell back to an in-memory
 * cache (private browsing, blocked site data, a locked-down WebView).
 *
 * The app still works, but it is online only: nothing survives a reload, and
 * work done in the yard with no signal is held in the tab rather than on disk.
 * Without this the failure is invisible until the moment it costs someone a job
 * card, and "it worked yesterday" is impossible to support.
 *
 * Sits above OfflineBanner in the layout because it is the more serious of the
 * two: offline is temporary and expected, this is neither.
 */
export default function PersistenceBanner() {
  if (persistenceAvailable) return null;

  return (
    <div className="w-full flex items-center justify-center gap-2 px-3 py-2 text-white text-[13px] bg-amber-900/60 border-b border-amber-500/30">
      <CloudOff className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="text-center">
        Offline saving is off on this device — stay connected while you work.
      </span>
    </div>
  );
}
