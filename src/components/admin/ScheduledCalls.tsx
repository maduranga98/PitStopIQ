import { useMemo } from "react";
import { PhoneCall, XCircle } from "lucide-react";
import CollapsibleSection from "./CollapsibleSection";
import { clearNextCall } from "../../lib/leads";
import type { Lead } from "../../types/leads";

const when = (ts?: { toDate: () => Date } | null) =>
  ts
    ? ts.toDate().toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";

/** Calls booked for later, soonest first, overdue ones flagged. */
export default function ScheduledCalls({ leads, onOpen }: { leads: Lead[]; onOpen: (leadId: string) => void }) {
  const calls = useMemo(
    () => leads
      .filter((l) => l.nextCallAt && !l.isDeleted)
      .sort((a, b) => (a.nextCallAt!.seconds ?? 0) - (b.nextCallAt!.seconds ?? 0)),
    [leads],
  );
  const now = Date.now();

  return (
    <CollapsibleSection
      icon={<PhoneCall className="w-4 h-4 text-sky-400" />}
      title="Calls"
      count={calls.length}
    >
      {calls.length === 0 ? (
        <p className="text-xs text-gray-600">No calls scheduled.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-72 overflow-y-auto pr-1">
          {calls.map((l) => {
            const late = (l.nextCallAt?.toDate?.().getTime() ?? now) < now;
            return (
              <li key={l.id} className={`flex items-center gap-2 rounded-lg bg-gray-950 border ${late ? "border-red-500/30" : "border-gray-800"}`}>
                <button
                  type="button"
                  onClick={() => onOpen(l.id)}
                  className="flex-1 min-w-0 text-left px-3 py-2 hover:bg-gray-900 rounded-lg transition-colors"
                >
                  <span className="block text-sm text-gray-200 truncate">{l.businessName}</span>
                  <span className={`block text-[11px] truncate ${late ? "text-red-300" : "text-sky-300"}`}>
                    {late ? "Overdue · " : ""}{when(l.nextCallAt)}
                    {l.assignedToName ? ` · ${l.assignedToName}` : ""}
                  </span>
                  {l.nextCallNote && <span className="block text-[11px] text-gray-600 truncate">{l.nextCallNote}</span>}
                </button>
                <button
                  type="button"
                  onClick={() => clearNextCall(l.id)}
                  title="Clear this call"
                  className="p-1.5 mr-1 rounded-lg text-gray-600 hover:text-red-300 hover:bg-gray-800 transition-colors"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </CollapsibleSection>
  );
}
