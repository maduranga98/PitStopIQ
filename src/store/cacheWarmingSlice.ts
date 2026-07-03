import { create } from "zustand";

interface CacheWarmingState {
  warmedAt: Date | null;
  setWarmedAt: (date: Date) => void;
}

export const useCacheWarmingStore = create<CacheWarmingState>((set) => ({
  warmedAt: null,
  setWarmedAt: (date) => set({ warmedAt: date }),
}));
