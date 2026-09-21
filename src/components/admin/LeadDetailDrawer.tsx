import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  X, Phone, Mail, MapPin, PhoneCall, StickyNote, Building2,
  Pencil, Archive, ExternalLink, Clock,
} from "lucide-react";
import { collection, orderBy, query, limit } from "firebase/firestore";
import { watchQuery } from "../../lib/listeners";
import { db } from "../../config/firebase";
import { inputClass } from "./AdminModal";
import { addLeadNote, logLeadCall, setLeadCallCount, setLeadStage } from "../../lib/leads";
import type { AdminIdentity } from "../../lib/leads";
import {
  CALL_OUTCOMES, LEAD_STAGES, LEAD_TAGS, MAX_TRACKED_CALLS,
  OUTCOME_LABEL, STAGE_META, TAG_META,
  type CallOutcome, type Lead, type LeadCall, type LeadStage, type LeadTag,
} from "../../types/leads";

function when(ts?: { toDate: () => Date } | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * One lead in full: who they are, where they are in the pipeline, and the
 * whole call history under it. Every control here writes straight away —
 * there is no Save on this panel, because a call is logged while the phone is
 * still warm and nobody should have to remember a second step.
 */
export default function LeadDetailDrawer({
  lead, admin, onClose, onEdit, onArchive,
}: {
  lead: Lead;
  admin: AdminIdentity;
  onClose: () => void;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const navigate = useNavigate();
  const [calls, setCalls] = useState<LeadCall[]>([]);
  const [outcome, setOutcome] = useState<CallOutcome>("connected");
  const [callTags, setCallTags] = useState<LeadTag[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Newest first, capped: the panel shows a history, not an archive, and a
    // lead chased for a year should still open in one round trip.
    return watchQuery(
      query(collection(db, "leads", lead.id, "calls"), orderBy("createdAt", "desc"), limit(100)),
      (snap) => setCalls(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LeadCall))),
      () => setCalls([]),
    );
  }, [lead.id]);

  const toggleCallTag = (tag: LeadTag) =>
    setCallTags((t) => (t.includes(tag) ? t.filter((x) => x !== tag) : [...t, tag]));

  async function run(work: () => Promise<void>) {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await work();
    } catch {
      setError("That didn't save. Check the connection and try again.");
    }
    setSaving(false);
  }

  const logCall = () =>
    run(async () => {
      await logLeadCall(lead, { outcome, tags: callTags, note }, admin);
      setNote("");
      setCallTags([]);
      setOutcome("connected");
    });

  const saveNote = () =>
    run(async () => {
      if (!note.trim()) return;
      await addLeadNote(lead, note, callTags, admin);
      setNote("");
      setCallTags([]);
    });

  /**
   * Straight into the registration form with everything the lead already
   * carries — a demo account is the same provisioning flow as a paying one,
   * and re-typing the name and number off the card is how they get mistyped.
   * The lead id rides along so the form can mark it Won on success.
   */
  const createAccount = () =>
    navigate("/admin/service-centers/register", {
      state: {
        leadId: lead.id,
        centerName: lead.businessName,
        centerPhone: lead.phone,
        ownerName: lead.contactName,
        ownerPhone: lead.phone,
        district: lead.district ?? "",
        address: [lead.city, lead.district].filter(Boolean).join(", "),
      },
    });

  const stageMeta = STAGE_META[lead.stage];

  const summary = useMemo(
    () => [
      { icon: Phone, value: lead.phone, href: lead.phone ? `tel:${lead.phone}` : undefined },
      { icon: Mail, value: lead.email, href: lead.email ? `mailto:${lead.email}` : undefined },
      { icon: MapPin, value: [lead.city, lead.district].filter(Boolean).join(", ") },
      { icon: Building2, value: lead.source && `via ${lead.source}` },
    ].filter((r) => Boolean(r.value)),
    [lead],
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <aside className="relative w-full max-w-lg bg-gray-900 border-l border-gray-800 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-800">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-white truncate">{lead.businessName}</h2>
              {lead.contactName && <p className="text-sm text-gray-400 mt-0.5">{lead.contactName}</p>}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={onEdit} title="Edit lead" className="p-2 rounded-lg text-gray-500 hover:text-white hover:bg-gray-800 transition-colors">
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={onArchive} title="Remove from board" className="p-2 rounded-lg text-gray-500 hover:text-red-300 hover:bg-gray-800 transition-colors">
                <Archive className="w-4 h-4" />
              </button>
              <button onClick={onClose} className="p-2 rounded-lg text-gray-500 hover:text-white hover:bg-gray-800 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mt-3">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full text-white ${stageMeta.headerBg}`}>
              {stageMeta.label}
            </span>
            {(lead.tags ?? []).map((t) => (
              <span key={t} className={`text-xs font-medium px-2.5 py-1 rounded-full ${TAG_META[t].chip}`}>
                {TAG_META[t].label}
              </span>
            ))}
            {lead.demoRequested && (
              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30">
                Demo wanted
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Contact */}
          {summary.length > 0 && (
            <div className="space-y-2">
              {summary.map(({ icon: Icon, value, href }) => (
                <div key={value as string} className="flex items-center gap-2.5 text-sm text-gray-300">
                  <Icon className="w-4 h-4 text-gray-600 flex-shrink-0" />
                  {href ? (
                    <a href={href} className="hover:text-orange-400 transition-colors">{value}</a>
                  ) : (
                    <span>{value}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {lead.notes && (
            <p className="text-sm text-gray-400 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2.5 whitespace-pre-wrap">
              {lead.notes}
            </p>
          )}

          {/* Pipeline controls */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-gray-400 mb-1.5">Stage</span>
              <select
                className={inputClass}
                value={lead.stage}
                disabled={saving}
                onChange={(e) => run(() => setLeadStage(lead.id, e.target.value as LeadStage))}
              >
                {LEAD_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-400 mb-1.5">Calls made</span>
              <select
                className={inputClass}
                value={lead.callCount ?? 0}
                disabled={saving}
                onChange={(e) => run(() => setLeadCallCount(lead.id, Number(e.target.value)))}
              >
                {Array.from({ length: MAX_TRACKED_CALLS + 1 }, (_, n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Account */}
          {lead.convertedCenterId ? (
            <button
              onClick={() => navigate(`/admin/service-centers/${lead.convertedCenterId}`)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-green-500/10 border border-green-500/30 text-green-300 hover:bg-green-500/20 transition-colors"
            >
              <ExternalLink className="w-4 h-4" /> Open their service center
            </button>
          ) : (
            <button
              onClick={createAccount}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white transition-colors"
            >
              <Building2 className="w-4 h-4" /> Create their account
            </button>
          )}

          {/* Log a call */}
          <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <PhoneCall className="w-4 h-4 text-orange-400" />
              Log call #{(lead.callCount ?? 0) + 1}
            </h3>

            <select
              className={inputClass}
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as CallOutcome)}
            >
              {CALL_OUTCOMES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>

            <div className="flex flex-wrap gap-2">
              {LEAD_TAGS.map((tag) => {
                const on = callTags.includes(tag.key);
                return (
                  <button
                    key={tag.key}
                    onClick={() => toggleCallTag(tag.key)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      on ? TAG_META[tag.key].chip : "bg-gray-900 border border-gray-800 text-gray-500 hover:text-gray-300"
                    }`}
                  >
                    {tag.label}
                  </button>
                );
              })}
            </div>

            <textarea
              className={`${inputClass} min-h-[80px] resize-y`}
              placeholder="What was said — what they asked for, what to do next."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />

            <div className="flex gap-2">
              <button
                onClick={logCall}
                disabled={saving}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white transition-colors"
              >
                {saving ? "Saving…" : "Log call"}
              </button>
              <button
                onClick={saveNote}
                disabled={saving || !note.trim()}
                title="Record this without counting it as a call"
                className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-200 transition-colors"
              >
                Note only
              </button>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}
          </div>

          {/* History */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-3">History</h3>
            {calls.length === 0 ? (
              <p className="text-sm text-gray-600 py-6 text-center border border-dashed border-gray-800 rounded-lg">
                Nothing logged yet.
              </p>
            ) : (
              <ol className="space-y-3">
                {calls.map((c) => (
                  <li key={c.id} className="border-l-2 border-gray-800 pl-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      {c.callNumber > 0 ? (
                        <span className="text-xs font-semibold text-orange-400">Call #{c.callNumber}</span>
                      ) : (
                        <span className="text-xs font-semibold text-gray-400 flex items-center gap-1">
                          <StickyNote className="w-3 h-3" /> Note
                        </span>
                      )}
                      <span className="text-xs text-gray-500">{OUTCOME_LABEL[c.outcome] ?? c.outcome}</span>
                      {(c.tags ?? []).map((t) => (
                        <span key={t} className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${TAG_META[t].chip}`}>
                          {TAG_META[t].label}
                        </span>
                      ))}
                    </div>
                    {c.note && <p className="text-sm text-gray-300 mt-1 whitespace-pre-wrap">{c.note}</p>}
                    <p className="flex items-center gap-1 text-xs text-gray-600 mt-1">
                      <Clock className="w-3 h-3" />
                      {when(c.createdAt)}
                      {c.createdByName ? ` · ${c.createdByName}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
