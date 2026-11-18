import { useMemo, useState } from "react";
import { Building2, Check, ChevronDown, Star } from "lucide-react";
import { inputClass } from "./AdminModal";
import { saveServiceProfile, type AdminIdentity } from "../../lib/leads";
import {
  CALL_DIRECTIONS, CAME_VIA, CENTER_TYPES, CURRENT_METHODS, DAILY_VEHICLES, OBJECTIONS,
  OWNER_PRESENCE, PAIN_TAGS, STAFF_ROLES, VEHICLE_TYPES,
  blankServiceProfile, profileProgress,
  type Lead, type ObjectionKey, type PainTagKey, type ServiceCenterProfile,
} from "../../types/leads";

type Option = { readonly key: string; readonly label: string };

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-gray-400">{label}</p>
      {children}
    </div>
  );
}

/** Pill buttons for either a single choice or a set. Tapping a single choice again clears it. */
function Chips({ options, selected, onToggle }: {
  options: readonly Option[];
  selected: readonly string[];
  onToggle: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o.key);
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(o.key)}
            className={`px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
              on
                ? "bg-orange-500/15 text-orange-200 border-orange-500/50 font-medium"
                : "bg-gray-900 text-gray-400 border-gray-800 hover:text-gray-200 hover:border-gray-700"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const toggle = <T extends string>(list: readonly T[] | undefined, key: T): T[] => {
  const cur = list ?? [];
  return cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
};

/**
 * The Lead Card as a profile: the service center's type, vehicles, team, how
 * it runs today, what hurts and what is holding the owner back. One save
 * writes the whole profile, so a half-finished call leaves nothing half-saved.
 *
 * Shared by the Management drawer and the caller's drawer — the rules let a
 * caller write it on their own leads.
 */
export default function ServiceProfileSection({ lead, by }: { lead: Lead; by: AdminIdentity }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ServiceCenterProfile>(() => ({ ...blankServiceProfile(), ...(lead.serviceProfile ?? {}) }));
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(draft));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [justSaved, setJustSaved] = useState(false);

  const dirty = JSON.stringify(draft) !== savedJson;
  const progress = useMemo(() => profileProgress(draft), [draft]);

  const patch = (p: Partial<ServiceCenterProfile>) => { setDraft((d) => ({ ...d, ...p })); setJustSaved(false); };

  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    setError("");
    try {
      await saveServiceProfile(lead.id, draft, by);
      setSavedJson(JSON.stringify(draft));
      setJustSaved(true);
    } catch {
      setError("That didn't save. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const single = <K extends "callDirection" | "centerType" | "dailyVehicles" | "ownerPresence">(key: K) =>
    (k: string) => patch({ [key]: draft[key] === k ? "" : k } as Partial<ServiceCenterProfile>);

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
      >
        <Building2 className="w-4 h-4 text-orange-400 flex-shrink-0" />
        <span className="text-sm font-semibold text-white">Service center profile</span>
        <span className="ml-auto text-[11px] text-gray-500 tabular-nums">{progress.done}/{progress.total}</span>
        <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-5 border-t border-gray-800 pt-4">
          <Group label="Call">
            <Chips options={CALL_DIRECTIONS} selected={draft.callDirection ? [draft.callDirection] : []} onToggle={single("callDirection")} />
            <p className="text-[11px] text-gray-600 pt-1">Came via</p>
            <Chips options={CAME_VIA} selected={draft.cameVia ?? []} onToggle={(k) => patch({ cameVia: toggle(draft.cameVia, k as never) })} />
          </Group>

          <Group label="Center type">
            <Chips options={CENTER_TYPES} selected={draft.centerType ? [draft.centerType] : []} onToggle={single("centerType")} />
          </Group>

          <Group label="Vehicles they work on">
            <Chips options={VEHICLE_TYPES} selected={draft.vehicleTypes ?? []} onToggle={(k) => patch({ vehicleTypes: toggle(draft.vehicleTypes, k as never) })} />
            <p className="text-[11px] text-gray-600 pt-1">Vehicles per day</p>
            <Chips options={DAILY_VEHICLES} selected={draft.dailyVehicles ? [draft.dailyVehicles] : []} onToggle={single("dailyVehicles")} />
          </Group>

          <Group label="Staff">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {STAFF_ROLES.map((r) => (
                <label key={r.key} className="block">
                  <span className="block text-[11px] text-gray-500 mb-1">{r.label}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    className={inputClass}
                    value={draft.staff?.[r.key] ?? ""}
                    onChange={(e) => {
                      const next = { ...(draft.staff ?? {}) };
                      if (e.target.value === "") delete next[r.key];
                      else next[r.key] = Math.max(0, Number(e.target.value));
                      patch({ staff: next });
                    }}
                  />
                </label>
              ))}
            </div>
            <Chips options={OWNER_PRESENCE} selected={draft.ownerPresence ? [draft.ownerPresence] : []} onToggle={single("ownerPresence")} />
          </Group>

          <Group label="How they work today">
            <Chips options={CURRENT_METHODS} selected={draft.currentMethods ?? []} onToggle={(k) => patch({ currentMethods: toggle(draft.currentMethods, k as never) })} />
            {(draft.currentMethods ?? []).includes("software") && (
              <input
                className={inputClass}
                value={draft.softwareName ?? ""}
                onChange={(e) => patch({ softwareName: e.target.value })}
                placeholder="Which software?"
                maxLength={80}
              />
            )}
          </Group>

          <Group label="Main problems — tap the star on the biggest one">
            <ul className="space-y-1">
              {PAIN_TAGS.map((t) => {
                const on = (draft.painTags ?? []).includes(t.key);
                const main = draft.mainPain === t.key;
                return (
                  <li key={t.key} className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        const painTags = toggle<PainTagKey>(draft.painTags, t.key);
                        // Un-ticking the starred problem un-stars it.
                        patch({ painTags, mainPain: painTags.includes(draft.mainPain as PainTagKey) ? draft.mainPain : "" });
                      }}
                      className={`flex-1 min-w-0 flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs border text-left transition-colors ${
                        on
                          ? "bg-orange-500/10 text-orange-100 border-orange-500/40"
                          : "bg-gray-900 text-gray-400 border-gray-800 hover:text-gray-200"
                      }`}
                    >
                      <span className={`font-mono text-[10px] px-1 rounded ${on ? "bg-orange-500/20 text-orange-300" : "bg-gray-800 text-gray-500"}`}>{t.key}</span>
                      <span className="truncate">{t.label}</span>
                    </button>
                    <button
                      type="button"
                      disabled={!on}
                      aria-label={main ? `${t.key} is the main problem` : `Make ${t.key} the main problem`}
                      aria-pressed={main}
                      onClick={() => patch({ mainPain: main ? "" : t.key })}
                      className="p-1.5 rounded-lg disabled:opacity-20 hover:bg-gray-800 transition-colors"
                    >
                      <Star className={`w-4 h-4 ${main ? "fill-amber-400 text-amber-400" : "text-gray-600"}`} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </Group>

          <Group label="Objections">
            <Chips options={OBJECTIONS} selected={draft.objections ?? []} onToggle={(k) => patch({ objections: toggle<ObjectionKey>(draft.objections, k as ObjectionKey) })} />
          </Group>

          <Group label="Owner's own words">
            <textarea
              className={`${inputClass} min-h-[5rem]`}
              value={draft.ownerWords ?? ""}
              onChange={(e) => patch({ ownerWords: e.target.value })}
              placeholder="Exact phrases, names, dates — marketing gold"
              maxLength={4000}
            />
          </Group>

          {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:hover:bg-orange-500 text-white transition-colors"
            >
              <Check className="w-4 h-4" /> {saving ? "Saving…" : "Save profile"}
            </button>
            {justSaved && !dirty && <span className="text-xs text-emerald-400">Saved</span>}
            {!justSaved && lead.profileUpdatedByName && (
              <span className="text-[11px] text-gray-600 truncate">Last updated by {lead.profileUpdatedByName}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
