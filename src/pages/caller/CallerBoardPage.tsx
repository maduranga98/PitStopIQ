import { useMemo, useState } from "react";
import {
  CalendarClock, Lock, Phone, PhoneCall, Search, Sparkles, Users, X,
} from "lucide-react";
import { useCaller } from "../../contexts/CallerContext";
import { useCallerLeads } from "../../contexts/callerLeadsContext";
import { setLeadStage } from "../../lib/leads";
import {
  CALLER_STAGES, callerMove, columnFor, sortLeadsForBoard, timeAgo,
} from "../../lib/callerBoard";
import AdminModal, { inputClass } from "../../components/admin/AdminModal";
import CallerLeadDrawer from "../../components/caller/CallerLeadDrawer";
import { TAG_META, demoLabel, isClosedStage, type Lead, type LeadStage } from "../../types/leads";

/** Today in the browser's timezone — `toISOString()` would be UTC, a day behind in Sri Lanka. */
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

type Quick = "all" | "due" | "demo";

function LeadCard({ lead, dragging, onOpen, onDragStart, onDragEnd }: {
  lead: Lead;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const today = todayISO();
  const isWon = lead.stage === "won";
  const overdue = Boolean(lead.nextFollowUp && lead.nextFollowUp < today && !isClosedStage(lead.stage));
  const dueToday = lead.nextFollowUp === today && !isClosedStage(lead.stage);
  const followUp = lead.nextFollowUp || lead.followUpNote;
  const lastTouched = lead.lastCallAt?.toMillis();

  return (
    <div
      draggable={!isWon}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
      className={`group bg-gray-900 rounded-xl border p-3.5 cursor-pointer transition-all hover:-translate-y-px hover:border-gray-600 hover:shadow-lg hover:shadow-black/30 focus:outline-none focus-visible:border-orange-500 ${
        overdue ? "border-amber-500/40" : "border-gray-800"
      } ${dragging ? "opacity-40" : ""}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm text-white leading-snug truncate">{lead.businessName}</p>
          {lead.contactName && <p className="text-xs text-gray-400 mt-0.5 truncate">{lead.contactName}</p>}
        </div>
        {lead.phone && (
          <a
            href={`tel:${lead.phone}`}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Call ${lead.businessName}`}
            className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white flex items-center justify-center transition-colors"
          >
            <Phone className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      {(lead.phone || lead.location) && (
        <p className="text-xs text-gray-500 mt-2 truncate">
          <span className="font-mono">{lead.phone}</span>
          {lead.phone && lead.location && <span className="text-gray-700"> · </span>}
          {lead.location}
        </p>
      )}

      {lead.mainProblem && <p className="text-xs text-amber-200/80 mt-2 line-clamp-2 leading-relaxed">{lead.mainProblem}</p>}

      {((lead.tags ?? []).length > 0 || demoLabel(lead)) && (
        <div className="flex flex-wrap gap-1 mt-2.5">
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

      <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-gray-800/80 text-[11px] text-gray-500">
        <span className="flex items-center gap-2 min-w-0">
          <span className="flex items-center gap-1 flex-shrink-0"><PhoneCall className="w-3 h-3" />{lead.callCount ?? 0}</span>
          {lastTouched ? <span className="truncate">{timeAgo(lastTouched)}</span> : <span className="text-gray-600">Not called</span>}
        </span>
        {isWon && typeof lead.commissionAmount === "number" ? (
          <span className="text-emerald-400 font-medium flex-shrink-0">
            Rs {lead.commissionAmount.toLocaleString("en-LK")}{lead.paymentConfirmed ? " ✓" : ""}
          </span>
        ) : followUp ? (
          <span className={`flex items-center gap-1 truncate font-medium ${overdue ? "text-amber-400" : dueToday ? "text-orange-300" : ""}`}>
            <CalendarClock className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{overdue ? "Overdue · " : dueToday ? "Today · " : ""}{followUp}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * "My Leads": the pipeline board scoped to the leads assigned to this caller.
 * Every write goes through the same lib/leads.ts functions as the admin board
 * — the rules decide what a caller may change, this screen just doesn't offer
 * the rest (no dragging into or out of Won; Lost asks for a reason).
 */
export default function CallerBoardPage() {
  const { caller } = useCaller();
  const { leads, loading, error: loadError } = useCallerLeads();
  const [search, setSearch] = useState("");
  const [quick, setQuick] = useState<Quick>("all");
  const [mobileStage, setMobileStage] = useState<LeadStage | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<LeadStage | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lostFor, setLostFor] = useState<Lead | null>(null);
  const [lostReason, setLostReason] = useState("");
  const [notice, setNotice] = useState("");

  const me = useMemo(() => ({ id: caller?.id ?? "", name: caller?.name ?? "" }), [caller]);

  const stats = useMemo(() => {
    const today = todayISO();
    const open = leads.filter((l) => !isClosedStage(l.stage));
    return {
      open: open.length,
      due: open.filter((l) => l.nextFollowUp && l.nextFollowUp <= today).length,
      demos: open.filter((l) => demoLabel(l)).length,
      won: leads.filter((l) => l.stage === "won").length,
    };
  }, [leads]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const today = todayISO();
    return sortLeadsForBoard(leads).filter((l) => {
      if (quick === "due" && !(l.nextFollowUp && l.nextFollowUp <= today && !isClosedStage(l.stage))) return false;
      if (quick === "demo" && !(demoLabel(l) && !isClosedStage(l.stage))) return false;
      if (!q) return true;
      return [l.businessName, l.contactName, l.phone, l.location, l.district, l.mainProblem]
        .some((v) => v?.toLowerCase().includes(q));
    });
  }, [leads, search, quick]);

  const byStage = useMemo(() => {
    const map = new Map<LeadStage, Lead[]>(CALLER_STAGES.map((s) => [s.key, []]));
    for (const lead of filtered) map.get(columnFor(lead.stage))?.push(lead);
    return map;
  }, [filtered]);

  const activeMobile: LeadStage =
    mobileStage ?? CALLER_STAGES.find((s) => (byStage.get(s.key) ?? []).length > 0)?.key ?? "new";

  const selected = useMemo(() => leads.find((l) => l.id === selectedId) ?? null, [leads, selectedId]);

  async function applyMove(lead: Lead, to: LeadStage, reason?: string) {
    setNotice("");
    try {
      await setLeadStage(lead, to, me, reason);
    } catch {
      setNotice("That move didn't save. Check the connection and try again.");
    }
  }

  /** The one entry point for a stage change, from a drop or the drawer. */
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
    // A lead shown under Follow-up that is really "Video & details" moves on drop elsewhere only.
    if (lead && columnFor(lead.stage) !== stage) requestMove(lead, stage);
  }

  async function confirmLost() {
    if (!lostFor || !lostReason.trim()) return;
    const lead = lostFor;
    setLostFor(null);
    await applyMove(lead, "lost", lostReason);
  }

  const card = (lead: Lead) => (
    <LeadCard
      key={lead.id}
      lead={lead}
      dragging={dragging === lead.id}
      onOpen={() => setSelectedId(lead.id)}
      onDragStart={() => setDragging(lead.id)}
      onDragEnd={() => { setDragging(null); setDragOver(null); }}
    />
  );

  const statCards: { label: string; value: number; tone: string; onClick?: () => void; active?: boolean }[] = [
    { label: "Open leads", value: stats.open, tone: "text-white" },
    { label: "Follow-ups due", value: stats.due, tone: stats.due > 0 ? "text-amber-300" : "text-white", onClick: () => setQuick(quick === "due" ? "all" : "due"), active: quick === "due" },
    { label: "Demos booked", value: stats.demos, tone: "text-violet-300", onClick: () => setQuick(quick === "demo" ? "all" : "demo"), active: quick === "demo" },
    { label: "Won", value: stats.won, tone: "text-emerald-300" },
  ];

  return (
    <div className="px-4 sm:px-6 py-6 max-w-[1800px] mx-auto">
      {/* Title + search */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-white">
            {greeting()}{caller?.name ? `, ${caller.name.split(" ")[0]}` : ""}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {stats.due > 0
              ? `${stats.due} follow-up${stats.due === 1 ? "" : "s"} waiting on you today.`
              : "You're all caught up on follow-ups."}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone, city…"
            aria-label="Search leads"
            className="w-full pl-9 pr-8 py-2.5 bg-gray-900 border border-gray-800 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-colors"
          />
          {search && (
            <button onClick={() => setSearch("")} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-300">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Stats — the two that can be filtered are buttons */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {statCards.map((c) => {
          const body = (
            <>
              <p className="text-xs text-gray-500">{c.label}</p>
              <p className={`text-2xl font-semibold mt-0.5 tabular-nums ${c.tone}`}>{c.value}</p>
            </>
          );
          return c.onClick ? (
            <button
              key={c.label}
              onClick={c.onClick}
              aria-pressed={c.active}
              className={`text-left rounded-xl border px-4 py-3 transition-colors ${
                c.active ? "bg-orange-500/10 border-orange-500/50" : "bg-gray-900 border-gray-800 hover:border-gray-700"
              }`}
            >
              {body}
            </button>
          ) : (
            <div key={c.label} className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-3">{body}</div>
          );
        })}
      </div>

      {quick !== "all" && (
        <div className="flex items-center gap-2 mb-4 text-xs text-gray-400">
          Showing {quick === "due" ? "follow-ups due" : "booked demos"}
          <button onClick={() => setQuick("all")} className="text-orange-400 hover:text-orange-300">Clear</button>
        </div>
      )}

      {notice && (
        <div role="alert" className="mb-4 text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2.5 flex justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} className="text-amber-400/70 hover:text-amber-200" aria-label="Dismiss"><X className="w-4 h-4" /></button>
        </div>
      )}

      {loading ? (
        <div className="py-24 flex justify-center"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-orange-500" /></div>
      ) : loadError ? (
        <p className="text-center text-red-400 py-24 text-sm">Couldn't load your leads. Check the connection and reload.</p>
      ) : leads.length === 0 ? (
        <div className="flex flex-col items-center py-24 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gray-900 border border-gray-800 flex items-center justify-center mb-4">
            <Users className="w-6 h-6 text-gray-600" />
          </div>
          <p className="text-gray-200 font-medium">No leads assigned to you yet</p>
          <p className="text-gray-500 text-sm mt-1 max-w-sm">New leads appear here the moment an admin assigns them.</p>
        </div>
      ) : (
        <>
          {/* Phone: pick a stage, scroll its leads. Dragging isn't workable on touch. */}
          <div className="md:hidden">
            <div className="flex gap-2 overflow-x-auto pb-3 -mx-4 px-4">
              {CALLER_STAGES.map((s) => {
                const n = (byStage.get(s.key) ?? []).length;
                const on = s.key === activeMobile;
                return (
                  <button
                    key={s.key}
                    onClick={() => setMobileStage(s.key)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm whitespace-nowrap border transition-colors ${
                      on ? "bg-white text-gray-900 border-white font-medium" : "bg-gray-900 text-gray-400 border-gray-800"
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${s.headerBg}`} />
                    {s.label}
                    <span className={on ? "text-gray-500" : "text-gray-600"}>{n}</span>
                  </button>
                );
              })}
            </div>
            <div className="space-y-3">
              {(byStage.get(activeMobile) ?? []).length === 0 ? (
                <p className="text-center text-gray-600 text-sm py-12 border border-dashed border-gray-800 rounded-xl">
                  {activeMobile === "won" ? "Set when a customer registers." : "Nothing here."}
                </p>
              ) : (byStage.get(activeMobile) ?? []).map(card)}
            </div>
          </div>

          {/* Desktop: the board. */}
          <div className="hidden md:flex gap-4 overflow-x-auto pb-4 -mx-6 px-6">
            {CALLER_STAGES.map((col) => {
              const colLeads = byStage.get(col.key) ?? [];
              const locked = col.key === "won";
              const over = dragOver === col.key;
              return (
                <section
                  key={col.key}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(col.key); }}
                  onDragLeave={() => setDragOver((s) => (s === col.key ? null : s))}
                  onDrop={() => drop(col.key)}
                  aria-label={col.label}
                  className={`flex flex-col w-72 flex-shrink-0 rounded-2xl border p-2 h-[calc(100vh-21rem)] min-h-[22rem] transition-colors ${
                    over
                      ? locked ? "bg-red-500/5 border-red-500/40" : "bg-orange-500/5 border-orange-500/50"
                      : "bg-gray-900/40 border-gray-800/70"
                  }`}
                >
                  <div className="flex items-center justify-between px-2 py-2">
                    <span className="flex items-center gap-2 text-sm font-semibold text-gray-100">
                      <span className={`w-2.5 h-2.5 rounded-full ${col.headerBg}`} />
                      {col.label}
                      {locked && <Lock className="w-3 h-3 text-gray-600" aria-label="Set automatically" />}
                    </span>
                    <span className="text-xs text-gray-500 tabular-nums">{colLeads.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2.5 px-0.5 pb-1">
                    {colLeads.length === 0 ? (
                      <div className="h-full min-h-[6rem] flex flex-col items-center justify-center text-center text-xs text-gray-600 border border-dashed border-gray-800 rounded-xl px-4">
                        {locked ? (
                          <>
                            <Sparkles className="w-4 h-4 mb-1.5 text-gray-700" />
                            Appears when a customer you referred registers
                          </>
                        ) : "Drop a lead here"}
                      </div>
                    ) : colLeads.map(card)}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}

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

