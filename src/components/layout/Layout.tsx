import { useState } from "react";
import { Outlet } from "react-router-dom";
import Navbar from "./Navbar";
import NavbarSkeleton from "./NavbarSkeleton";
import CommandPalette from "../CommandPalette";
import OfflineBanner from "../OfflineBanner";
import PersistenceBanner from "../PersistenceBanner";
import SyncFailureToast from "../SyncFailureToast";
import { LoadingBlock } from "../LoadingProgress";
import { useAuth } from "../../contexts/AuthContext";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // ProtectedRoute hands us the route while auth is still resolving, so the
  // shell paints immediately and only the content area waits. Everything that
  // needs a real user — the nav tree, the branch switcher, the command palette
  // and the page itself — stays unmounted until `loading` clears, so nothing
  // renders against a null profile or fires a read it would only repeat.
  const { loading } = useAuth();

  useOnlineStatus();

  return (
    <div className="min-h-screen bg-[#0B1120] flex flex-col lg:flex-row">
      {loading ? (
        <NavbarSkeleton />
      ) : (
        <Navbar
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          mobileOpen={mobileOpen}
          setMobileOpen={setMobileOpen}
        />
      )}
      <div className="flex-1 min-w-0 overflow-x-hidden flex flex-col">
        <PersistenceBanner />
        <OfflineBanner />
        <main className="flex-1">
          {loading ? (
            // Same watchdog the full-page loader carried: past expectedMs it
            // calls itself slow, then offers a reload rather than spinning on.
            <LoadingBlock theme="dark" expectedMs={2000} className="min-h-[60vh] py-24" />
          ) : (
            <Outlet />
          )}
        </main>
      </div>
      {!loading && <CommandPalette />}
      <SyncFailureToast />
    </div>
  );
}
