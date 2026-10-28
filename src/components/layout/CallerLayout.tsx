import { NavLink, Outlet } from "react-router-dom";
import { LayoutGrid, LogOut, PhoneCall, Wallet } from "lucide-react";
import { useCaller } from "../../contexts/CallerContext";
import { CallerLeadsProvider } from "../../contexts/CallerLeadsProvider";

const tabs = [
  { to: "/caller", label: "My Leads", icon: LayoutGrid, end: true },
  { to: "/caller/revenue", label: "Revenue", icon: Wallet, end: false },
] as const;

export default function CallerLayout() {
  const { caller, logout } = useCaller();

  return (
    <CallerLeadsProvider>
      <div className="min-h-screen flex flex-col bg-gray-950 text-gray-100">
        <header className="sticky top-0 z-30 bg-gray-950/90 backdrop-blur border-b border-gray-800/80">
          <div className="px-4 sm:px-6 h-14 flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center">
                <PhoneCall className="w-4 h-4 text-white" />
              </div>
              <span className="hidden sm:block text-sm font-semibold text-white">PitStop IQ</span>
            </div>

            <nav className="flex items-center gap-1 sm:ml-4" aria-label="Sections">
              {tabs.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      isActive ? "bg-white/10 text-white font-medium" : "text-gray-400 hover:text-white hover:bg-white/5"
                    }`
                  }
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </NavLink>
              ))}
            </nav>

            <div className="flex-1" />
            <span className="hidden sm:block text-sm text-gray-400 truncate max-w-[180px]">{caller?.name}</span>
            <button
              onClick={() => void logout()}
              aria-label="Sign out"
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </CallerLeadsProvider>
  );
}
