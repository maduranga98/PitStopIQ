import { useEffect } from "react";
import { waitForPendingWrites } from "firebase/firestore";
import { db } from "../config/firebase";
import { useNetworkStore } from "../store/networkSlice";
import { usePendingWritesStore } from "../store/pendingWritesSlice";

export function useOnlineStatus() {
  const status = useNetworkStore((s) => s.status);
  const setStatus = useNetworkStore((s) => s.setStatus);

  useEffect(() => {
    let syncTimer: ReturnType<typeof setTimeout>;

    const goOffline = () => {
      clearTimeout(syncTimer);
      setStatus("offline");
    };

    const goOnline = () => {
      setStatus("syncing");
      waitForPendingWrites(db)
        .then(() => {
          usePendingWritesStore.getState().reset();
          setStatus("online");
        })
        .catch(() => {
          syncTimer = setTimeout(() => setStatus("online"), 3000);
        });

      syncTimer = setTimeout(() => {
        if (useNetworkStore.getState().status === "syncing") {
          setStatus("online");
        }
      }, 3000);
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      clearTimeout(syncTimer);
    };
  }, [setStatus]);

  return {
    status,
    isOnline: status === "online",
    isOffline: status === "offline",
    isSyncing: status === "syncing",
  };
}
