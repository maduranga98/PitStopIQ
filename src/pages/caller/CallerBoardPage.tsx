import { useEffect, useMemo, useState } from "react";
import { collection, limit, query, where } from "firebase/firestore";
import { CalendarClock, Lock, PhoneCall, Search, Users } from "lucide-react";
import { db } from "../../config/firebase";
import { watchQuery } from "../../lib/listeners";
import { useCaller } from "../../contexts/CallerContext";
import { setLeadStage } from "../../lib/leads";
import { callerMove, sortLeadsForBoard } from "../../lib/callerBoard";
import AdminModal, { inputClass } from "../../components/admin/AdminModal";
import CallerLeadDrawer from "../../components/caller/CallerLeadDrawer";
import {
  LEAD_STAGES, STAGE_META, TAG_META, demoLabel, isClosedStage,
  type Lead, type LeadStage,
} from "../../types/leads";

/** Today in the browser's timezone — `toISOString()` would be UTC, a day behind in Sri Lanka. */
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** A caller works a few hundred leads at most; this only guards against an unbounded stream. */
const BOARD_LIMIT = 500;

/**
 * "My Leads": the pipeline board scoped to the leads assigned to this caller.
 * The query is the scope the rules require (`assignedTo == uid`), and every
 * write goes through the same lib/leads.ts functions as the admin board — the
 * rules decide what a caller may change, this screen just doesn't offer the
 * rest (no dragging into or out of Won; Lost asks for a reason).
 */
