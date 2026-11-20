import { useMemo } from "react";
import { CalendarClock, Check, X } from "lucide-react";
import CollapsibleSection from "./CollapsibleSection";
import { STAGE_META, collectDemoSlots, formatDemoSlot, type Lead } from "../../types/leads";

const pad = (n: number) => String(n).padStart(2, "0");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const timeLabel = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h)) return "—";
  return new Date(0, 0, 1, h, m || 0).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};

const dayLabel = (date: string) => {
  const d = new Date(`${date}T00:00:00`);
  const label = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return date === today() ? `Today · ${label}` : label;
};

/**
 * Every demo booked from today on, grouped by day, with who booked it. The
 * super admin's agenda: callers book slots themselves, so this is where the
 * whole schedule is read at a glance.
 */
export default function UpcomingDemos({ leads, onOpen, onClose }: {
  leads: Lead[];
  onOpen: (leadId: string) => void;
  /** Close a demo as given ("done") or take it off the schedule ("cancel"). */
  onClose: (lead: Lead, mode: "done" | "cancel") => void;
}) {
  const days = useMemo(() => {
    const t = today();
    const byLead = new Map(leads.map((l) => [l.id, l]));
    const map = new Map<string, { slot: ReturnType<typeof collectDemoSlots>[number]; lead?: Lead }[]>();
    for (const slot of collectDemoSlots(leads)) {
      if (slot.date < t) continue;
      // A demo already given (or a lead already closed) is not upcoming.
      const stage = byLead.get(slot.leadId)?.stage;
      if (stage === "demo_done" || stage === "won" || stage === "lost") continue;
      map.set(slot.date, [...(map.get(slot.date) ?? []), { slot, lead: byLead.get(slot.leadId) }]);
    }
    return [...map.entries()];
  }, [leads]);

  return (
    <CollapsibleSection
      icon={<CalendarClock className="w-4 h-4 text-violet-400" />}
      title="Upcoming demos"
      count={days.reduce((n, [, rows]) => n + rows.length, 0)}
    >
      {days.length === 0 ? (
        <p className="text-xs text-gray-600">No demos booked.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 max-h-72 overflow-y-auto pr-1">
          {days.map(([date, rows]) => (
            <div key={date}>
              <p className="text-xs font-medium text-gray-400 mb-1.5">{dayLabel(date)}</p>
              <ul className="space-y-1.5">
                {rows.map(({ slot, lead }) => (
                  <li key={slot.leadId} className="flex items-center gap-1 rounded-lg bg-gray-950 border border-gray-800 hover:border-gray-600 transition-colors">
                    <button
                      type="button"
                      onClick={() => onOpen(slot.leadId)}
                      title={formatDemoSlot(slot.date, slot.time)}
                      className="flex-1 min-w-0 flex items-center gap-3 text-left rounded-lg px-3 py-2"
                    >
                      <span className="text-xs font-mono text-violet-300 flex-shrink-0 w-16">{timeLabel(slot.time)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-gray-200 truncate">{slot.businessName}</span>
                        <span className="block text-[11px] text-gray-600 truncate">
                          {[lead?.demoConfirmedByName && `Booked by ${lead.demoConfirmedByName}`,
                            lead?.assignedToName && lead.assignedToName !== lead.demoConfirmedByName && `Caller ${lead.assignedToName}`]
                            .filter(Boolean).join(" · ") || slot.contactName || ""}
                        </span>
                      </span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full text-white flex-shrink-0 ${STAGE_META[slot.stage].headerBg}`}>
                        {STAGE_META[slot.stage].label}
                      </span>
                    </button>
                    {lead && (
                      <span className="flex flex-shrink-0 pr-1">
                        <button
                          type="button"
                          onClick={() => onClose(lead, "done")}
                          title="Close — demo done"
                          className="p-1.5 rounded-lg text-gray-600 hover:text-green-400 hover:bg-gray-800 transition-colors"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onClose(lead, "cancel")}
                          title="Remove this demo"
                          className="p-1.5 rounded-lg text-gray-600 hover:text-red-300 hover:bg-gray-800 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </CollapsibleSection>
  );
}
