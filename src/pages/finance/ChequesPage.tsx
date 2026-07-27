import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, limit, onSnapshot, orderBy, query, Timestamp } from "firebase/firestore";
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, Banknote, CalendarDays, CheckCircle2,
  ChevronLeft, ChevronRight, Clock, ExternalLink, FileText, Landmark, RotateCcw,
  Search, Undo2, X,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { LoadingBlock } from "../../components/LoadingProgress";
import { formatLKR } from "../../lib/inventoryPricing";
import type { DistributorOrder, Invoice, SupplierSupply } from "../../types/auth";
import {
  applyRegisterState, chequesByDay, collectRegisterEntries, dayKey, effectiveDate,
  isOverdue, monthGrid, pendingTotals, settleActionLabel, sourceLabel, stateLabel,
  type RegisterEntry, type RegisterState,
} from "../../lib/chequeRegister";

// The cheque drawer, on a screen. Every cheque the workshop is holding and
// every cheque it has written, plus the credit either way — read out of the
// invoices, distributor orders and deliveries they were recorded against, and
// laid over a calendar so the two questions that actually matter each morning
// are answerable at a glance: what do we take to the bank today, and what has
// to be in the account before someone presents ours?

// A center rarely has more open paper than this; the cap keeps the page from
// pulling its whole history down on every visit.
const DOC_LIMIT = 500;

function formatDate(ts?: Timestamp | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "2026-07-05" → local midnight (`new Date(s)` would read it as UTC). */
function parseDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

type Tab = "calendar" | "list";
type KindFilter = "all" | "cheque" | "credit";
type DirectionFilter = "all" | "incoming" | "outgoing";
type StateFilter = "pending" | "settled" | "returned" | "all";

// ── Entry row ─────────────────────────────────────────────────────────────────

function StateChip({ entry }: { entry: RegisterEntry }) {
  const tone =
    entry.state === "settled" ? "bg-green-500/15 text-green-400 border-green-500/30"
    : entry.state === "returned" ? "bg-red-500/15 text-red-400 border-red-500/30"
    : isOverdue(entry) ? "bg-red-500/15 text-red-300 border-red-500/30"
    : "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${tone}`}>
      {isOverdue(entry) ? "Overdue" : stateLabel(entry)}
    </span>
  );
}

function EntryRow({ entry, onOpen }: { entry: RegisterEntry; onOpen: () => void }) {
  const Icon = entry.kind === "cheque" ? FileText : Clock;
  const incoming = entry.direction === "incoming";
  return (
    <button
      onClick={onOpen}
      className="w-full text-left bg-[#162032] border border-white/10 hover:border-[#F97316]/40 rounded-xl px-4 py-3 transition"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className={`mt-0.5 p-1.5 rounded-lg ${incoming ? "bg-blue-500/10" : "bg-violet-500/10"}`}>
            <Icon className={`h-4 w-4 ${incoming ? "text-blue-400" : "text-violet-400"}`} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-white truncate">{entry.partyName}</span>
              <span className="text-[11px] text-gray-500 font-mono">{entry.reference}</span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              {entry.kind === "cheque"
                ? `Cheque ${entry.chequeNumber ?? "—"} · ${entry.bank ?? "—"}${entry.branch ? `, ${entry.branch}` : ""}`
                : `${incoming ? "Credit given" : "Credit taken"} · ${sourceLabel(entry.source)}`}
            </p>
            <p className="text-xs text-gray-600 mt-0.5">
              {entry.dueDate ? `Due ${formatDate(entry.dueDate)}` : `Since ${formatDate(entry.date)}`}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <span className={`text-sm font-semibold ${incoming ? "text-green-400" : "text-amber-400"}`}>
            {incoming ? "+" : "−"}{formatLKR(entry.amount)}
          </span>
          <StateChip entry={entry} />
        </div>
      </div>
    </button>
  );
}

// ── Detail modal ──────────────────────────────────────────────────────────────

