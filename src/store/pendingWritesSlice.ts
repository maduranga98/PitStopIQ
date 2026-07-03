import { create } from "zustand";

interface PendingWritesState {
  pendingCount: number;
  increment: () => void;
  decrement: () => void;
  reset: () => void;
}

export const usePendingWritesStore = create<PendingWritesState>((set) => ({
  pendingCount: 0,
  increment: () => set((s) => ({ pendingCount: s.pendingCount + 1 })),
  decrement: () => set((s) => ({ pendingCount: Math.max(0, s.pendingCount - 1) })),
  reset: () => set({ pendingCount: 0 }),
}));
