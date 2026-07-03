import { create } from "zustand";

type NetworkStatus = "online" | "offline" | "syncing";

interface NetworkState {
  status: NetworkStatus;
  setStatus: (status: NetworkStatus) => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  status: navigator.onLine ? "online" : "offline",
  setStatus: (status) => set({ status }),
}));
