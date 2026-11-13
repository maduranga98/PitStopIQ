import { useMemo } from "react";
import { CalendarClock } from "lucide-react";
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
export default function UpcomingDemos({ leads, onOpen }: { leads: Lead[]; onOpen: (leadId: string) => void }) {
  const days = useMemo(() => {
    const t = today();
    const byLead = new Map(leads.map((l) => [l.id, l]));
    const map = new Map<string, { slot: ReturnType<typeof collectDemoSlots>[number]; lead?: Lead }[]>();
    for (const slot of collectDemoSlots(leads)) {
      if (slot.date < t) continue;
      map.set(slot.date, [...(map.get(slot.date) ?? []), { slot, lead: byLead.get(slot.leadId) }]);
    }
    return [...map.entries()];
  }, [leads]);

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-white flex items-center gap-2">
        <CalendarClock className="w-4 h-4 text-violet-400" /> Upcoming demos
      </h2>
      {days.length === 0 ? (
        <p className="text-xs text-gray-600 mt-3">No demos booked.</p>
      ) : (
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 max-h-72 overflow-y-auto pr-1">
          {days.map(([date, rows]) => (
            <div key={date}>
              <p className="text-xs font-medium text-gray-400 mb-1.5">{dayLabel(date)}</p>
              <ul className="space-y-1.5">
                {rows.map(({ slot, lead }) => (
                  <li key={slot.leadId}>
                    <button
                      type="button"
                      onClick={() => onOpen(slot.leadId)}
                      title={formatDemoSlot(slot.date, slot.time)}
                      className="w-full flex items-center gap-3 text-left rounded-lg px-3 py-2 bg-gray-950 border border-gray-800 hover:border-gray-600 transition-colors"
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
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
