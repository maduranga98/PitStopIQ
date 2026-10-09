import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ArrowLeft, Layers } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { useWorkshopModules } from "../../hooks/useWorkshopModules";
import { useModelsAndGroups, useVehicleTypeOptions } from "../../hooks/useRepairModels";
import ModelsTab from "../../components/repairCatalog/ModelsTab";
import GroupsTab from "../../components/repairCatalog/GroupsTab";
import LinkVehiclesTab from "../../components/repairCatalog/LinkVehiclesTab";
import { ghostBtn } from "../../components/repairCatalog/Sheet";

type Tab = "models" | "groups" | "link";

/** Vehicle models, groups and the vehicle-linking review (Repair Catalog module). */
export default function ModelsAndGroupsPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const centerId = currentUser?.centerId;
  const { repairCatalogEnabled, loading: flagLoading } = useWorkshopModules(centerId);
  const canManage = usePermission("repairCatalog.manageModels");
  const data = useModelsAndGroups(centerId, repairCatalogEnabled);
  const typeOptions = useVehicleTypeOptions(repairCatalogEnabled ? centerId : undefined);
  const [tab, setTab] = useState<Tab>("models");

  if (flagLoading) return <div className="min-h-screen bg-[#0B1120]" />;
  // A module the center hasn't been given leaves no trace, URL included.
  if (!repairCatalogEnabled || !centerId) return <Navigate to="/" replace />;

  const tabs: { key: Tab; label: string }[] = [
    { key: "models", label: "Models" },
    { key: "groups", label: "Groups" },
    ...(canManage ? [{ key: "link" as const, label: "Link vehicles" }] : []),
  ];

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <div className="border-b border-white/10 bg-[#0B1120]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <button onClick={() => navigate("/vehicles")} className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg" aria-label="Back">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Layers className="w-5 h-5 text-[#F97316]" />
          <h1 className="text-xl font-bold">Models &amp; groups</h1>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="flex gap-1 bg-[#0B1120] border border-white/10 rounded-xl p-1 w-fit">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.key ? "bg-[#162032] text-white shadow" : "text-gray-400 hover:text-white"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {data.error ? (
          <div className="rounded-2xl border border-white/10 bg-[#162032] p-6 text-center space-y-3">
            <p className="text-sm text-gray-300">Couldn't load models and groups.</p>
            <button type="button" className={ghostBtn} onClick={data.retry}>Try again</button>
          </div>
        ) : !data.loaded ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : tab === "models" ? (
          <ModelsTab centerId={centerId} data={data} typeOptions={typeOptions} canManage={canManage} />
        ) : tab === "groups" ? (
          <GroupsTab centerId={centerId} data={data} typeOptions={typeOptions} canManage={canManage} />
        ) : (
          <LinkVehiclesTab centerId={centerId} models={data.models} />
        )}
      </div>
    </div>
  );
}
