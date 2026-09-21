import { useMemo, useState } from "react";
import { CalendarClock, AlertTriangle, Check, Clock, Users } from "lucide-react";
import AdminModal, { Field, inputClass } from "./AdminModal";
import { scheduleLeadDemo } from "../../lib/leads";
import type { AdminIdentity } from "../../lib/leads";
import {
  DEMO_CLASH_MINUTES, STAGE_META, collectDemoSlots, demoMinutes, formatDemoSlot,
  type DemoSlot, type Lead,
} from "../../types/leads";

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** The hours demos actually get given in — one tap instead of a time spinner. */
const QUICK_TIMES = ["09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:30"];

const dayLabel = (date: string) => {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
};

const timeLabel = (time: string) => {
  const mins = demoMinutes(time);
  if (mins === null) return time || "—";
  const d = new Date(0, 0, 1, Math.floor(mins / 60), mins % 60);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};

function SlotRow({ slot, clash }: { slot: DemoSlot; clash: boolean }) {
  return (
    <li
      className={`flex items-center gap-3 rounded-lg px-3 py-2 border ${
        clash ? "bg-amber-500/10 border-amber-500/40" : "bg-gray-950 border-gray-800"
      }`}
    >
      <span className={`text-xs font-mono flex-shrink-0 ${clash ? "text-amber-300" : "text-gray-400"}`}>
        {timeLabel(slot.time)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-gray-200 truncate">{slot.businessName}</span>
        {slot.contactName && (
          <span className="block text-xs text-gray-600 truncate">{slot.contactName}</span>
        )}
      </span>
      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full text-white flex-shrink-0 ${STAGE_META[slot.stage].headerBg}`}>
        {STAGE_META[slot.stage].label}
      </span>
    </li>
  );
}

/**
 * Book a demo, or move one that is already booked.
 *
 * The point of the dialog is the right-hand column: every other demo already
 * promised, with the chosen day pulled to the top, so a slot is given knowing
 * what it sits next to. A demo within an hour of one already booked is
 * flagged rather than blocked — two on the same afternoon is a judgement
 * call, not an error.
 *
 * Nothing is written until the note is typed: the note is the confirmation,
 * and it lands in the lead's history with the slot it confirms.
 */
export default function DemoScheduleModal({
  lead, leads, admin, onClose,
}: {
  lead: Lead;
  /** The board, for the demos already booked against the other leads. */
  leads: Lead[];
  admin: AdminIdentity;
  onClose: () => void;
}) {
  const [date, setDate] = useState(lead.demoDate || todayISO());
  const [time, setTime] = useState(lead.demoTime || "10:00");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const rescheduling = Boolean(lead.demoDate);

  // Every booked demo but this lead's own, split into the chosen day and
  // what is coming after it. Past demos are dropped: the question being
  // answered is "what else is promised", not "what happened".
  const { sameDay, upcoming } = useMemo(() => {
    const today = todayISO();
    const all = collectDemoSlots(leads).filter((s) => s.leadId !== lead.id);
    return {
      sameDay: all.filter((s) => s.date === date),
      upcoming: all.filter((s) => s.date !== date && s.date >= today).slice(0, 25),
    };
  }, [leads, lead.id, date]);

  const picked = demoMinutes(time);
  const clashes = useMemo(
    () =>
      picked === null
        ? []
        : sameDay.filter((s) => s.minutes !== null && Math.abs(s.minutes - picked) < DEMO_CLASH_MINUTES),
    [sameDay, picked],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, DemoSlot[]>();
    for (const s of upcoming) map.set(s.date, [...(map.get(s.date) ?? []), s]);
    return [...map.entries()];
  }, [upcoming]);

  const ready = Boolean(date && picked !== null && note.trim());

  async function confirm() {
    if (saving || !ready) return;
    setSaving(true);
    setError("");
    try {
      await scheduleLeadDemo(lead, { date, time, note }, admin);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error && err.message.length < 120
          ? err.message
          : "Couldn't save the demo. Check the connection and try again.",
      );
      setSaving(false);
    }
  }

  return (
    <AdminModal
      title={rescheduling ? "Move the demo" : "Book a demo"}
      icon={<CalendarClock className="w-4 h-4 text-violet-400" />}
      onClose={onClose}
      size="xl"
      footer={
        <>
          <span className="mr-auto text-xs text-gray-600 truncate">
            {picked !== null && date ? formatDemoSlot(date, time) : "Pick a date and a time"}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!ready || saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:hover:bg-violet-600 text-white transition-colors"
          >
            <Check className="w-4 h-4" />
            {saving ? "Saving…" : "Confirm demo"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Pick the slot ─────────────────────────────────────────────── */}
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-white truncate">{lead.businessName}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {[lead.contactName, lead.phone].filter(Boolean).join(" · ") || "No contact recorded"}
            </p>
            {rescheduling && (
              <p className="text-xs text-violet-300 mt-2">
                Booked now for {formatDemoSlot(lead.demoDate, lead.demoTime)}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input
                type="date"
                className={inputClass}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="Time">
              <input
                type="time"
                className={inputClass}
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </Field>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {QUICK_TIMES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTime(t)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  time === t
                    ? "bg-violet-500/20 text-violet-200 border border-violet-500/40"
                    : "bg-gray-950 border border-gray-800 text-gray-500 hover:text-gray-300"
                }`}
              >
                {timeLabel(t)}
              </button>
            ))}
          </div>

          {clashes.length > 0 && (
            <div className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-200">
                {clashes.length === 1 ? "A demo is" : `${clashes.length} demos are`} already booked
                within the hour — {clashes.map((c) => `${timeLabel(c.time)} ${c.businessName}`).join(", ")}.
                Book it anyway if that works.
              </p>
            </div>
          )}

          <Field
            label="Confirmation note *"
            hint="What was agreed — who will be there, what they want to see, how it was confirmed."
          >
            <textarea
              className={`${inputClass} min-h-[110px] resize-y`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Confirmed on WhatsApp with Nimal. Wants the job card and invoice flow shown."
            />
          </Field>

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        {/* ── What else is booked ───────────────────────────────────────── */}
        <div className="space-y-4 lg:border-l lg:border-gray-800 lg:pl-6">
          <div>
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-2">
              <Clock className="w-3.5 h-3.5" /> {dayLabel(date)}
            </h4>
            {sameDay.length === 0 ? (
              <p className="text-xs text-gray-600 mt-2 border border-dashed border-gray-800 rounded-lg py-4 text-center">
                Nothing else booked this day.
              </p>
            ) : (
              <ul className="space-y-1.5 mt-2">
                {sameDay.map((s) => (
                  <SlotRow
                    key={s.leadId}
                    slot={s}
                    clash={
                      picked !== null && s.minutes !== null &&
                      Math.abs(s.minutes - picked) < DEMO_CLASH_MINUTES
                    }
                  />
                ))}
              </ul>
            )}
          </div>

          <div>
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-2">
              <Users className="w-3.5 h-3.5" /> Other demos coming up
            </h4>
            {byDay.length === 0 ? (
              <p className="text-xs text-gray-600 mt-2 border border-dashed border-gray-800 rounded-lg py-4 text-center">
                No other demos are booked.
              </p>
            ) : (
              <div className="space-y-3 mt-2 max-h-64 overflow-y-auto pr-1">
                {byDay.map(([day, slots]) => (
                  <div key={day}>
                    <button
                      type="button"
                      onClick={() => setDate(day)}
                      title="Show this day"
                      className="text-xs text-gray-500 hover:text-orange-400 transition-colors mb-1.5"
                    >
                      {dayLabel(day)} · {slots.length}
                    </button>
                    <ul className="space-y-1.5">
                      {slots.map((s) => <SlotRow key={s.leadId} slot={s} clash={false} />)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminModal>
  );
}