function EntryModal({
  entry, busy, error, onSetState, onClose,
}: {
  entry: RegisterEntry;
  busy: boolean;
  error: string;
  onSetState: (state: RegisterState, reason?: string) => void;
  onClose: () => void;
}) {
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState("");
  const incoming = entry.direction === "incoming";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-white">
                {entry.kind === "cheque" ? "Cheque" : "Credit"}
              </h3>
              <StateChip entry={entry} />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {incoming ? "Receivable" : "Payable"} · {sourceLabel(entry.source)}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="bg-[#0B1120] border border-white/5 rounded-xl p-4 mb-4">
          <div className={`text-2xl font-bold ${incoming ? "text-green-400" : "text-amber-400"}`}>
            {incoming ? "+" : "−"}{formatLKR(entry.amount)}
          </div>
          <p className="text-sm text-white mt-1">{entry.partyName}</p>
          {entry.partySubtitle && <p className="text-xs text-gray-500">{entry.partySubtitle}</p>}
        </div>

        <dl className="space-y-2 text-sm">
          <Row label="Reference" value={entry.reference} mono />
          {entry.kind === "cheque" && (
            <>
              <Row label="Cheque no." value={entry.chequeNumber ?? "—"} mono />
              <Row label="Bank" value={[entry.bank, entry.branch].filter(Boolean).join(", ") || "—"} />
              <Row label="Cheque date" value={formatDate(entry.dueDate)} />
            </>
          )}
          <Row label={entry.kind === "cheque" ? "Recorded on" : "Agreed on"} value={formatDate(entry.date)} />
          {entry.note && <Row label="Note" value={entry.note} />}
          {entry.recordedByName && <Row label="Recorded by" value={entry.recordedByName} />}
          {entry.state === "settled" && entry.settledByName && (
            <Row label="Confirmed by" value={`${entry.settledByName} · ${formatDate(entry.settledAt)}`} />
          )}
          {entry.state === "returned" && (
            <Row
              label="Returned"
              value={`${entry.returnedByName ?? "—"} · ${formatDate(entry.returnedAt)}${entry.returnReason ? ` · ${entry.returnReason}` : ""}`}
            />
          )}
        </dl>

        {error && (
          <p className="text-sm text-red-400 flex items-center gap-1.5 mt-4">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
          </p>
        )}

        {returning ? (
          <div className="mt-5 space-y-3">
            <label className="block text-sm font-medium text-gray-300">
              Why did it come back? <span className="text-gray-600 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Insufficient funds"
              className="w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition"
            />
            <p className="text-xs text-gray-500">
              {incoming
                ? "The amount stops counting as received and the balance on the source document reopens."
                : "The payment is undone, so the supplier is owed the amount again."}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setReturning(false)}
                className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => onSetState("returned", reason)}
                disabled={busy}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm"
              >
                {busy ? "Saving…" : "Mark returned"}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-2">
            {entry.state !== "settled" && (
              <button
                onClick={() => onSetState("settled")}
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm"
              >
                <CheckCircle2 className="h-4 w-4" />
                {settleActionLabel(entry)}
              </button>
            )}
            {entry.state !== "returned" && (
              <button
                onClick={() => setReturning(true)}
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 disabled:opacity-60 text-red-300 font-medium py-2.5 px-4 rounded-lg transition text-sm"
              >
                <Undo2 className="h-4 w-4" />
                {entry.kind === "cheque" ? "Mark returned" : "Write back"}
              </button>
            )}
            {entry.state !== "pending" && (
              <button
                onClick={() => onSetState("pending")}
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-60 text-gray-300 font-medium py-2.5 px-4 rounded-lg transition text-sm"
              >
                <RotateCcw className="h-4 w-4" />
                Reopen as pending
              </button>
            )}
            {entry.href && (
              <Link
                to={entry.href}
                className="w-full flex items-center justify-center gap-2 text-xs text-gray-400 hover:text-white py-2 transition"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open {sourceLabel(entry.source).toLowerCase()}
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-gray-500 flex-shrink-0">{label}</dt>
      <dd className={`text-gray-200 text-right break-words ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ChequesPage() {
  const { currentUser } = useAuth();
  const centerId = currentUser?.centerId ?? "";
  const canManage = currentUser?.role === "Owner" || currentUser?.role === "Manager";

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [orders, setOrders] = useState<DistributorOrder[]>([]);
  const [supplies, setSupplies] = useState<SupplierSupply[]>([]);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<Tab>("calendar");
  const [cursor, setCursor] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [openEntry, setOpenEntry] = useState<RegisterEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState("");

  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("all");
  const [stateFilter, setStateFilter] = useState<StateFilter>("pending");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(
      query(collection(db, "servicecenters", centerId, "invoices"), orderBy("createdAt", "desc"), limit(DOC_LIMIT)),
      snap => {
        setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() } as Invoice)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [centerId]);

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(
      query(collection(db, "servicecenters", centerId, "distributorOrders"), orderBy("createdAt", "desc"), limit(DOC_LIMIT)),
      snap => setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as DistributorOrder))),
      () => setOrders([]),
    );
  }, [centerId]);

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(
      query(collection(db, "servicecenters", centerId, "supplierSupplies"), orderBy("createdAt", "desc"), limit(DOC_LIMIT)),
      snap => setSupplies(snap.docs.map(d => ({ id: d.id, ...d.data() } as SupplierSupply))),
      () => setSupplies([]),
    );
  }, [centerId]);

  const entries = useMemo(
    () => collectRegisterEntries({ invoices, orders, supplies })
      .sort((a, b) => effectiveDate(a).getTime() - effectiveDate(b).getTime()),
    [invoices, orders, supplies],
  );

  const sources = useMemo(() => ({
    invoices: new Map(invoices.map(i => [i.id, i])),
    orders: new Map(orders.map(o => [o.id, o])),
    supplies: new Map(supplies.map(s => [s.id, s])),
  }), [invoices, orders, supplies]);

  // The open modal reads from `entries`, so it refreshes itself as soon as the
  // write lands rather than showing the state it was opened with.
  const activeEntry = useMemo(
    () => (openEntry ? entries.find(e => e.key === openEntry.key) ?? openEntry : null),
    [entries, openEntry],
  );

  const totals = useMemo(() => pendingTotals(entries), [entries]);
  const byDay = useMemo(() => chequesByDay(entries), [entries]);
  const grid = useMemo(() => monthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter(e => {
      if (kindFilter !== "all" && e.kind !== kindFilter) return false;
      if (directionFilter !== "all" && e.direction !== directionFilter) return false;
      if (stateFilter !== "all" && e.state !== stateFilter) return false;
      if (!q) return true;
      return e.partyName.toLowerCase().includes(q)
        || e.reference.toLowerCase().includes(q)
        || (e.chequeNumber ?? "").toLowerCase().includes(q)
        || (e.bank ?? "").toLowerCase().includes(q);
    });
  }, [entries, kindFilter, directionFilter, stateFilter, search]);

  const dayEntries = selectedDay ? byDay.get(selectedDay) : undefined;

  async function handleSetState(state: RegisterState, reason?: string) {
    if (!activeEntry || !centerId || !currentUser) return;
    setBusy(true);
    setModalError("");
    try {
      await applyRegisterState(centerId, activeEntry, state, sources, {
        uid: currentUser.uid,
        name: currentUser.displayName ?? currentUser.email ?? "Staff",
      }, reason);
      setOpenEntry(null);
    } catch {
      setModalError("Could not update this entry. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <Banknote className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">
            Only an Owner or Manager can open the cheque &amp; credit register.
          </p>
        </div>
      </div>
    );
  }

  const today = new Date();

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<Banknote className="w-5 h-5" />}
        title="Cheques & Credits"
        below={
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-3">
            <div className="flex bg-white/5 rounded-lg p-0.5 gap-0.5 w-fit">
              {([["calendar", "Calendar"], ["list", "All entries"]] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                    tab === key ? "bg-orange-500 text-white" : "text-gray-400 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* What's still open, the four ways it's thought about */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard
            icon={<ArrowDownLeft className="h-5 w-5 text-blue-400" />}
            accent="bg-blue-500/10"
            label="Cheques to bank"
            value={formatLKR(totals.chequesIn)}
            sub="Received, not yet cleared"
          />
          <SummaryCard
            icon={<ArrowUpRight className="h-5 w-5 text-violet-400" />}
            accent="bg-violet-500/10"
            label="Cheques to fund"
            value={formatLKR(totals.chequesOut)}
            sub="Written, not yet presented"
          />
          <SummaryCard
            icon={<Landmark className="h-5 w-5 text-green-400" />}
            accent="bg-green-500/10"
            label="Credit receivable"
            value={formatLKR(totals.creditReceivable)}
            sub="Customers & distributors owe"
          />
          <SummaryCard
            icon={<Clock className="h-5 w-5 text-amber-400" />}
            accent="bg-amber-500/10"
            label="Credit payable"
            value={formatLKR(totals.creditPayable)}
            sub="Owed to suppliers"
          />
        </div>

        {(totals.overdueCount > 0 || totals.returnedCount > 0) && (
          <div className="flex flex-wrap gap-3">
            {totals.overdueCount > 0 && (
              <button
                onClick={() => { setTab("list"); setStateFilter("pending"); }}
                className="flex items-center gap-2 bg-red-500/10 border border-red-500/25 text-red-300 text-sm px-3 py-2 rounded-xl hover:bg-red-500/15 transition"
              >
                <AlertTriangle className="h-4 w-4" />
                {totals.overdueCount} past its date and still open
              </button>
            )}
            {totals.returnedCount > 0 && (
              <button
                onClick={() => { setTab("list"); setStateFilter("returned"); }}
                className="flex items-center gap-2 bg-white/5 border border-white/10 text-gray-300 text-sm px-3 py-2 rounded-xl hover:bg-white/10 transition"
              >
                <Undo2 className="h-4 w-4" />
                {totals.returnedCount} returned
              </button>
            )}
          </div>
        )}

        {loading ? (
          <LoadingBlock className="py-20" />
        ) : tab === "calendar" ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Month grid */}
            <div className="lg:col-span-2 bg-[#162032] border border-white/10 rounded-2xl p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-[#F97316]" />
                  {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
                </h2>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
                    className="px-2.5 py-1 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/5 transition"
                  >
                    Today
                  </button>
                  <button
                    onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-1 sm:gap-2">
                {WEEKDAYS.map(d => (
                  <div key={d} className="text-[11px] text-gray-500 uppercase tracking-wider text-center pb-1">
                    {d}
                  </div>
                ))}
                {grid.map(date => {
                  const key = dayKey(date);
                  const day = byDay.get(key);
                  const inMonth = date.getMonth() === cursor.getMonth();
                  const isToday = sameDay(date, today);
                  const selected = selectedDay === key;
                  const toBank = day?.toBank.filter(e => e.state === "pending").length ?? 0;
                  const toFund = day?.toFund.filter(e => e.state === "pending").length ?? 0;
                  const settledCount = (day?.toBank.length ?? 0) + (day?.toFund.length ?? 0) - toBank - toFund;
                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedDay(day ? key : null)}
                      disabled={!day}
                      className={`min-h-[64px] sm:min-h-[76px] rounded-xl border p-1.5 text-left transition ${
                        selected ? "border-[#F97316] bg-[#F97316]/10"
                        : day ? "border-white/10 bg-[#0B1120] hover:border-white/25"
                        : "border-transparent bg-[#0B1120]/40 cursor-default"
                      }`}
                    >
                      <div
                        className={`text-xs font-medium ${
                          !inMonth ? "text-gray-700" : isToday ? "text-[#F97316]" : "text-gray-300"
                        }`}
                      >
                        {date.getDate()}
                      </div>
                      <div className="mt-1 space-y-0.5">
                        {toBank > 0 && (
                          <div className="flex items-center gap-1 text-[10px] font-medium text-blue-300 bg-blue-500/15 border border-blue-500/25 rounded px-1 py-0.5">
                            <ArrowDownLeft className="h-2.5 w-2.5 flex-shrink-0" />
                            {toBank} to bank
                          </div>
                        )}
                        {toFund > 0 && (
                          <div className="flex items-center gap-1 text-[10px] font-medium text-violet-300 bg-violet-500/15 border border-violet-500/25 rounded px-1 py-0.5">
                            <ArrowUpRight className="h-2.5 w-2.5 flex-shrink-0" />
                            {toFund} to fund
                          </div>
                        )}
                        {toBank === 0 && toFund === 0 && settledCount > 0 && (
                          <div className="text-[10px] text-gray-600">{settledCount} done</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t border-white/5 text-[11px] text-gray-500">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-blue-400" /> To bank — cheques you're holding, dated that day
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-violet-400" /> To fund — cheques you wrote, presented that day
                </span>
              </div>
            </div>

            {/* Day detail */}
            <div className="bg-[#162032] border border-white/10 rounded-2xl p-5">
              <h2 className="text-base font-semibold text-white mb-1">
                {selectedDay
                  ? parseDayKey(selectedDay).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
                  : "Pick a day"}
              </h2>
              <p className="text-xs text-gray-500 mb-4">
                {selectedDay
                  ? "Cheques falling due on this date."
                  : "Days with cheques are clickable. Select one to see what's due."}
              </p>

              {dayEntries ? (
                <div className="space-y-4">
                  {dayEntries.toBank.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-blue-300 uppercase tracking-wider mb-2">
                        To bank ({dayEntries.toBank.length})
                      </p>
                      <div className="space-y-2">
                        {dayEntries.toBank.map(e => (
                          <EntryRow key={e.key} entry={e} onOpen={() => { setOpenEntry(e); setModalError(""); }} />
                        ))}
                      </div>
                    </div>
                  )}
                  {dayEntries.toFund.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-violet-300 uppercase tracking-wider mb-2">
                        Money needed ({dayEntries.toFund.length})
                      </p>
                      <div className="space-y-2">
                        {dayEntries.toFund.map(e => (
                          <EntryRow key={e.key} entry={e} onOpen={() => { setOpenEntry(e); setModalError(""); }} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-600 py-6 text-center">Nothing selected.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Filters */}
            <div className="bg-[#162032] border border-white/10 rounded-2xl p-4 flex flex-col lg:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search party, reference, cheque number or bank…"
                  className="w-full pl-9 pr-4 py-2.5 bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-xl text-sm text-white placeholder-gray-600 transition"
                />
              </div>
              <FilterGroup
                value={stateFilter}
                onChange={setStateFilter}
                options={[["pending", "Open"], ["settled", "Settled"], ["returned", "Returned"], ["all", "All"]]}
              />
              <FilterGroup
                value={directionFilter}
                onChange={setDirectionFilter}
                options={[["all", "Both ways"], ["incoming", "Receivable"], ["outgoing", "Payable"]]}
              />
              <FilterGroup
                value={kindFilter}
                onChange={setKindFilter}
                options={[["all", "All"], ["cheque", "Cheques"], ["credit", "Credit"]]}
              />
            </div>

            {filtered.length === 0 ? (
              <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3 text-center">
                <FileText className="h-12 w-12 text-gray-700" />
                <p className="text-gray-400 font-medium">
                  {entries.length === 0 ? "No cheques or credit recorded yet" : "Nothing matches these filters"}
                </p>
                <p className="text-sm text-gray-600 max-w-md">
                  Cheques and credit appear here as soon as they're recorded against a customer invoice, a
                  distributor order, or a supplier delivery.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map(e => (
                  <EntryRow key={e.key} entry={e} onOpen={() => { setOpenEntry(e); setModalError(""); }} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {activeEntry && (
        <EntryModal
          entry={activeEntry}
          busy={busy}
          error={modalError}
          onSetState={handleSetState}
          onClose={() => { setOpenEntry(null); setModalError(""); }}
        />
      )}
    </div>
  );
}

function SummaryCard({ icon, label, value, sub, accent }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; accent: string;
}) {
  return (
    <div className="bg-[#162032] border border-white/10 rounded-2xl p-5">
      <div className={`p-2.5 rounded-xl inline-flex mb-3 ${accent}`}>{icon}</div>
      <div className="text-xl font-bold text-white">{value}</div>
      <div className="text-sm text-gray-400">{label}</div>
      {sub && <div className="text-xs text-gray-600 mt-0.5">{sub}</div>}
    </div>
  );
}

function FilterGroup<T extends string>({ value, onChange, options }: {
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div className="flex bg-[#0B1120] border border-white/10 rounded-xl p-0.5 gap-0.5 w-fit">
      {options.map(([key, label]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition ${
            value === key ? "bg-[#F97316] text-white" : "text-gray-400 hover:text-white"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
