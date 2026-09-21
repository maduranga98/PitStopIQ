import { Suspense, useEffect, useMemo, useState } from "react";
import { collection, limit, orderBy, query } from "firebase/firestore";
import {
  Plus, Search, Upload, PhoneCall, Users, Sparkles,
  CalendarClock, Download, LayoutGrid, List, Wallet, FileText,
} from "lucide-react";
import { db } from "../../config/firebase";
import { watchQuery } from "../../lib/listeners";
import { downloadCSV } from "../../lib/csvExport";
import { useSuperAdmin } from "../../contexts/SuperAdminContext";
import {
  archiveLead, createLead, createLeads, setLeadStage, updateLead,
} from "../../lib/leads";
import LeadFormModal from "../../components/admin/LeadFormModal";
import { lazyWithRetry } from "../../lib/lazyWithRetry";
import LeadDetailDrawer from "../../components/admin/LeadDetailDrawer";
import DemoScheduleModal from "../../components/admin/DemoScheduleModal";
import {
  LEAD_STAGES, LEAD_TAGS, STAGE_META, TAG_META, demoLabel, isClosedStage,
  type Lead, type LeadDraft, type LeadStage, type LeadTag,
} from "../../types/leads";

// The spreadsheet reader pulls in the whole xlsx parser — 330 KB that most
// visits to this screen never touch. Split out so the board paints without it
// and the import dialog fetches it on the way open.
const LeadImportModal = lazyWithRetry(() => import("../../components/admin/LeadImportModal"));

// Same reasoning for the day report: it is opened once at the end of a day,
// and it carries the whole report table with it.
const DayReportModal = lazyWithRetry(() => import("../../components/admin/DayReportModal"));

/**
 * Today in the browser's own timezone. `toISOString()` would be UTC, which in
 * Sri Lanka (UTC+5:30) reads as yesterday until half past five in the morning
 * — so a demo booked for today, or a follow-up due today, would not count as
 * due during the first hours of the working day.
 */
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * How much of the pipeline the board holds at once. A Kanban board stops
 * being readable long before this, and the list view is searched rather than
 * scrolled — so the cap is about never streaming an unbounded collection to
 * the browser, not about what fits on screen.
 */
const BOARD_LIMIT = 1000;

/** The lead as the add/edit form wants it — the form owns a subset of the doc. */
function toDraft(lead: Lead): LeadDraft {
  return {
    businessName: lead.businessName,
    contactName: lead.contactName ?? "",
    phone: lead.phone ?? "",
    email: lead.email ?? "",
    location: lead.location ?? "",
    district: lead.district ?? "",
    source: lead.source ?? "",
    mainProblem: lead.mainProblem ?? "",
    stage: lead.stage,
    callCount: lead.callCount ?? 0,
    tags: lead.tags ?? [],
    demoRequested: lead.demoRequested === true,
    demoAt: lead.demoAt ?? "",
    demoDate: lead.demoDate ?? "",
    demoTime: lead.demoTime ?? "",
    nextFollowUp: lead.nextFollowUp ?? "",
    followUpNote: lead.followUpNote ?? "",
    priceNote: lead.priceNote ?? "",
    closedAmount: lead.closedAmount ?? 0,
    leadDate: lead.leadDate ?? "",
    notes: lead.notes ?? "",
  };
}

function StatCard({ icon: Icon, label, value, tone }: {
  icon: typeof Users; label: string; value: string | number; tone: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${tone}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-semibold text-white leading-tight">{value}</p>
        <p className="text-xs text-gray-500 truncate">{label}</p>
      </div>
    </div>
  );
}

/**
 * The Management section: the sales pipeline that used to be a spreadsheet.
 * Leads are added by hand or imported from that spreadsheet, worked as a
 * Kanban board, and turned into real service-center accounts from the same
 * screen once they ask for a demo.
 */
