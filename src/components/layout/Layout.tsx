import { useState } from "react";
import { Outlet } from "react-router-dom";
import Navbar from "./Navbar";
import CommandPalette from "../CommandPalette";
import OfflineBanner from "../OfflineBanner";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";
import { useAuth } from "../../contexts/AuthContext";
import { useCacheWarming } from "../../hooks/useCacheWarming";

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { currentUser } = useAuth();

  useOnlineStatus();
  useCacheWarming(currentUser?.centerId, currentUser?.centerPlan === "pro");

  return (
    <div className="min-h-screen bg-[#0B1120] flex flex-col lg:flex-row">
      <Navbar
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
      />
      <div className="flex-1 min-w-0 overflow-x-hidden flex flex-col">
        <OfflineBanner />
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
