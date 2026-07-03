import { usePendingWritesStore } from "../store/pendingWritesSlice";

export function usePendingWrites() {
  const pendingCount = usePendingWritesStore((s) => s.pendingCount);
  return { pendingCount };
}
