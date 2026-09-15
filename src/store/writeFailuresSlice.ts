import { create } from "zustand";
import type { WriteFailure } from "../lib/firestoreWrite";

export interface TrackedWriteFailure extends WriteFailure {
  id: string;
  at: number;
}

interface WriteFailuresState {
  failures: TrackedWriteFailure[];
  report: (failure: WriteFailure) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

/** Beyond this the screen is a wall of red and the first one is the useful one. */
const MAX_VISIBLE = 3;

export const useWriteFailuresStore = create<WriteFailuresState>((set) => ({
  failures: [],
  report: (failure) =>
    set((s) => {
      // One row per document path. A retry loop on the same document is one
      // problem, not twenty, and stacking it would bury everything else.
      const rest = s.failures.filter((f) => f.path !== failure.path);
      const entry: TrackedWriteFailure = {
        ...failure,
        id: `${failure.path}:${Date.now()}`,
        at: Date.now(),
      };
      return { failures: [entry, ...rest].slice(0, MAX_VISIBLE) };
    }),
  dismiss: (id) => set((s) => ({ failures: s.failures.filter((f) => f.id !== id) })),
  clear: () => set({ failures: [] }),
}));
