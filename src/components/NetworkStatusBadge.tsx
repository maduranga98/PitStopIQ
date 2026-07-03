import { useNetworkStore } from "../store/networkSlice";
import { usePendingWritesStore } from "../store/pendingWritesSlice";
import { usePhotoUploadQueue } from "../hooks/usePhotoUploadQueue";

export default function NetworkStatusBadge() {
  const status = useNetworkStore((s) => s.status);
  const pendingWrites = usePendingWritesStore((s) => s.pendingCount);
  const { pendingCount: pendingPhotos } = usePhotoUploadQueue();

  const totalPending = pendingWrites + pendingPhotos;

  if (status === "online") {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 max-w-[120px]">
        <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
        <span className="text-xs text-gray-500 truncate">Online</span>
      </div>
    );
  }

  if (status === "syncing") {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 max-w-[120px]">
        <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse flex-shrink-0" />
        <span className="text-xs text-yellow-400 truncate">Syncing...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 max-w-[120px] rounded-md bg-amber-500/10">
      <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
      <span className="text-xs text-amber-400 truncate">
        Offline{totalPending > 0 ? ` · ${totalPending}` : ""}
      </span>
    </div>
  );
}