export default function AdminLeadsPage() {
  const { superAdmin } = useSuperAdmin();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<"all" | LeadTag>("all");
  const [view, setView] = useState<"board" | "list">("board");
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<LeadStage | null>(null);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [importing, setImporting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [demoLeadId, setDemoLeadId] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  const admin = useMemo(
    () => ({ id: superAdmin?.id ?? "", name: superAdmin?.displayName || superAdmin?.email || "Super Admin" }),
    [superAdmin],
  );

  useEffect(() => {
    // Ordered newest-first on the server; the board re-groups by stage on the
    // client, which is free next to six per-column queries. Archived rows are
    // dropped here rather than in the query: `where("isDeleted", "!=", true)`
    // would also drop every lead written before the flag existed, because a
    // `!=` filter skips documents that lack the field entirely.
    return watchQuery(
      query(collection(db, "leads"), orderBy("createdAt", "desc"), limit(BOARD_LIMIT)),
      (snap) => {
        setLeads(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as Lead))
            .filter((l) => !l.isDeleted),
        );
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (tagFilter !== "all" && !(l.tags ?? []).includes(tagFilter)) return false;
      if (!q) return true;
      return (
        l.businessName?.toLowerCase().includes(q) ||
        l.contactName?.toLowerCase().includes(q) ||
        l.phone?.toLowerCase().includes(q) ||
        l.location?.toLowerCase().includes(q) ||
        l.district?.toLowerCase().includes(q) ||
        l.source?.toLowerCase().includes(q) ||
        l.mainProblem?.toLowerCase().includes(q) ||
        l.notes?.toLowerCase().includes(q)
      );
    });
  }, [leads, search, tagFilter]);

  const byStage = useMemo(() => {
    const map = new Map<LeadStage, Lead[]>(LEAD_STAGES.map((s) => [s.key, []]));
    for (const lead of filtered) map.get(lead.stage)?.push(lead);
    return map;
  }, [filtered]);

  const stats = useMemo(() => {
    const today = todayISO();
    return {
      open: leads.filter((l) => !isClosedStage(l.stage)).length,
      demo: leads.filter((l) => l.demoRequested && !l.convertedCenterId).length,
      due: leads.filter((l) => l.nextFollowUp && l.nextFollowUp <= today && !isClosedStage(l.stage)).length,
      demosToday: leads.filter((l) => l.demoDate === today).length,
      won: leads.filter((l) => l.stage === "won").length,
      // The tracker's own Total Revenue figure, off the closed amounts.
      revenue: leads.reduce((sum, l) => sum + (l.closedAmount ?? 0), 0),
    };
  }, [leads]);

  /** Numbers already in the pipeline, so an import doesn't re-add them. */
  const existingPhones = useMemo(
    () => new Set(leads.map((l) => l.phoneKey).filter((p): p is string => Boolean(p))),
    [leads],
  );

  const selected = useMemo(
    () => leads.find((l) => l.id === selectedId) ?? null,
    [leads, selectedId],
  );

  // Kept as an id rather than the lead itself, so the scheduler is looking at
  // the live document while it is open — a demo booked from the drawer is on
  // screen the moment the write lands.
  const demoLead = useMemo(
    () => leads.find((l) => l.id === demoLeadId) ?? null,
    [leads, demoLeadId],
  );

  async function drop(stage: LeadStage) {
    const id = dragging;
    setDragging(null);
    setDragOver(null);
    if (!id) return;
    const lead = leads.find((l) => l.id === id);
    if (!lead || lead.stage === stage) return;
    await setLeadStage(id, stage);
  }

  function exportCsv() {
    downloadCSV(
      `pitstopiq-leads-${todayISO()}.csv`,
      ["Date", "Customer Name", "Garage Name", "Location", "District", "Phone Number",
       "Source", "Main Problem", "Status", "Calls", "Tags", "Demo Date & Time",
       "Follow-up Date", "Price Told?", "Closed Amount (Rs)", "Notes"],
      filtered.map((l) => [
        l.leadDate ?? "", l.contactName ?? "", l.businessName ?? "", l.location ?? "",
        l.district ?? "", l.phone ?? "", l.source ?? "", l.mainProblem ?? "",
        STAGE_META[l.stage].label, String(l.callCount ?? 0), (l.tags ?? []).join(" "),
        demoLabel(l), l.nextFollowUp || l.followUpNote || "", l.priceNote ?? "",
        l.closedAmount ? String(l.closedAmount) : "", l.notes ?? "",
      ]),
    );
  }

  const card = (lead: Lead) => {
    const overdue = Boolean(
      lead.nextFollowUp && lead.nextFollowUp <= todayISO() && !isClosedStage(lead.stage),
    );
    const followUp = lead.nextFollowUp || lead.followUpNote;
    const booked = Boolean(lead.demoDate);
    return (
      <div
        key={lead.id}
        draggable
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

        {lead.mainProblem && (
          <p className="text-xs text-amber-300/90 mt-1.5 line-clamp-2">{lead.mainProblem}</p>
        )}

        {((lead.tags ?? []).length > 0 || demoLabel(lead)) && (
          <div className="flex flex-wrap gap-1 mt-2">
            {(lead.tags ?? []).map((t) => (
              <span key={t} className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${TAG_META[t].chip}`}>
                {TAG_META[t].label}
              </span>
            ))}
            {demoLabel(lead) && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30 truncate max-w-full">
                Demo {demoLabel(lead)}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 mt-2 text-xs text-gray-500">
          <span className="flex items-center gap-2 flex-shrink-0">
            <span className="flex items-center gap-1">
              <PhoneCall className="w-3 h-3" />
              {lead.callCount ?? 0}
            </span>
            {/* Booking and moving a demo is the one thing done straight off
                the card — it is what the Demo Booked column is worked for. */}
            <button
              onClick={(e) => { e.stopPropagation(); setDemoLeadId(lead.id); }}
              title={booked ? "Move the demo, or see what else is booked" : "Book a demo"}
              className={`p-1 rounded-md transition-colors ${
                booked ? "text-violet-400 hover:text-violet-300" : "text-gray-600 hover:text-violet-300"
              }`}
            >
              <CalendarClock className="w-3.5 h-3.5" />
            </button>
          </span>
          {lead.closedAmount ? (
            <span className="text-green-400 font-medium">
              Rs {lead.closedAmount.toLocaleString("en-LK")}
            </span>
          ) : followUp ? (
            <span className={`flex items-center gap-1 truncate ${overdue ? "text-amber-400" : ""}`}>
              <CalendarClock className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{followUp}</span>
            </span>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/50 sticky top-0 z-30 backdrop-blur">
        <div className="px-6 py-4 flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h1 className="text-lg font-semibold text-white">Management</h1>
            <p className="text-xs text-gray-500">Leads, calls and follow-ups</p>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone, city…"
              className="pl-9 pr-3 py-2 w-56 bg-gray-950 border border-gray-800 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500"
            />
          </div>

          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value as "all" | LeadTag)}
            className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500 [color-scheme:dark]"
          >
            <option value="all">All tags</option>
            {LEAD_TAGS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>

          <div className="flex bg-gray-950 border border-gray-800 rounded-lg p-0.5">
            {([["board", LayoutGrid], ["list", List]] as const).map(([key, Icon]) => (
              <button
                key={key}
                onClick={() => setView(key)}
                title={key === "board" ? "Board" : "List"}
                className={`p-1.5 rounded-md transition-colors ${
                  view === key ? "bg-orange-500 text-white" : "text-gray-500 hover:text-white"
                }`}
              >
                <Icon className="w-4 h-4" />
              </button>
            ))}
          </div>

          <button
            onClick={() => setReporting(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-gray-800 hover:bg-gray-700 text-gray-200 transition-colors"
          >
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline">Day report</span>
          </button>
          <button
            onClick={exportCsv}
            title="Download what's on screen"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={() => setImporting(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-gray-800 hover:bg-gray-700 text-gray-200 transition-colors"
          >
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">Import</span>
          </button>
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add lead
          </button>
        </div>
      </header>

      <div className="px-6 py-5 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <StatCard icon={Users} label="Open leads" value={stats.open} tone="bg-sky-500/15 text-sky-400" />
          <StatCard icon={Sparkles} label="Demo booked or done" value={stats.demo} tone="bg-violet-500/15 text-violet-400" />
          <StatCard icon={CalendarClock} label="Demos today" value={stats.demosToday} tone="bg-fuchsia-500/15 text-fuchsia-400" />
          <StatCard icon={CalendarClock} label="Follow-ups due" value={stats.due} tone="bg-amber-500/15 text-amber-400" />
          <StatCard icon={PhoneCall} label="Closed won" value={stats.won} tone="bg-green-500/15 text-green-400" />
          <StatCard
            icon={Wallet}
            label="Revenue (Rs)"
            value={stats.revenue.toLocaleString("en-LK")}
            tone="bg-emerald-500/15 text-emerald-400"
          />
        </div>

        {loading ? (
          <p className="text-center text-gray-600 py-20 text-sm">Loading leads…</p>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center py-24 text-center">
            <Users className="w-12 h-12 text-gray-700 mb-4" />
            <p className="text-gray-300 font-medium">No leads yet</p>
            <p className="text-gray-600 text-sm mt-1 max-w-sm">
              Import the spreadsheet you're keeping today, or add the first one by hand.
            </p>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setImporting(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gray-800 hover:bg-gray-700 text-gray-200 transition-colors"
              >
                <Upload className="w-4 h-4" /> Import spreadsheet
              </button>
              <button
                onClick={() => setAdding(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white transition-colors"
              >
                <Plus className="w-4 h-4" /> Add lead
              </button>
            </div>
          </div>
        ) : view === "board" ? (
          /* ── Kanban board ─────────────────────────────────────────────────
             Nine columns is the pipeline the sheet actually runs, which is
             wider than any screen — so they scroll sideways at a fixed width
             rather than being squeezed into a grid that makes each card
             unreadable. Each column scrolls on its own once it is taller than
             the viewport, so the headers stay put while a long column is
             worked. */
          <div className="flex gap-4 overflow-x-auto pb-4 -mx-6 px-6">
            {LEAD_STAGES.map((col) => {
              const colLeads = byStage.get(col.key) ?? [];
              return (
                <section
                  key={col.key}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(col.key); }}
                  onDragLeave={() => setDragOver((s) => (s === col.key ? null : s))}
                  onDrop={() => drop(col.key)}
                  className={`flex flex-col gap-3 rounded-xl p-1 w-72 flex-shrink-0 transition-colors ${
                    dragOver === col.key ? "bg-orange-500/10 ring-1 ring-orange-500/40" : ""
                  }`}
                >
                  <div className={`${col.headerBg} rounded-lg px-3 py-2 flex items-center justify-between sticky top-0`}>
                    <span className="text-sm font-semibold text-white truncate">{col.label}</span>
                    <span className="text-xs bg-black/25 text-white px-2 py-0.5 rounded-full flex-shrink-0">
                      {colLeads.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-3 overflow-y-auto max-h-[calc(100vh-20rem)] pr-0.5">
                    {colLeads.length === 0 ? (
                      <p className="text-center text-gray-700 text-xs py-8 border border-dashed border-gray-800 rounded-lg">
                        Drop a lead here
                      </p>
                    ) : (
                      colLeads.map(card)
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          /* ── List ─────────────────────────────────────────────────────── */
          <div className="border border-gray-800 rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[64rem]">
              <thead className="bg-gray-900">
                <tr className="text-left text-xs text-gray-500">
                  <th className="px-4 py-2.5 font-medium">Garage</th>
                  <th className="px-4 py-2.5 font-medium">Contact</th>
                  <th className="px-4 py-2.5 font-medium">Phone</th>
                  <th className="px-4 py-2.5 font-medium">Location</th>
                  <th className="px-4 py-2.5 font-medium">Main problem</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium text-center">Calls</th>
                  <th className="px-4 py-2.5 font-medium">Follow-up</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/70">
                {filtered.map((l) => (
                  <tr
                    key={l.id}
                    onClick={() => setSelectedId(l.id)}
                    className="cursor-pointer hover:bg-gray-900/60 transition-colors"
                  >
                    <td className="px-4 py-2.5 text-gray-100 font-medium">
                      <span className="flex items-center gap-2">
                        <span className="truncate max-w-[16rem]">{l.businessName}</span>
                        {(l.tags ?? []).map((t) => (
                          <span key={t} className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${TAG_META[t].chip}`}>
                            {TAG_META[t].label}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-400">{l.contactName || "—"}</td>
                    <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">{l.phone || "—"}</td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs">{l.location || l.district || "—"}</td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs max-w-[18rem] truncate">{l.mainProblem || "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full text-white whitespace-nowrap ${STAGE_META[l.stage].headerBg}`}>
                        {STAGE_META[l.stage].label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center text-gray-400">{l.callCount ?? 0}</td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs">
                      {l.nextFollowUp || l.followUpNote || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <p className="text-center text-gray-600 text-sm py-10">Nothing matches that search.</p>
            )}
          </div>
        )}
      </div>

      {/* Dialogs */}
      {adding && (
        <LeadFormModal
          onSave={(draft) => createLead(draft, admin).then(() => undefined)}
          onClose={() => setAdding(false)}
        />
      )}
      {editing && (
        <LeadFormModal
          initial={toDraft(editing)}
          onSave={(draft) => updateLead(editing.id, draft)}
          onClose={() => setEditing(null)}
        />
      )}
      {importing && (
        <Suspense fallback={null}>
          <LeadImportModal
            existingPhones={existingPhones}
            onImport={(drafts) => createLeads(drafts, admin).then(() => undefined)}
            onClose={() => setImporting(false)}
          />
        </Suspense>
      )}
      {selected && (
        <LeadDetailDrawer
          lead={selected}
          admin={admin}
          onClose={() => setSelectedId(null)}
          onEdit={() => { setEditing(selected); setSelectedId(null); }}
          onArchive={async () => { await archiveLead(selected.id); setSelectedId(null); }}
          onBookDemo={() => setDemoLeadId(selected.id)}
        />
      )}
      {demoLead && (
        <DemoScheduleModal
          lead={demoLead}
          leads={leads}
          admin={admin}
          onClose={() => setDemoLeadId(null)}
        />
      )}
      {reporting && (
        <Suspense fallback={null}>
          <DayReportModal leads={leads} onClose={() => setReporting(false)} />
        </Suspense>
      )}
    </div>
  );
}
