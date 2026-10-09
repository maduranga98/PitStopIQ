import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ArrowLeft, Hammer } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { useWorkshopModules } from "../../hooks/useWorkshopModules";
import { useModelsAndGroups, useVehicleTypeOptions } from "../../hooks/useRepairModels";
import { useInventoryForParts, useRepairCatalog } from "../../hooks/useRepairCatalog";
import { canReadInventory } from "../../lib/repairCatalog/access.ts";
import RepairsTab from "../../components/repairCatalog/RepairsTab";
import TestVehicleTab from "../../components/repairCatalog/TestVehicleTab";
import { ghostBtn } from "../../components/repairCatalog/Sheet";

type Tab = "repairs" | "test";

/** The Repair Catalog (module off: redirects home and reads nothing). */
export default function RepairCatalogPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const centerId = currentUser?.centerId;
  const { repairCatalogEnabled, loading: flagLoading } = useWorkshopModules(centerId);
  const canCreate = usePermission("repairCatalog.create");
  const canEdit = usePermission("repairCatalog.edit");
  const canSeeParts = canReadInventory(currentUser?.role);

  const catalog = useRepairCatalog(centerId, repairCatalogEnabled);
  const mg = useModelsAndGroups(centerId, repairCatalogEnabled);
  const typeOptions = useVehicleTypeOptions(repairCatalogEnabled ? centerId : undefined);
  // Not read at all for a role that cannot read inventory.
  const inventory = useInventoryForParts(centerId, repairCatalogEnabled && canSeeParts);
  const [tab, setTab] = useState<Tab>("repairs");

  if (flagLoading) return <div className="min-h-screen bg-[#0B1120]" />;
  if (!repairCatalogEnabled || !centerId || !currentUser) return <Navigate to="/" replace />;

  const actor = { uid: currentUser.uid, name: currentUser.displayName || currentUser.email || "Staff" };
  const failed = catalog.error || mg.error;
  const ready = catalog.loaded && mg.loaded;

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <div className="border-b border-white/10 bg-[#0B1120]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg" aria-label="Back">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Hammer className="w-5 h-5 text-[#F97316]" />
          <h1 className="text-xl font-bold">Repairs</h1>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="flex gap-1 bg-[#0B1120] border border-white/10 rounded-xl p-1 w-fit">
          {([["repairs", "Repairs"], ["test", "Test a vehicle"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === k ? "bg-[#162032] text-white shadow" : "text-gray-400 hover:text-white"}`}>
              {label}
            </button>
          ))}
        </div>

        {failed ? (
          <div className="rounded-2xl border border-white/10 bg-[#162032] p-6 text-center space-y-3">
            <p className="text-sm text-gray-300">Couldn't load the repair catalog.</p>
            <button type="button" className={ghostBtn} onClick={() => { catalog.retry(); mg.retry(); }}>Try again</button>
          </div>
        ) : !ready ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : tab === "repairs" ? (
          <RepairsTab
            centerId={centerId} actor={actor} catalog={catalog} mg={mg} typeOptions={typeOptions}
            canCreate={canCreate} canEdit={canEdit} canSeeParts={canSeeParts} inventory={inventory}
          />
        ) : (
          <TestVehicleTab centerId={centerId} catalog={catalog} mg={mg} typeOptions={typeOptions} canSeeParts={canSeeParts} inventory={inventory} />
        )}
      </div>
    </div>
  );
}
