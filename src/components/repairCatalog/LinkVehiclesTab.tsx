import { useEffect, useMemo, useState } from "react";
import { ghostBtn, primaryBtn } from "./Sheet";
import { fetchVehicles } from "../../lib/refData";
import { suggestLinks } from "../../lib/repairCatalog/linking.ts";
import { modelLabel } from "../../lib/repairCatalog/keys.ts";
import { linkVehicleToModel } from "../../lib/repairCatalog/writes";
import type { Vehicle } from "../../types/auth";
import type { VehicleModel } from "../../types/repairCatalog";

const PAGE = 25;

interface Props { centerId: string; models: VehicleModel[] }

/**
 * Review screen for linking existing vehicles to models. Every suggestion is a
 * proposal: a vehicle is only linked when the owner taps Link on that row.
 */
export default function LinkVehiclesTab({ centerId, models }: Props) {
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(PAGE);

  useEffect(() => {
    let active = true;
    fetchVehicles(centerId)
      .then((v) => { if (active) setVehicles(v); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [centerId]);

  const suggestions = useMemo(
    () => (vehicles ? suggestLinks(vehicles, models).filter((s) => !linked.has(s.vehicle.id) && !skipped.has(s.vehicle.id)) : []),
    [vehicles, models, linked, skipped],
  );
  const unlinked = vehicles ? vehicles.filter((v) => !v.modelId && !linked.has(v.id)).length : 0;

  async function link(vehicleId: string, modelId: string) {
    setBusyId(vehicleId);
    setError("");
    try {
      await linkVehicleToModel(centerId, vehicleId, modelId);
      setLinked((p) => new Set(p).add(vehicleId));
    } catch {
      setError("Couldn't link that vehicle. Try again.");
    }
    setBusyId(null);
  }

  if (failed) return <p className="text-sm text-red-400">Couldn't load vehicles. Check your connection and reopen this tab.</p>;
  if (!vehicles) return <p className="text-sm text-gray-500">Loading vehicles…</p>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Vehicles saved before models existed only have make and model typed as text. Where that text matches a model in
        your list, it is suggested below. Nothing is linked until you tap <strong className="text-gray-300">Link</strong> on that vehicle.
      </p>
      <p className="text-xs text-gray-500">
        {unlinked} vehicle{unlinked === 1 ? "" : "s"} not linked · {suggestions.length} suggestion{suggestions.length === 1 ? "" : "s"}
        {linked.size > 0 ? ` · ${linked.size} linked just now` : ""}
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {suggestions.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-[#162032] p-8 text-center">
          <p className="text-sm text-gray-300">No suggestions to review.</p>
          <p className="text-xs text-gray-500 mt-1">Add the models your customers drive, and matching vehicles will show up here.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {suggestions.slice(0, visible).map(({ vehicle: v, model: m, typeMismatch }) => (
            <li key={v.id} className="rounded-xl border border-white/10 bg-[#162032] px-4 py-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white truncate">{v.plateNumber}</p>
                <p className="text-xs text-gray-400 truncate">
                  “{[v.make, v.model].filter(Boolean).join(" ")}” → <span className="text-orange-200">{modelLabel(m)}</span>
                </p>
                {typeMismatch && (
                  <p className="text-[11px] text-amber-300 mt-0.5">Vehicle type is “{v.vehicleType}”, the model is “{m.vehicleType}”. The vehicle's type is left as it is.</p>
                )}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button type="button" className={ghostBtn} onClick={() => setSkipped((p) => new Set(p).add(v.id))}>Skip</button>
                <button type="button" className={primaryBtn} disabled={busyId === v.id} onClick={() => link(v.id, m.id)}>
                  {busyId === v.id ? "…" : "Link"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {suggestions.length > visible && (
        <button type="button" className={`${ghostBtn} w-full`} onClick={() => setVisible((n) => n + PAGE)}>
          Show more ({suggestions.length - visible} left)
        </button>
      )}
    </div>
  );
}
