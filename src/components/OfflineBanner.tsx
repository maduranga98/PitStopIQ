import { useNetworkStore } from "../store/networkSlice";
import { Zap } from "lucide-react";

export default function OfflineBanner() {
  const status = useNetworkStore((s) => s.status);

  if (status !== "offline") return null;

  return (
    <div
      className="w-full h-9 flex items-center justify-center gap-2 text-white text-[13px] animate-slideDown"
      style={{ backgroundColor: "#1E3A5F" }}
    >
      <Zap className="w-3.5 h-3.5 flex-shrink-0" />
      <span>Working offline &mdash; your changes will sync automatically</span>
    </div>
  );
}
