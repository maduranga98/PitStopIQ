import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";

export default function Layout() {
  return (
    <div className="min-h-screen bg-[#0B1120] flex">
      <Sidebar />
      {/* ml-56 matches sidebar width */}
      <div className="flex-1 ml-56 min-h-screen overflow-x-hidden">
        <Outlet />
      </div>
    </div>
  );
}
