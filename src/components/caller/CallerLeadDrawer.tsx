import { useEffect, useState } from "react";
import { limit, orderBy, query } from "firebase/firestore";
import { X, Phone, MapPin, Mail, PhoneCall, CalendarClock, Wallet, History as HistoryIcon, MessageCircle, Lock } from "lucide-react";
import { watchQuery } from "../../lib/listeners";
import { leadCalls, logLeadCall, type AdminIdentity } from "../../lib/leads";
import { inputClass } from "../admin/AdminModal";
import { CALLER_OUTCOMES, CALLER_STAGES, columnFor } from "../../lib/callerBoard";
import { normalizePhone } from "../../lib/utils";
import {
  LEAD_TAGS, OUTCOME_LABEL, STAGE_META, TAG_META, demoLabel,
  type CallOutcome, type Lead, type LeadCall, type LeadStage, type LeadTag,
} from "../../types/leads";

/** "0771234567" → "94771234567", the form wa.me expects. */
function whatsAppNumber(phone: string): string {
  const local = normalizePhone(phone);
  return local.startsWith("0") ? `94${local.slice(1)}` : local;
}

function when(ts?: { toDate: () => Date } | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * A caller's view of one of their leads: log a call, move the stage, read the
 * history. Reuses the same writes as the admin drawer (logLeadCall,
 * setLeadStage via `onMove`) — the rules, not this panel, decide what a caller
 * may change. Nothing here reads admin-only collections (to-dos, feature
 * requests), which the rules would refuse.
 */
export default function CallerLeadDrawer({ lead, me, onMove, onClose }: {
  lead: Lead;
  me: AdminIdentity;
  /** Routes through the board so "Lost" can ask for its reason in one place. */
  onMove: (lead: Lead, to: LeadStage) => void;
  onClose: () => void;
}) {
  const [calls, setCalls] = useState<LeadCall[]>([]);
  const [callsLoading, setCallsLoading] = useState(true);
  const [outcome, setOutcome] = useState<CallOutcome>("connected");
  const [tags, setTags] = useState<LeadTag[]>([]);
  const [note, setNote] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [nextTime, setNextTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    return watchQuery(
      query(leadCalls(lead.id), orderBy("createdAt", "desc"), limit(100)),
      (snap) => {
        setCalls(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LeadCall)));
        setCallsLoading(false);
      },
      () => setCallsLoading(false),
    );
  }, [lead.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submitCall() {
    if (saving) return;
    if (!note.trim()) {
      setError("Add a short note about the call.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await logLeadCall(lead, { outcome, tags, note, nextCallDate: nextDate, nextCallTime: nextTime }, me);
      setNote("");
      setTags([]);
      setOutcome("connected");
      setNextDate("");
      setNextTime("");
    } catch {
      setError("That didn't save. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const isWon = lead.stage === "won";
  const history = [...(lead.stageHistory ?? [])].reverse();

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <aside className="relative w-full max-w-md bg-gray-900 border-l border-gray-800 overflow-y-auto">
        <div className="sticky top-0 z-10 bg-gray-900 border-b border-gray-800 px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white truncate">{lead.businessName}</h2>
            {lead.contactName && <p className="text-xs text-gray-400 truncate">{lead.contactName}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-gray-300 flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Contact */}
          <div className="space-y-1.5 text-sm text-gray-300">
            {lead.phone && (
              <a href={`tel:${lead.phone}`} className="flex items-center gap-2 hover:text-orange-300 w-fit">
                <Phone className="w-4 h-4 text-gray-500" /> <span className="font-mono">{lead.phone}</span>
              </a>
            )}
            {lead.email && <p className="flex items-center gap-2"><Mail className="w-4 h-4 text-gray-500" /> {lead.email}</p>}
            {(lead.location || lead.district) && (
              <p className="flex items-center gap-2"><MapPin className="w-4 h-4 text-gray-500" /> {[lead.location, lead.district].filter(Boolean).join(", ")}</p>
            )}
            {lead.mainProblem && <p className="text-amber-300/90 text-xs pt-1">{lead.mainProblem}</p>}
            {demoLabel(lead) && (
              <p className="flex items-center gap-2 text-violet-300 text-xs">
                <CalendarClock className="w-4 h-4" /> Demo {demoLabel(lead)}
              </p>
            )}
          </div>

          {/* Quick actions */}
          {lead.phone && (
            <div className="grid grid-cols-2 gap-2">
              <a
                href={`tel:${lead.phone}`}
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
              >
                <Phone className="w-4 h-4" /> Call
              </a>
              <a
                href={`https://wa.me/${whatsAppNumber(lead.phone)}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-gray-800 hover:bg-gray-700 text-gray-100 transition-colors"
              >
                <MessageCircle className="w-4 h-4 text-emerald-400" /> WhatsApp
              </a>
            </div>
          )}

          {/* Stage — tap to move */}
          <div>
            <p className="text-xs font-medium text-gray-400 mb-2">Status</p>
            <div className="flex flex-wrap gap-1.5">
              {CALLER_STAGES.map((s) => {
                const current = columnFor(lead.stage) === s.key;
                const locked = s.key === "won";
                return (
                  <button
                    key={s.key}
                    type="button"
                    disabled={locked || isWon}
                    onClick={() => onMove(lead, s.key)}
                    aria-pressed={current}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs border transition-colors ${
                      current
                        ? "bg-white text-gray-900 border-white font-medium"
                        : "bg-gray-950 text-gray-400 border-gray-800 hover:text-white hover:border-gray-600 disabled:opacity-40 disabled:hover:text-gray-400 disabled:hover:border-gray-800"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${s.headerBg}`} />
                    {s.label}
                    {locked && !current && <Lock className="w-3 h-3" />}
                  </button>
                );
              })}
            </div>
            {!isWon && <p className="text-[11px] text-gray-600 mt-2">Won is set automatically when the customer registers.</p>}
          </div>

          {lead.stage === "lost" && lead.lostReason && (
            <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              Lost: {lead.lostReason}
            </p>
          )}

          {/* Commission on a won lead — theirs, so it is shown. */}
          {isWon && (
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Wallet className="w-4 h-4 text-emerald-400" /> Your commission
              </h3>
              <p className="text-sm text-gray-300 mt-1">
                {typeof lead.commissionAmount === "number"
                  ? <span className="text-white font-medium">Rs {lead.commissionAmount.toLocaleString("en-LK")}</span>
                  : "Being worked out"}
                {lead.packageId && <span className="text-gray-500 capitalize"> · {lead.packageId} package</span>}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {lead.payoutStatus === "paid_to_caller"
                  ? "Paid out."
                  : lead.paymentConfirmed
                    ? `Payment confirmed — payable in week ${lead.payoutWeek}.`
                    : "Payable once the customer's first payment is confirmed."}
              </p>
            </div>
          )}

          {/* Log a call */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <PhoneCall className="w-4 h-4 text-orange-400" /> Log a call
            </h3>
            <select className={inputClass} value={outcome} onChange={(e) => setOutcome(e.target.value as CallOutcome)}>
              {CALLER_OUTCOMES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <textarea
              className={`${inputClass} min-h-[5rem]`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What was said?"
            />
            <div className="flex flex-wrap gap-1.5">
              {LEAD_TAGS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTags((cur) => (cur.includes(t.key) ? cur.filter((x) => x !== t.key) : [...cur, t.key]))}
                  className={`text-xs px-2 py-1 rounded-full transition-opacity ${TAG_META[t.key].chip} ${tags.includes(t.key) ? "" : "opacity-40 hover:opacity-70"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs text-gray-500 mb-1">Next call date</span>
                <input type="date" className={inputClass} value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
              </label>
              <label className="block">
                <span className="block text-xs text-gray-500 mb-1">Time</span>
                <input type="time" className={inputClass} value={nextTime} onChange={(e) => setNextTime(e.target.value)} />
              </label>
            </div>
            {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
            <button
              onClick={() => void submitCall()}
              disabled={saving}
              className="w-full py-2 rounded-lg text-sm font-medium bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white transition-colors"
            >
              {saving ? "Saving…" : "Save call"}
            </button>
          </div>

          {/* Call history */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-2">Call history</h3>
            {callsLoading ? (
              <p className="text-xs text-gray-600">Loading…</p>
            ) : calls.length === 0 ? (
              <p className="text-xs text-gray-600 border border-dashed border-gray-800 rounded-lg py-6 text-center">No calls logged yet.</p>
            ) : (
              <ul className="space-y-2">
                {calls.map((c) => (
                  <li key={c.id} className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-gray-200">
                        {c.callNumber > 0 ? `Call ${c.callNumber} · ` : ""}{OUTCOME_LABEL[c.outcome] ?? c.outcome}
                      </span>
                      <span className="text-gray-600">{when(c.createdAt)}</span>
                    </div>
                    {c.note && <p className="text-xs text-gray-400 mt-1 whitespace-pre-wrap">{c.note}</p>}
                    {c.createdByName && <p className="text-[10px] text-gray-600 mt-1">{c.createdByName}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Stage history */}
          {history.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                <HistoryIcon className="w-4 h-4 text-gray-500" /> Stage history
              </h3>
              <ul className="space-y-1.5">
                {history.map((h, i) => (
                  <li key={i} className="text-xs text-gray-400 flex flex-wrap items-center gap-x-2">
                    <span>{STAGE_META[h.from]?.label ?? h.from} → <span className="text-gray-200">{STAGE_META[h.to]?.label ?? h.to}</span></span>
                    <span className="text-gray-600">{h.byName} · {when(h.at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
