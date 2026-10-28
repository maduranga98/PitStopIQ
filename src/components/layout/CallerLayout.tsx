import { Outlet } from "react-router-dom";
import { LogOut, PhoneCall } from "lucide-react";
import { useCaller } from "../../contexts/CallerContext";

export default function CallerLayout() {
  const { caller, logout } = useCaller();

  return (
    <div className="min-h-screen flex flex-col bg-gray-950 text-gray-100">
      <header className="h-14 flex-shrink-0 bg-gray-900 border-b border-gray-800 px-4 sm:px-6 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center">
          <PhoneCall className="w-4 h-4 text-white" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-white">PitStop IQ</p>
          <p className="text-xs text-orange-400">My Leads</p>
        </div>
        <div className="flex-1" />
        <span className="hidden sm:block text-xs text-gray-500 truncate max-w-[200px]">{caller?.name}</span>
        <button
          onClick={() => void logout()}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </header>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
