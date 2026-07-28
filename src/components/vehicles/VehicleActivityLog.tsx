import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, limit as fsLimit, Timestamp } from "firebase/firestore";
import {
  History, Flag, Send, ChevronDown, ChevronUp, Pencil, X, CheckCircle, AlertCircle,
} from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { VehicleLogEntry } from "../../types/auth";
import { deleteVehicleLog, logVehicleEvent, updateVehicleNote } from "../../lib/vehicleLogs";
import { LoadingBlock } from "../LoadingProgress";

function formatDateTime(ts: Timestamp): string {
  return ts.toDate().toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// A busy vehicle accumulates hundreds of log entries — open on a handful and
// expand on request, so the panel stays readable without hiding anything.
const VISIBLE_LOGS = 8;

interface Props {
  centerId: string;
  vehicleId: string;
  /** Can post a new note (a staff note or a flag for next visit). */
  canAdd: boolean;
  /** Can reword or remove an existing note — not for a system entry. */
  canManage: boolean;
}

/**
 * A vehicle's activity log, shared between the Vehicle page (full staff view)
 * and a job card (the technician's view of the one vehicle they're working
 * on). Flagged entries — things the next visit should specifically check —
 * are shown in their own list, separate from the general log, so they can't
 * get lost among routine notes and system events.
 */
export default function VehicleActivityLog({ centerId, vehicleId, canAdd, canManage }: Props) {
  const { currentUser } = useAuth();

  const [logs, setLogs] = useState<VehicleLogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [noteText, setNoteText] = useState("");
  const [noteNeedsFollowUp, setNoteNeedsFollowUp] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editFollowUp, setEditFollowUp] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingLogId, setDeletingLogId] = useState<string | null>(null);
  const [logError, setLogError] = useState("");

  useEffect(() => {
    if (!vehicleId || !centerId) return;
    setLoadingLogs(true);
    return onSnapshot(
      query(
        collection(db, "servicecenters", centerId, "vehicles", vehicleId, "logs"),
        orderBy("createdAt", "desc"),
        fsLimit(100),
      ),
      (snap) => {
        setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as VehicleLogEntry)));
        setLoadingLogs(false);
      },
      () => setLoadingLogs(false),
    );
  }, [vehicleId, centerId]);

  async function handleAddNote() {
    const message = noteText.trim();
    if (!message || !vehicleId || !centerId) return;
    setSavingNote(true);
    try {
      await logVehicleEvent(centerId, vehicleId, {
        type: "note",
        message,
        needsFollowUp: noteNeedsFollowUp,
        actor: currentUser,
      });
      setNoteText("");
      setNoteNeedsFollowUp(false);
    } finally {
      setSavingNote(false);
    }
  }

  function startEditingLog(log: VehicleLogEntry) {
    setEditingLogId(log.id);
    setEditText(log.message);
    setEditFollowUp(Boolean(log.needsFollowUp));
    setLogError("");
  }

  async function handleSaveLogEdit(logId: string) {
    const message = editText.trim();
    if (!message || !vehicleId || !centerId) return;
    setSavingEdit(true);
    setLogError("");
    try {
      await updateVehicleNote(
        centerId, vehicleId, logId,
        { message, needsFollowUp: editFollowUp },
        currentUser,
      );
      setEditingLogId(null);
    } catch {
      setLogError("Could not save the note. Please try again.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteLog(log: VehicleLogEntry) {
    if (!vehicleId || !centerId) return;
    if (!window.confirm("Delete this activity log entry? This cannot be undone.")) return;
    setDeletingLogId(log.id);
    setLogError("");
    try {
      await deleteVehicleLog(centerId, vehicleId, log.id);
      if (editingLogId === log.id) setEditingLogId(null);
    } catch {
      setLogError("Could not delete the entry. Please try again.");
    } finally {
      setDeletingLogId(null);
    }
  }

  const flagged = logs.filter((l) => l.needsFollowUp);
  const general = logs.filter((l) => !l.needsFollowUp);

  function renderEntry(log: VehicleLogEntry) {
    const editing = editingLogId === log.id;
    return (
      <div
        key={log.id}
        className={`flex items-start gap-3 p-3 rounded-xl border ${
          log.needsFollowUp
            ? "bg-amber-500/5 border-amber-500/20"
            : "bg-[#0B1120]/50 border-white/5"
        }`}
      >
        <div className="shrink-0 mt-0.5">
          {log.needsFollowUp ? (
            <Flag className="w-3.5 h-3.5 text-amber-400" />
          ) : (
            <div className={`w-2 h-2 mt-1 rounded-full ${log.type === "note" ? "bg-blue-400" : "bg-gray-600"}`} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-2">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={2}
                maxLength={500}
                autoFocus
                className="w-full bg-[#0B1120] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#F97316]/50 resize-none"
              />
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editFollowUp}
                    onChange={(e) => setEditFollowUp(e.target.checked)}
                    className="rounded border-white/20 bg-[#0B1120] text-[#F97316] focus:ring-0 focus:ring-offset-0"
                  />
                  <Flag className="w-3.5 h-3.5" />
                  Flag for next visit
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditingLogId(null)}
                    className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleSaveLogEdit(log.id)}
                    disabled={savingEdit || !editText.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#F97316] hover:bg-[#EA6C10] disabled:opacity-50 text-white rounded-lg transition-colors"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    {savingEdit ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-white whitespace-pre-wrap break-words">{log.message}</p>
              <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 flex-wrap">
                <span>{formatDateTime(log.createdAt)}</span>
                {log.authorName && <span>· {log.authorName}</span>}
                {log.type === "note" && <span className="text-blue-400">· Note</span>}
                {log.editedAt && (
                  <span title={`Edited ${formatDateTime(log.editedAt)}`}>
                    · edited{log.editedByName ? ` by ${log.editedByName}` : ""}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {canManage && !editing && (
          <div className="flex items-center gap-1 shrink-0">
            {log.type === "note" && (
              <button
                onClick={() => startEditingLog(log)}
                title="Edit this note"
                className="p-1.5 text-gray-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => handleDeleteLog(log)}
              disabled={deletingLogId === log.id}
              title="Delete this entry"
              className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
            >
              {deletingLogId === log.id ? (
                <div className="w-3.5 h-3.5 border border-gray-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <X className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-[#162032] border border-white/10 rounded-2xl p-6">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
        <History className="w-4 h-4" />
        Activity Log
        {logs.length > 0 && (
          <span className="text-gray-600 font-normal normal-case">({logs.length})</span>
        )}
      </h2>

      {canAdd && (
        <div className="mb-5 bg-[#0B1120]/50 border border-white/5 rounded-xl p-4 space-y-3">
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Add a note — e.g. something to check or change on the next visit…"
            className="w-full bg-[#0B1120] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#F97316]/50 resize-none"
          />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={noteNeedsFollowUp}
                onChange={(e) => setNoteNeedsFollowUp(e.target.checked)}
                className="rounded border-white/20 bg-[#0B1120] text-[#F97316] focus:ring-0 focus:ring-offset-0"
              />
              <Flag className="w-3.5 h-3.5" />
              Flag for next visit
            </label>
            <button
              onClick={handleAddNote}
              disabled={savingNote || !noteText.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#F97316] hover:bg-[#EA6C10] disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              {savingNote ? "Saving…" : "Add Note"}
            </button>
          </div>
        </div>
      )}

      {logError && (
        <p className="flex items-center gap-1 text-xs text-red-400 mb-3">
          <AlertCircle className="w-3.5 h-3.5" /> {logError}
        </p>
      )}

      {loadingLogs ? (
        <LoadingBlock className="py-8" />
      ) : logs.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <History className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No activity recorded yet</p>
        </div>
      ) : (
        <>
          {/* Flags — kept apart from the general log so a follow-up item never
              gets lost scrolling through routine notes and system events. */}
          {flagged.length > 0 && (
            <div className="mb-5">
              <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Flag className="w-3.5 h-3.5" />
                Flagged for Follow-Up
                <span className="text-gray-600 font-normal normal-case">({flagged.length})</span>
              </h3>
              <div className="space-y-2">
                {flagged.map(renderEntry)}
              </div>
            </div>
          )}

          <div>
            {flagged.length > 0 && (
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Activity Log
              </h3>
            )}
            {general.length === 0 ? (
              <p className="text-sm text-gray-500 py-2">No other activity recorded.</p>
            ) : (
              <>
                <div className={`space-y-2 pr-1 ${showAllLogs ? "max-h-[32rem] overflow-y-auto" : ""}`}>
                  {(showAllLogs ? general : general.slice(0, VISIBLE_LOGS)).map(renderEntry)}
                </div>
                {general.length > VISIBLE_LOGS && (
                  <button
                    onClick={() => setShowAllLogs((v) => !v)}
                    className="w-full mt-2 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-gray-400 hover:text-white border border-white/5 hover:border-white/10 rounded-xl transition-colors"
                  >
                    {showAllLogs ? (
                      <>
                        <ChevronUp className="w-3.5 h-3.5" />
                        Show less
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3.5 h-3.5" />
                        View all {general.length} entries
                      </>
                    )}
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
