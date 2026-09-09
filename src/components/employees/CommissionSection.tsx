// Commission setup for one employee — the Owner-facing half of the optional
// commission module. Only mounted when the center has `commissionEnabled`,
// and only for the Owner: what someone gets paid sits with role management,
// which firestore.rules already keeps to the Owner alone.
import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { Wallet, ChevronDown, ChevronRight, Search, Check, X } from "lucide-react";
import { db } from "../../config/firebase";
import { fetchActiveStaff, fetchServicePrices } from "../../lib/refData";
import { safeUpdateDoc } from "../../lib/firestoreWrite";
import { DEFAULT_VEHICLE_TYPES } from "../../lib/vehicleOptions";
import { uniqueServiceNames } from "../../lib/servicePricing";
import { emptyCommission, emptyRate } from "../../lib/commission";
import { staffDisplayName } from "../../lib/jobTechnicians";
import type {
  CommissionRate, CommissionRole, ServicePriceItem, StaffCommission, StaffMember,
} from "../../types/auth";

const ROLE_OPTIONS: { value: CommissionRole; label: string; hint: string }[] = [
  { value: "technician", label: "Technician", hint: "Earns on the services they perform" },
  { value: "trainer", label: "Trainer", hint: "Earns their own work, plus an override on their trainees'" },
  { value: "supervisor", label: "Supervisor", hint: "Earns an override on the work of everyone reporting to them" },
];

/**
 * A percentage input, or the flat per-vehicle-type grid — the same either/or
 * the service catalog already uses for prices. A fixed rate is never scaled by
 * the service's price: it is a flat LKR amount that varies only by vehicle.
 */
