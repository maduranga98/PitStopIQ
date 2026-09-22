import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  X, Phone, Mail, MapPin, PhoneCall, StickyNote, Building2,
  Pencil, Archive, ExternalLink, Clock, CalendarClock, AlertCircle, Wallet,
  Trash2, Check, Plus, Bug, FileDown, FileText, ListChecks, XCircle, ChevronDown,
} from "lucide-react";
import { collection, orderBy, query, limit, where } from "firebase/firestore";
import { watchQuery } from "../../lib/listeners";
import { db } from "../../config/firebase";
import { inputClass } from "./AdminModal";
import {
  addLeadNote, addLeadNoteEntry, clearNextCall, deleteLeadNoteEntry,
  logLeadCall, setLeadCallCount, setLeadStage, updateLeadNoteEntry,
} from "../../lib/leads";
import type { AdminIdentity } from "../../lib/leads";
import { createTodo, reportBugFromCall, setTodoStatus } from "../../lib/devTracker";
import { exportLeadCSV, exportLeadPDF } from "../../lib/leadExport";
import type { Todo } from "../../types/devTracker";
import {
  CALL_OUTCOMES, LEAD_STAGES, LEAD_TAGS, MAX_TRACKED_CALLS,
  OUTCOME_LABEL, STAGE_META, TAG_META, demoLabel,
  type CallOutcome, type Lead, type LeadCall, type LeadNote, type LeadStage, type LeadTag,
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
  lead, admin, onClose, onEdit, onArchive, onBookDemo,
}: {
  lead: Lead;
  admin: AdminIdentity;
  onClose: () => void;
  onEdit: () => void;
  onArchive: () => void;
  /** Opens the demo scheduler, which the board owns so it can show every slot. */
  onBookDemo: () => void;
}) {
  const navigate = useNavigate();
  const [calls, setCalls] = useState<LeadCall[]>([]);
  const [outcome, setOutcome] = useState<CallOutcome>("connected");
  const [callTags, setCallTags] = useState<LeadTag[]>([]);
  const [note, setNote] = useState("");
  const [nextCallDate, setNextCallDate] = useState("");
  const [nextCallTime, setNextCallTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);

  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");

  const [todos, setTodos] = useState<Todo[]>([]);
  const [newTodoTitle, setNewTodoTitle] = useState("");
  const [newTodoDate, setNewTodoDate] = useState("");
  const [newTodoTime, setNewTodoTime] = useState("");

  const [reportingBug, setReportingBug] = useState(false);
  const [bugText, setBugText] = useState("");

  // Closed by default — the history can get long, and most visits to the
  // drawer are to log the next call, not to read the last twenty.
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    // Newest first, capped: the panel shows a history, not an archive, and a
    // lead chased for a year should still open in one round trip.
    return watchQuery(
      query(collection(db, "leads", lead.id, "calls"), orderBy("createdAt", "desc"), limit(100)),
      (snap) => setCalls(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LeadCall))),
      () => setCalls([]),
    );
  }, [lead.id]);

  useEffect(() => {
    return watchQuery(
      query(collection(db, "leads", lead.id, "notes"), orderBy("createdAt", "desc")),
      (snap) => setNotes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LeadNote))),
      () => setNotes([]),
    );
  }, [lead.id]);

  useEffect(() => {
    return watchQuery(
      query(collection(db, "todos"), where("leadId", "==", lead.id), orderBy("createdAt", "desc")),
      (snap) => setTodos(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Todo))),
      () => setTodos([]),
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
      await logLeadCall(lead, { outcome, tags: callTags, note, nextCallDate, nextCallTime }, admin);
      setNote("");
      setCallTags([]);
      setOutcome("connected");
      setNextCallDate("");
      setNextCallTime("");
    });

  const saveNote = () =>
    run(async () => {
      if (!note.trim()) return;
      await addLeadNote(lead, note, callTags, admin);
      setNote("");
      setCallTags([]);
    });

  const addServiceCenterNote = () =>
    run(async () => {
      if (!newNote.trim()) return;
      await addLeadNoteEntry(lead.id, newNote, admin);
      setNewNote("");
    });

  const saveNoteEdit = (noteId: string) =>
    run(async () => {
      if (!editingNoteText.trim()) return;
      await updateLeadNoteEntry(lead.id, noteId, editingNoteText, admin);
      setEditingNoteId(null);
      setEditingNoteText("");
    });

  const removeNote = (noteId: string) =>
    run(async () => {
      await deleteLeadNoteEntry(lead.id, noteId);
    });

  const addTodo = () =>
    run(async () => {
      if (!newTodoTitle.trim()) return;
      await createTodo(
        {
          title: newTodoTitle, description: "", leadId: lead.id, leadName: lead.businessName,
          dueDate: newTodoDate, dueTime: newTodoTime,
        },
        admin,
      );
      setNewTodoTitle("");
      setNewTodoDate("");
      setNewTodoTime("");
    });

  const toggleTodoDone = (todo: Todo) =>
    run(async () => {
      await setTodoStatus(todo, todo.status === "done" ? "open" : "done");
    });

  const submitBugReport = () =>
    run(async () => {
      if (!bugText.trim()) return;
      // The most recent call, if there is one — so the bug is tied to when it
      // was actually said, not just to the service center generally.
      const recentCallId = calls[0]?.id;
      await reportBugFromCall(lead.id, lead.businessName, recentCallId ?? "", bugText, admin);
      setBugText("");
      setReportingBug(false);
    });

  async function handleExport(kind: "csv" | "pdf") {
    setExporting(kind);
    try {
      // Feature requests for this lead are fetched on demand — the drawer
      // doesn't otherwise need them, so there is no listener to keep open.
      const { getDocs, collection: col, query: q, where: w } = await import("firebase/firestore");
      const snap = await getDocs(q(col(db, "featureRequests"), w("leadId", "==", lead.id)));
      const featureRequests = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as import("../../types/devTracker").FeatureRequest[];
      const bundle = { lead, calls, featureRequests };
      if (kind === "csv") exportLeadCSV(bundle);
      else await exportLeadPDF(bundle);
    } catch {
      setError("Couldn't build the export. Try again.");
    }
    setExporting(null);
  }

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
        address: lead.location ?? "",
      },
    });

  const stageMeta = STAGE_META[lead.stage];

  const summary = useMemo(
    () => [
      { icon: Phone, value: lead.phone, href: lead.phone ? `tel:${lead.phone}` : undefined },
      { icon: Mail, value: lead.email, href: lead.email ? `mailto:${lead.email}` : undefined },
      { icon: MapPin, value: lead.location || lead.district },
      { icon: Building2, value: lead.source && `via ${lead.source}` },
      {
        icon: CalendarClock,
        value: [demoLabel(lead) && `Demo ${demoLabel(lead)}`, lead.nextFollowUp || lead.followUpNote]
          .filter(Boolean).join(" · "),
      },
      {
        icon: Wallet,
        value: lead.closedAmount ? `Rs ${lead.closedAmount.toLocaleString("en-LK")}` : "",
      },
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
              <button
                onClick={() => handleExport("csv")}
                disabled={exporting !== null}
                title="Download as CSV"
                className="p-2 rounded-lg text-gray-500 hover:text-white hover:bg-gray-800 transition-colors disabled:opacity-40"
              >
                <FileDown className="w-4 h-4" />
              </button>
              <button
                onClick={() => handleExport("pdf")}
                disabled={exporting !== null}
                title="Download as PDF"
                className="p-2 rounded-lg text-gray-500 hover:text-white hover:bg-gray-800 transition-colors disabled:opacity-40"
              >
                <FileText className="w-4 h-4" />
              </button>
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

          {lead.mainProblem && (
            <div className="flex items-start gap-2.5 text-sm bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2.5">
              <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-xs text-amber-400/80 mb-0.5">Main problem</p>
                <p className="text-gray-200">{lead.mainProblem}</p>
              </div>
            </div>
          )}

          {lead.priceNote && (
            <p className="text-sm text-gray-400">
              <span className="text-gray-600">Price told:</span> {lead.priceNote}
            </p>
          )}

          {/* Service center notes — background detail, editable in place. Kept
              separate from the call log: this is reference material, not an
              audit trail, so entries can be corrected or removed. */}
          <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <StickyNote className="w-4 h-4 text-sky-400" />
              Notes
            </h3>
            {lead.notes && (
              <p className="text-sm text-gray-400 whitespace-pre-wrap border-b border-gray-800 pb-3">
                {lead.notes}
              </p>
            )}
            {notes.length > 0 && (
              <ul className="space-y-2">
                {notes.map((n) => (
                  <li key={n.id} className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2">
                    {editingNoteId === n.id ? (
                      <div className="space-y-2">
                        <textarea
                          className={`${inputClass} min-h-[60px] resize-y`}
                          value={editingNoteText}
                          onChange={(e) => setEditingNoteText(e.target.value)}
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveNoteEdit(n.id)}
                            disabled={saving}
                            className="px-2.5 py-1 rounded-md text-xs font-medium bg-orange-500 hover:bg-orange-600 text-white transition-colors"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => { setEditingNoteId(null); setEditingNoteText(""); }}
                            className="px-2.5 py-1 rounded-md text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm text-gray-300 whitespace-pre-wrap">{n.text}</p>
                        <div className="flex items-center justify-between mt-1.5">
                          <p className="text-xs text-gray-600">
                            {when(n.updatedAt ?? n.createdAt)}
                            {n.updatedByName ? ` · edited by ${n.updatedByName}` : n.createdByName ? ` · ${n.createdByName}` : ""}
                          </p>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => { setEditingNoteId(n.id); setEditingNoteText(n.text); }}
                              title="Edit note"
                              className="p-1 rounded text-gray-600 hover:text-white transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => removeNote(n.id)}
                              title="Delete note"
                              className="p-1 rounded text-gray-600 hover:text-red-300 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <textarea
                className={`${inputClass} min-h-[60px] resize-y`}
                placeholder="Service center details — address, billing arrangement, who to ask for…"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
              />
            </div>
            <button
              onClick={addServiceCenterNote}
              disabled={saving || !newNote.trim()}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-200 transition-colors"
            >
              Add note
            </button>
          </div>

          {/* Next call — booked from the call log below, cleared once it happens. */}
          {lead.nextCallAt && (
            <div className="flex items-start justify-between gap-3 bg-sky-500/10 border border-sky-500/20 rounded-lg px-3 py-2.5">
              <div className="flex items-start gap-2.5 min-w-0">
                <PhoneCall className="w-4 h-4 text-sky-400 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-xs text-sky-400/80 mb-0.5">Next call</p>
                  <p className="text-sm text-gray-200">{when(lead.nextCallAt)}</p>
                  {lead.nextCallNote && <p className="text-xs text-gray-500 mt-0.5">{lead.nextCallNote}</p>}
                </div>
              </div>
              <button
                onClick={() => run(() => clearNextCall(lead.id))}
                title="Clear the booked call"
                className="p-1.5 rounded-lg text-gray-500 hover:text-red-300 hover:bg-gray-800 transition-colors flex-shrink-0"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Pipeline controls */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-gray-400 mb-1.5">Status</span>
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

          {/* Demo ── the booked slot, and the way to book or move it. The
              scheduler shows what else is promised that day, which is why it
              is a dialog rather than a date field on this panel. */}
          <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <CalendarClock className="w-4 h-4 text-violet-400" />
                  Demo
                </h3>
                <p className="text-sm text-gray-300 mt-1">
                  {demoLabel(lead) || "Not booked yet."}
                </p>
                {lead.demoNote && (
                  <p className="text-xs text-gray-500 mt-1 whitespace-pre-wrap">{lead.demoNote}</p>
                )}
                {lead.demoConfirmedByName && (
                  <p className="text-xs text-gray-600 mt-1">
                    Confirmed by {lead.demoConfirmedByName}
                  </p>
                )}
              </div>
              <button
                onClick={onBookDemo}
                className="px-3 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white transition-colors flex-shrink-0"
              >
                {lead.demoDate ? "Move demo" : "Book demo"}
              </button>
            </div>
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

            <label className="block">
              <span className="block text-xs font-medium text-gray-400 mb-1.5">Next call (optional)</span>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  className={inputClass}
                  value={nextCallDate}
                  onChange={(e) => setNextCallDate(e.target.value)}
                />
                <input
                  type="time"
                  className={inputClass}
                  value={nextCallTime}
                  onChange={(e) => setNextCallTime(e.target.value)}
                />
              </div>
            </label>

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

            <button
              onClick={() => setReportingBug((v) => !v)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-300 hover:bg-red-500/10 border border-red-500/20 transition-colors"
            >
              <Bug className="w-3.5 h-3.5" /> Customer reported a bug on this call
            </button>
            {reportingBug && (
              <div className="space-y-2">
                <textarea
                  className={`${inputClass} min-h-[60px] resize-y`}
                  placeholder="What's broken, as they described it."
                  value={bugText}
                  onChange={(e) => setBugText(e.target.value)}
                />
                <button
                  onClick={submitBugReport}
                  disabled={saving || !bugText.trim()}
                  className="w-full px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 hover:bg-red-500/30 disabled:opacity-40 text-red-200 transition-colors"
                >
                  Send to Feature Requests
                </button>
              </div>
            )}

            {error && <p className="text-sm text-red-400">{error}</p>}
          </div>

          {/* To-dos linked to this service center */}
          <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <ListChecks className="w-4 h-4 text-emerald-400" />
              To-dos
            </h3>
            {todos.length > 0 && (
              <ul className="space-y-1.5">
                {todos.map((t) => (
                  <li key={t.id} className="flex items-start gap-2 text-sm">
                    <button
                      onClick={() => toggleTodoDone(t)}
                      className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                        t.status === "done" ? "bg-emerald-500 border-emerald-500" : "border-gray-700 hover:border-emerald-500"
                      }`}
                    >
                      {t.status === "done" && <Check className="w-3 h-3 text-white" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={`truncate ${t.status === "done" ? "text-gray-600 line-through" : "text-gray-200"}`}>
                        {t.title}
                      </p>
                      {t.dueAt && <p className="text-xs text-gray-600">{when(t.dueAt)}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <input
                className={inputClass}
                placeholder="Quick to-do…"
                value={newTodoTitle}
                onChange={(e) => setNewTodoTitle(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" className={inputClass} value={newTodoDate} onChange={(e) => setNewTodoDate(e.target.value)} />
              <input type="time" className={inputClass} value={newTodoTime} onChange={(e) => setNewTodoTime(e.target.value)} />
            </div>
            <button
              onClick={addTodo}
              disabled={saving || !newTodoTitle.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-200 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add to-do
            </button>
          </div>

          {/* History — closed by default; the drawer's own scroll area
              (below) grows to fit it once opened. */}
          <div>
            <button
              onClick={() => setHistoryOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2 text-sm font-semibold text-white"
            >
              <span>History{calls.length > 0 ? ` (${calls.length})` : ""}</span>
              <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${historyOpen ? "rotate-180" : ""}`} />
            </button>
            {historyOpen && (
              <div className="mt-3">
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
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
