import { Outlet, useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { usePermissions } from "../../contexts/PermissionsContext";
import { LoadingScreen } from "../../components/LoadingProgress";
import { STORE_ADDON_LABEL } from "../../lib/subscription";
import type { StoreAddonKey } from "../../types/auth";

// Route-level guard for a purchasable Store add-on (Outlets/POS,
// Distributors). Unlike RequirePermission this isn't a role check — even the
// Owner is locked out until the add-on's payment slip is approved, since it's
// a billing gate, not an access-control one.
export function RequireStoreAddon({ addon }: { addon: StoreAddonKey }) {
  const { storeAddonsLoading, hasStoreAddon } = usePermissions();
  const navigate = useNavigate();

  if (storeAddonsLoading) {
    return <LoadingScreen expectedMs={1500} />;
  }

  if (hasStoreAddon(addon)) return <Outlet />;

  return (
    <div className="min-h-screen bg-[#0B1120] flex items-center justify-center px-4">
      <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
        <div className="w-12 h-12 rounded-full bg-orange-500/15 flex items-center justify-center mx-auto mb-4">
          <Lock className="w-6 h-6 text-orange-400" />
        </div>
        <h2 className="text-lg font-bold text-white mb-2">{STORE_ADDON_LABEL[addon]} is locked</h2>
        <p className="text-sm text-gray-400 mb-5">
          Purchase the {STORE_ADDON_LABEL[addon]} add-on from Settings → Subscription → Store to unlock this
          section.
        </p>
        <button
          onClick={() => navigate("/settings?tab=subscription&sub=store")}
          className="bg-[#F97316] hover:bg-[#ea6c0f] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition"
        >
          Go to Store
        </button>
      </div>
    </div>
  );
}