export default function CallerBoardPage() {
  const { caller } = useCaller();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<LeadStage | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lostFor, setLostFor] = useState<Lead | null>(null);
  const [lostReason, setLostReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const me = useMemo(() => ({ id: caller?.id ?? "", name: caller?.name ?? "" }), [caller]);

  useEffect(() => {
    if (!caller) return;
    return watchQuery(
      query(collection(db, "leads"), where("assignedTo", "==", caller.id), limit(BOARD_LIMIT)),
      (snap) => {
        setLeads(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Lead)).filter((l) => !l.isDeleted));
        setLoading(false);
        setLoadError(false);
      },
      () => { setLoading(false); setLoadError(true); },
    );
  }, [caller]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = sortLeadsForBoard(leads);
    if (!q) return list;
    return list.filter((l) =>
      [l.businessName, l.contactName, l.phone, l.location, l.district, l.mainProblem]
        .some((v) => v?.toLowerCase().includes(q)));
  }, [leads, search]);

  const byStage = useMemo(() => {
    const map = new Map<LeadStage, Lead[]>(LEAD_STAGES.map((s) => [s.key, []]));
    for (const lead of filtered) map.get(lead.stage)?.push(lead);
    return map;
  }, [filtered]);

  const stats = useMemo(() => {
    const today = todayISO();
    return {
      open: leads.filter((l) => !isClosedStage(l.stage)).length,
      due: leads.filter((l) => l.nextFollowUp && l.nextFollowUp <= today && !isClosedStage(l.stage)).length,
      won: leads.filter((l) => l.stage === "won").length,
    };
  }, [leads]);

  const selected = useMemo(() => leads.find((l) => l.id === selectedId) ?? null, [leads, selectedId]);

  async function applyMove(lead: Lead, to: LeadStage, reason?: string) {
    setBusy(true);
    setNotice("");
    try {
      await setLeadStage(lead, to, me, reason);
    } catch {
      setNotice("That move didn't save. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  /** The one entry point for a stage change, from a drop or the drawer's dropdown. */
  function requestMove(lead: Lead, to: LeadStage) {
    const move = callerMove(lead.stage, to);
    if (move.kind === "same") return;
    if (move.kind === "blocked") { setNotice(move.reason); return; }
    if (move.kind === "needs-reason") { setLostReason(""); setLostFor(lead); return; }
    void applyMove(lead, to);
  }

  function drop(stage: LeadStage) {
    const id = dragging;
    setDragging(null);
    setDragOver(null);
    const lead = leads.find((l) => l.id === id);
    if (lead) requestMove(lead, stage);
  }

  async function confirmLost() {
    if (!lostFor || !lostReason.trim()) return;
    const lead = lostFor;
    setLostFor(null);
    await applyMove(lead, "lost", lostReason);
  }

  const card = (lead: Lead) => {
    const overdue = Boolean(lead.nextFollowUp && lead.nextFollowUp <= todayISO() && !isClosedStage(lead.stage));
    const followUp = lead.nextFollowUp || lead.followUpNote;
    const isWon = lead.stage === "won";
    return (
      <div
        key={lead.id}
        draggable={!isWon}
        onDragStart={() => setDragging(lead.id)}
        onDragEnd={() => { setDragging(null); setDragOver(null); }}
        onClick={() => setSelectedId(lead.id)}
        className={`bg-gray-900 border border-gray-800 border-l-4 ${STAGE_META[lead.stage].border} rounded-lg p-3 cursor-pointer hover:border-orange-500/40 transition-colors ${
          dragging === lead.id ? "opacity-40" : ""
        }`}
      >
        <p className="font-semibold text-sm text-white truncate">{lead.businessName}</p>
        {lead.contactName && <p className="text-xs text-gray-400 mt-0.5 truncate">{lead.contactName}</p>}
        <div className="flex items-center justify-between gap-2 mt-1">
          {lead.phone && <span className="text-xs text-gray-500 font-mono truncate">{lead.phone}</span>}
          {lead.location && <span className="text-xs text-gray-600 truncate">{lead.location}</span>}
        </div>
        {lead.mainProblem && <p className="text-xs text-amber-300/90 mt-1.5 line-clamp-2">{lead.mainProblem}</p>}
        {((lead.tags ?? []).length > 0 || demoLabel(lead)) && (
          <div className="flex flex-wrap gap-1 mt-2">
            {(lead.tags ?? []).map((t) => (
              <span key={t} className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${TAG_META[t].chip}`}>{TAG_META[t].label}</span>
            ))}
            {demoLabel(lead) && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30 truncate max-w-full">
                Demo {demoLabel(lead)}
              </span>
            )}
          </div>
        )}
        <div className="flex items-center justify-between gap-2 mt-2 text-xs text-gray-500">
          <span className="flex items-center gap-1"><PhoneCall className="w-3 h-3" />{lead.callCount ?? 0}</span>
          {isWon && typeof lead.commissionAmount === "number" ? (
            <span className="text-emerald-400 font-medium">
              Rs {lead.commissionAmount.toLocaleString("en-LK")}{lead.paymentConfirmed ? " ✓" : ""}
            </span>
          ) : followUp ? (
            <span className={`flex items-center gap-1 truncate ${overdue ? "text-amber-400" : ""}`}>
              <CalendarClock className="w-3 h-3 flex-shrink-0" /><span className="truncate">{followUp}</span>
            </span>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-full">
      <div className="px-4 sm:px-6 py-4 flex flex-wrap items-center gap-3 border-b border-gray-800 bg-gray-900/50">
        <div className="mr-auto">
          <h1 className="text-lg font-semibold text-white">My Leads</h1>
          <p className="text-xs text-gray-500">
            {stats.open} open · {stats.due} follow-up{stats.due === 1 ? "" : "s"} due · {stats.won} won
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone, city…"
            aria-label="Search leads"
            className="pl-9 pr-3 py-2 w-56 bg-gray-950 border border-gray-800 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500"
          />
        </div>
      </div>

      {notice && (
        <div role="alert" className="mx-4 sm:mx-6 mt-4 text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 flex justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} className="text-amber-400/70 hover:text-amber-200" aria-label="Dismiss">✕</button>
        </div>
      )}

      <div className="px-4 sm:px-6 py-5">
        {loading ? (
          <p className="text-center text-gray-600 py-20 text-sm">Loading your leads…</p>
        ) : loadError ? (
          <p className="text-center text-red-400 py-20 text-sm">Couldn't load your leads. Check the connection and reload.</p>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center py-24 text-center">
            <Users className="w-12 h-12 text-gray-700 mb-4" />
            <p className="text-gray-300 font-medium">No leads assigned to you yet</p>
            <p className="text-gray-600 text-sm mt-1 max-w-sm">New leads appear here as soon as an admin assigns them.</p>
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 sm:-mx-6 px-4 sm:px-6">
            {LEAD_STAGES.map((col) => {
              const colLeads = byStage.get(col.key) ?? [];
              const locked = col.key === "won";
              return (
                <section
                  key={col.key}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(col.key); }}
                  onDragLeave={() => setDragOver((s) => (s === col.key ? null : s))}
                  onDrop={() => drop(col.key)}
                  className={`flex flex-col gap-3 rounded-xl p-1 w-72 flex-shrink-0 transition-colors ${
                    dragOver === col.key ? (locked ? "bg-red-500/10 ring-1 ring-red-500/30" : "bg-orange-500/10 ring-1 ring-orange-500/40") : ""
                  }`}
                >
                  <div className={`${col.headerBg} rounded-lg px-3 py-2 flex items-center justify-between`}>
                    <span className="text-sm font-semibold text-white truncate flex items-center gap-1.5">
                      {locked && <Lock className="w-3 h-3 opacity-70" />}{col.label}
                    </span>
                    <span className="text-xs bg-black/25 text-white px-2 py-0.5 rounded-full flex-shrink-0">{colLeads.length}</span>
                  </div>
                  <div className="flex flex-col gap-3 overflow-y-auto max-h-[calc(100vh-14rem)] pr-0.5">
                    {colLeads.length === 0 ? (
                      <p className="text-center text-gray-700 text-xs py-8 border border-dashed border-gray-800 rounded-lg">
                        {locked ? "Set when a customer registers" : "Drop a lead here"}
                      </p>
                    ) : colLeads.map(card)}
                  </div>
                </section>
              );
            })}
          </div>
        )}
        {busy && <p className="sr-only" role="status">Saving…</p>}
      </div>

      {selected && (
        <CallerLeadDrawer key={selected.id} lead={selected} me={me} onMove={requestMove} onClose={() => setSelectedId(null)} />
      )}

      {lostFor && (
        <AdminModal
          title={`Mark ${lostFor.businessName} as lost`}
          size="sm"
          onClose={() => setLostFor(null)}
          footer={
            <>
              <button onClick={() => setLostFor(null)} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white">Cancel</button>
              <button
                onClick={() => void confirmLost()}
                disabled={!lostReason.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white transition-colors"
              >
                Mark lost
              </button>
            </>
          }
        >
          <label className="block">
            <span className="block text-xs font-medium text-gray-400 mb-1.5">Why was it lost?</span>
            <textarea
              autoFocus
              className={`${inputClass} min-h-[6rem]`}
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              placeholder="e.g. Too expensive, already using another system"
            />
          </label>
        </AdminModal>
      )}
    </div>
  );
}
