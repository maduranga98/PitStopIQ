import { useState } from "react";
import { CalendarClock, Check } from "lucide-react";
import { inputClass } from "../admin/AdminModal";
import { scheduleLeadDemo, type AdminIdentity } from "../../lib/leads";
import { useDemoSlotsForDate } from "../../hooks/useDemoSlotsForDate";
import { DEMO_CLASH_MINUTES, DEMO_DURATION_MINUTES, DEMO_SLOT_TIMES, demoLabel, demoMinutes, demoWindowLabel, type Lead } from "../../types/leads";

const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const timeLabel = (t: string) => {
  const m = demoMinutes(t) ?? 0;
  return new Date(0, 0, 1, Math.floor(m / 60), m % 60).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};

/**
 * Pick a demo day and time for a lead. Slots another caller (or an admin) has
 * already claimed are greyed out and can't be tapped; the lead's own current
 * slot is marked so a move is obvious. The rules enforce the same thing, so a
 * slot taken a second ago still can't be double-booked.
 */
export default function CallerDemoBooking({ lead, me }: { lead: Lead; me: AdminIdentity }) {
  const today = isoDate(new Date());
  const [date, setDate] = useState(lead.demoDate || today);
  const [time, setTime] = useState(lead.demoTime || "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const taken = useDemoSlotsForDate(date);
  const closed = lead.stage === "won" || lead.stage === "lost";

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const isPast = (t: string) => date < today || (date === today && (demoMinutes(t) ?? 0) <= nowMinutes);
  const isMine = (t: string) => taken.get(t)?.leadId === lead.id;
  // A demo is 45 minutes plus a gap, so a slot is also unavailable when it
  // starts too close to someone else's — not only when it is the same minute.
  const tooClose = (t: string) => {
    const m = demoMinutes(t);
    if (m === null) return false;
    for (const s of taken.values()) {
      if (s.leadId === lead.id) continue;
      const other = demoMinutes(s.time);
      if (other !== null && Math.abs(other - m) < DEMO_CLASH_MINUTES) return true;
    }
    return false;
  };
  const blocked = (t: string) => isPast(t) || tooClose(t);
  const unchanged = lead.demoDate === date && lead.demoTime === time;
  const ready = Boolean(date && time && note.trim() && !blocked(time) && !unchanged);

  async function book() {
    if (!ready || saving) return;
    setSaving(true);
    setError("");
    try {
      await scheduleLeadDemo(lead, { date, time, note }, me);
      setNote("");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error && err.message.length < 120 ? err.message : "Couldn't book the demo. Try again.");
      setTime("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-white flex items-center gap-2">
        <CalendarClock className="w-4 h-4 text-violet-400" /> {lead.demoDate ? "Demo booked" : "Book a demo"}
      </h3>
      {demoLabel(lead) && <p className="text-xs text-violet-300">Currently {demoLabel(lead)}</p>}

      {closed ? (
        <p className="text-xs text-gray-600">This lead is closed — no demo to book.</p>
      ) : (
        <>
          <input
            type="date"
            className={inputClass}
            min={today}
            value={date}
            onChange={(e) => { setDate(e.target.value); setTime(""); setDone(false); }}
          />
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5" role="group" aria-label="Demo time">
            {DEMO_SLOT_TIMES.map((t) => {
              const off = blocked(t);
              const selected = time === t;
              return (
                <button
                  key={t}
                  type="button"
                  disabled={off}
                  aria-pressed={selected}
                  onClick={() => { setTime(t); setDone(false); }}
                  className={`py-2 rounded-lg text-xs border transition-colors ${
                    selected
                      ? "bg-violet-500/20 text-violet-200 border-violet-500/50 font-medium"
                      : off
                        ? "bg-gray-950 text-gray-700 border-gray-900 line-through cursor-not-allowed"
                        : "bg-gray-950 text-gray-300 border-gray-800 hover:border-gray-600"
                  }`}
                >
                  {timeLabel(t)}
                  {!isPast(t) && !isMine(t) && tooClose(t) && (
                    <span className="block text-[9px] no-underline text-gray-600">{taken.has(t) ? "Booked" : "Too close"}</span>
                  )}
                  {isMine(t) && <span className="block text-[9px] text-violet-400">Yours</span>}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-gray-600">
            {time ? `Meeting runs ${demoWindowLabel(time)}` : `Each demo is ${DEMO_DURATION_MINUTES} minutes`}
          </p>
          <textarea
            className={`${inputClass} min-h-[4rem]`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="How it was confirmed — who'll attend, what they want to see"
          />
          {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
          {done && !error && <p className="text-xs text-emerald-400">Demo booked.</p>}
          <button
            type="button"
            onClick={() => void book()}
            disabled={!ready || saving}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white transition-colors"
          >
            <Check className="w-4 h-4" /> {saving ? "Booking…" : lead.demoDate ? "Move demo" : "Book demo"}
          </button>
        </>
      )}
    </div>
  );
}