function RateEditor({ rate, vehicleTypes, onChange }: {
  rate: CommissionRate | null;
  vehicleTypes: string[];
  onChange: (next: CommissionRate | null) => void;
}) {
  if (!rate) {
    return (
      <div className="flex gap-2">
        <button
          onClick={() => onChange(emptyRate("percentage"))}
          className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 rounded-lg py-2 text-sm"
        >
          Set a percentage
        </button>
        <button
          onClick={() => onChange(emptyRate("fixed"))}
          className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 rounded-lg py-2 text-sm"
        >
          Set a fixed amount
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg overflow-hidden border border-white/10">
          {(["percentage", "fixed"] as const).map((type) => (
            <button
              key={type}
              onClick={() => rate.type !== type && onChange(emptyRate(type))}
              className={`px-3 py-1.5 text-xs capitalize ${
                rate.type === type ? "bg-orange-500 text-white" : "bg-white/5 text-gray-400 hover:text-white"
              }`}
            >
              {type === "percentage" ? "Percentage" : "Fixed (LKR)"}
            </button>
          ))}
        </div>
        <button
          onClick={() => onChange(null)}
          className="ml-auto text-xs text-gray-500 hover:text-red-400 flex items-center gap-1"
        >
          <X className="w-3 h-3" /> Clear
        </button>
      </div>

      {rate.type === "percentage" ? (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            max="100"
            step="0.5"
            value={rate.percentage ?? 0}
            onChange={(e) => onChange({ ...rate, percentage: parseFloat(e.target.value) || 0 })}
            className="w-24 bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
          />
          <span className="text-sm text-gray-400">% of the service price</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {vehicleTypes.map((type) => (
            <label key={type} className="block">
              <span className="block text-[11px] text-gray-500 mb-1 capitalize truncate">{type}</span>
              <input
                type="number"
                min="0"
                value={rate.valueByVehicleType?.[type] ?? ""}
                placeholder="0"
                onChange={(e) => onChange({
                  ...rate,
                  valueByVehicleType: {
                    ...(rate.valueByVehicleType ?? {}),
                    [type]: parseFloat(e.target.value) || 0,
                  },
                })}
                className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-orange-500"
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CommissionSection({ centerId, staff }: {
  centerId: string;
  staff: StaffMember;
}) {
  // Edited locally and saved in one go, so half a rate is never written. Seeded
  // once from the staff doc: the caller mounts this under `key={staff.id}`, so
  // opening a different employee starts fresh, while the live snapshot behind
  // this page can't wipe an edit in progress.
  const [draft, setDraft] = useState<StaffCommission | null>(staff.commission ?? null);
  const [colleagues, setColleagues] = useState<StaffMember[]>([]);
  const [catalog, setCatalog] = useState<ServicePriceItem[]>([]);
  const [customTypes, setCustomTypes] = useState<string[]>([]);
  const [serviceSearch, setServiceSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchActiveStaff(centerId)
      .then(setColleagues)
      .catch(() => { /* non-fatal — "reports to" simply offers nobody */ });
    fetchServicePrices(centerId)
      .then(setCatalog)
      .catch(() => { /* non-fatal — only the default rate can be set */ });
    getDoc(doc(db, "servicecenters", centerId))
      .then((snap) => setCustomTypes((snap.data()?.customVehicleTypes as string[]) ?? []))
      .catch(() => { /* non-fatal — the built-in types still work */ });
  }, [centerId]);

  const vehicleTypes = useMemo(() => {
    const set = new Set<string>([...DEFAULT_VEHICLE_TYPES, ...customTypes]);
    catalog.forEach((c) => { if (c.vehicleType) set.add(c.vehicleType); });
    return Array.from(set).sort();
  }, [customTypes, catalog]);

  // Only a trainer or supervisor can be reported to, and nobody reports to
  // themselves — that would earn an override on their own work.
  const supervisorOptions = useMemo(
    () => colleagues.filter(
      (c) => c.id !== staff.id
        && (c.commission?.role === "trainer" || c.commission?.role === "supervisor"),
    ),
    [colleagues, staff.id],
  );

  // Service names carrying an override, plus whatever the search turns up.
  const serviceNames = useMemo(() => uniqueServiceNames(catalog).sort(), [catalog]);
  const overriddenNames = useMemo(
    () => Object.keys(draft?.serviceRates ?? {}).sort(),
    [draft],
  );
  const searchResults = useMemo(() => {
    const q = serviceSearch.trim().toLowerCase();
    if (!q) return [];
    return serviceNames
      .filter((n) => n.toLowerCase().includes(q) && !(draft?.serviceRates?.[n]))
      .slice(0, 8);
  }, [serviceSearch, serviceNames, draft]);

  function patch(next: Partial<StaffCommission>) {
    setDraft((prev) => (prev ? { ...prev, ...next } : { ...emptyCommission(), ...next }));
  }

  function setServiceRate(name: string, rate: CommissionRate | null) {
    setDraft((prev) => {
      if (!prev) return prev;
      const rates = { ...prev.serviceRates };
      if (rate) rates[name] = rate; else delete rates[name];
      return { ...prev, serviceRates: rates };
    });
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      // A supervisor with nobody reporting to them still saves fine — they
      // simply earn nothing until someone points at them.
      await safeUpdateDoc(doc(db, "servicecenters", centerId, "staff", staff.id), {
        commission: draft,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Couldn't save. Commission setup is Owner-only — check you're signed in as the Owner.");
    }
    setSaving(false);
  }

  const enabled = draft?.enabled === true;

  return (
    <div className="bg-[#162032] border border-white/10 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <Wallet className="w-5 h-5 text-[#F97316] flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white">Commission</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              What {staff.fullName || "this employee"} earns per service performed.
            </p>
          </div>
        </div>
        <button
          onClick={() => (enabled ? patch({ enabled: false }) : setDraft(emptyCommission()))}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
            enabled ? "bg-[#F97316]" : "bg-white/10"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
              enabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {enabled && draft && (
        <div className="space-y-5 border-t border-white/5 pt-4">
          {/* Role */}
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold block mb-2">Role</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {ROLE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => patch({ role: opt.value })}
                  className={`text-left px-3 py-2 rounded-lg border transition-colors ${
                    draft.role === opt.value
                      ? "bg-orange-500/10 border-orange-500 text-orange-300"
                      : "bg-white/5 border-white/10 text-gray-300 hover:border-white/30"
                  }`}
                >
                  <span className="block text-sm font-medium">{opt.label}</span>
                  <span className="block text-[11px] text-gray-500 mt-0.5">{opt.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Reports to */}
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold block mb-2">
              Reports to <span className="text-gray-600 font-normal normal-case">(optional)</span>
            </label>
            <select
              value={draft.reportsTo ?? ""}
              onChange={(e) => patch({ reportsTo: e.target.value || null })}
              className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
            >
              <option value="">Nobody</option>
              {supervisorOptions.map((c) => (
                <option key={c.id} value={c.id}>{staffDisplayName(c)}</option>
              ))}
            </select>
            <p className="text-[11px] text-gray-500 mt-1.5">
              Their override is an extra entry on top of this person's — never a share of it.
              {supervisorOptions.length === 0 && " Nobody is set up as a trainer or supervisor yet."}
            </p>
          </div>

          {/* Default rate */}
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold block mb-2">
              Default rate
            </label>
            <RateEditor
              rate={draft.defaultRate}
              vehicleTypes={vehicleTypes}
              onChange={(next) => patch({ defaultRate: next })}
            />
            <p className="text-[11px] text-gray-500 mt-1.5">
              Applies to every service without its own rate below. With none set, only the services
              listed below earn anything.
            </p>
          </div>

          {/* Per-service overrides */}
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold block mb-2">
              Service-specific rates
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={serviceSearch}
                onChange={(e) => setServiceSearch(e.target.value)}
                placeholder="Search services to add a rate…"
                className="w-full bg-white/5 border border-white/10 text-white rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-orange-500"
              />
              {searchResults.length > 0 && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-[#0B1120] border border-white/10 rounded-lg overflow-hidden">
                  {searchResults.map((name) => (
                    <button
                      key={name}
                      onClick={() => {
                        setServiceRate(name, emptyRate(draft.defaultRate?.type ?? "percentage"));
                        setExpanded(name);
                        setServiceSearch("");
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-white hover:bg-white/5"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {overriddenNames.length === 0 ? (
              <p className="text-[11px] text-gray-500 mt-2">
                No service-specific rates — everything follows the default above.
              </p>
            ) : (
              <div className="space-y-2 mt-2">
                {overriddenNames.map((name) => (
                  <div key={name} className="bg-white/5 border border-white/10 rounded-lg">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <button
                        onClick={() => setExpanded(expanded === name ? null : name)}
                        className="flex items-center gap-1.5 text-sm text-white min-w-0 flex-1 text-left"
                      >
                        {expanded === name
                          ? <ChevronDown className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                          : <ChevronRight className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />}
                        <span className="truncate">{name}</span>
                      </button>
                      <span className="text-xs text-gray-500 flex-shrink-0">
                        {draft.serviceRates[name].type === "percentage"
                          ? `${draft.serviceRates[name].percentage ?? 0}%`
                          : "Fixed"}
                      </span>
                      <button
                        onClick={() => setServiceRate(name, null)}
                        className="text-gray-600 hover:text-red-400 flex-shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {expanded === name && (
                      <div className="px-3 pb-3 border-t border-white/5 pt-3">
                        <RateEditor
                          rate={draft.serviceRates[name]}
                          vehicleTypes={vehicleTypes}
                          onChange={(next) => setServiceRate(name, next ?? emptyRate("percentage"))}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center gap-3 border-t border-white/5 pt-4">
        <button
          onClick={save}
          disabled={saving}
          className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          {saving ? "Saving…" : "Save commission setup"}
        </button>
        {saved && (
          <span className="text-xs text-green-400 flex items-center gap-1">
            <Check className="w-3.5 h-3.5" /> Saved
          </span>
        )}
      </div>
    </div>
  );
}
