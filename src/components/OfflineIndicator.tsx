import { useEffect, useState } from "react";
import { WifiOff, Wifi } from "lucide-react";

/**
 * Fixed banner shown while the browser is offline, plus a short
 * "back online" confirmation when the connection returns. Firestore's
 * persistent cache keeps the app usable offline — this just tells the
 * user what's happening so they trust that queued changes will sync.
 */
export default function OfflineIndicator() {
  const [offline, setOffline] = useState(!navigator.onLine);
  const [justReconnected, setJustReconnected] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const goOffline = () => { setOffline(true); setJustReconnected(false); };
    const goOnline = () => {
      setOffline(false);
      setJustReconnected(true);
      timer = setTimeout(() => setJustReconnected(false), 4000);
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      clearTimeout(timer);
    };
  }, []);

  if (!offline && !justReconnected) return null;

  return (
    <div
      className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-4 py-2.5 rounded-xl border shadow-2xl text-sm font-medium ${
        offline
          ? "bg-amber-500/15 border-amber-500/40 text-amber-300 backdrop-blur"
          : "bg-green-500/15 border-green-500/40 text-green-300 backdrop-blur"
      }`}
      role="status"
    >
      {offline ? (
        <>
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>You're offline — changes are saved locally and will sync automatically.</span>
        </>
      ) : (
        <>
          <Wifi className="w-4 h-4 shrink-0" />
          <span>Back online — syncing changes…</span>
        </>
      )}
    </div>
  );
}
