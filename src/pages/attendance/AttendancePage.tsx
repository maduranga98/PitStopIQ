import { useEffect, useState, useCallback, useMemo } from "react";
import {
  doc, getDoc, collection, onSnapshot, orderBy, query, Timestamp,
} from "firebase/firestore";
import { safeSetDoc } from "../../lib/firestoreWrite";
import { ChevronLeft, ChevronRight, CalendarCheck, X, Loader2, AlertTriangle } from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type {
  StaffMember, AttendanceStatus, AttendanceDayRecord, OvertimeSettings,
} from "../../types/auth";
import { LoadingBlock } from "../../components/LoadingProgress";
import PageHeader from "../../components/layout/PageHeader";
import {
  withOvertimeDefaults, lateMinutesFor, overtimeHoursFor, workedMinutesFor,
  effectiveOtHours, formatMinutes,
} from "../../lib/overtime";

// ── Constants / Helpers ──────────────────────────────────────────────────────
const ATTENDANCE_COLORS: Record<AttendanceStatus, string> = {
  present:  "bg-green-500/30 text-green-300 border border-green-500/40",
  absent:   "bg-red-500/30 text-red-300 border border-red-500/40",
  half_day: "bg-amber-500/30 text-amber-300 border border-amber-500/40",
  holiday:  "bg-blue-500/30 text-blue-300 border border-blue-500/40",
};

const STATUS_ABBR: Record<AttendanceStatus, string> = {
  present: "P", absent: "A", half_day: "½", holiday: "H",
};

const STATUS_ORDER: AttendanceStatus[] = ["present", "half_day", "absent", "holiday"];

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function yearMonthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Monday of the week containing `d`.
function mondayOf(d: Date): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const offset = copy.getDay() === 0 ? -6 : 1 - copy.getDay();
  copy.setDate(copy.getDate() + offset);
  return copy;
}

/** The month document as it is stored: statuses, plus times where recorded. */
interface MonthCache {
  days: Record<string, AttendanceStatus>;
  records: Record<string, AttendanceDayRecord>;
}

const EMPTY_MONTH: MonthCache = { days: {}, records: {} };

interface DayEditorTarget {
  staff: StaffMember;
  day: Date;
}

export default function AttendancePage() {
  const { currentUser } = useAuth();
  const centerId = currentUser?.centerId ?? "";
  const viewerRole = currentUser?.role;
  const canMark = viewerRole === "Owner" || viewerRole === "Manager";
  const canView = viewerRole === "Owner" || viewerRole === "Manager";

  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(true);
  // Cache of month attendance docs, keyed "staffId:YYYY-MM".
  const [monthDocs, setMonthDocs] = useState<Record<string, MonthCache>>({});
  const [otSettings, setOtSettings] = useState<OvertimeSettings>(() => withOvertimeDefaults(null));
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<DayEditorTarget | null>(null);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const monthKeys = useMemo(() => {
    return Array.from(new Set(weekDays.map(yearMonthKey)));
  }, [weekDays]);

  // Load active staff
  useEffect(() => {
    if (!centerId) return;
    const q = query(collection(db, "servicecenters", centerId, "staff"), orderBy("fullName"));
    return onSnapshot(q, (snap) => {
      setStaff(snap.docs.map((d) => ({ id: d.id, ...d.data() } as StaffMember)).filter((s) => s.active));
      setLoadingStaff(false);
    });
  }, [centerId]);

  // The center's shift/OT policy decides who counts as late and how much
  // overtime a day earns, so attendance reads it live.
  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(
      doc(db, "servicecenters", centerId, "payrollSettings", "overtime"),
      (snap) => setOtSettings(withOvertimeDefaults(snap.exists() ? (snap.data() as OvertimeSettings) : null)),
      () => setOtSettings(withOvertimeDefaults(null)),
    );
  }, [centerId]);

  // Load (and cache) the month attendance docs the visible week touches, for every staff member.
  const loadMonthDocs = useCallback(async () => {
    if (!centerId || staff.length === 0) return;
    const entries = await Promise.all(
      staff.flatMap((s) =>
        monthKeys.map(async (ym) => {
          const snap = await getDoc(doc(db, "servicecenters", centerId, "staff", s.id, "attendance", ym));
          const data = snap.exists()
            ? (snap.data() as { days?: Record<string, AttendanceStatus>; records?: Record<string, AttendanceDayRecord> })
            : {};
          return [`${s.id}:${ym}`, { days: data.days ?? {}, records: data.records ?? {} }] as const;
        }),
      ),
    );
    setMonthDocs((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
  }, [centerId, staff, monthKeys]);

  useEffect(() => {
    loadMonthDocs();
  }, [loadMonthDocs]);

  function monthCache(staffId: string, day: Date): MonthCache {
    return monthDocs[`${staffId}:${yearMonthKey(day)}`] ?? EMPTY_MONTH;
  }

  function statusFor(staffId: string, day: Date): AttendanceStatus | undefined {
    return monthCache(staffId, day).days[dateKey(day)];
  }

  /**
   * The stored record for a day. Days marked before clock times existed have
   * a status in `days` but no record — synthesise one so the editor and the
   * grid can treat both shapes the same.
   */
  function recordFor(staffId: string, day: Date): AttendanceDayRecord | undefined {
    const cache = monthCache(staffId, day);
    const key = dateKey(day);
    const record = cache.records[key];
    if (record) return record;
    const status = cache.days[key];
    return status ? { status } : undefined;
  }

  /**
   * Writes one day for one employee. Passing `null` clears the day. Both the
   * plain status map and the detailed record are written together so readers
   * that only know about `days` (payslip stats, the employee page) stay
   * correct.
   */
  async function saveDay(staffId: string, day: Date, record: AttendanceDayRecord | null) {
    if (!canMark || !centerId) return;
    const ym = yearMonthKey(day);
    const cacheKey = `${staffId}:${ym}`;
    const cache = monthDocs[cacheKey] ?? EMPTY_MONTH;
    const key = dateKey(day);

    const days = { ...cache.days };
    const records = { ...cache.records };
    if (record === null) {
      delete days[key];
      delete records[key];
    } else {
      days[key] = record.status;
      records[key] = record;
    }

    setMonthDocs((prev) => ({ ...prev, [cacheKey]: { days, records } }));
    setSaving(true);
    try {
      // Written whole rather than merged: a merge deep-merges the two maps,
      // so a day cleared here would survive on the server.
      await safeSetDoc(
        doc(db, "servicecenters", centerId, "staff", staffId, "attendance", ym),
        { days, records },
      );
    } finally {
      setSaving(false);
    }
  }

  function handleCellClick(member: StaffMember, day: Date) {
    if (!canMark) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (day > today) return;      // can't mark future
    if (day.getDay() === 0) return; // Sunday isn't marked
    setEditing({ staff: member, day });
  }

  if (!canView) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <CalendarCheck className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to view Attendance.</p>
        </div>
      </div>
    );
  }

  const weekEnd = weekDays[6];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="min-h-screen bg-[#0B1120]">
      <PageHeader icon={<CalendarCheck className="w-5 h-5" />} title="Attendance" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* Week nav */}
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-4 flex items-center justify-between">
          <button
            onClick={() => setWeekStart((w) => { const d = new Date(w); d.setDate(d.getDate() - 7); return d; })}
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex flex-col items-center">
            <span className="text-sm font-medium text-white">
              {weekStart.toLocaleDateString("en-LK", { day: "2-digit", month: "short" })} – {weekEnd.toLocaleDateString("en-LK", { day: "2-digit", month: "short", year: "numeric" })}
            </span>
            <button
              onClick={() => setWeekStart(mondayOf(new Date()))}
              className="text-xs text-orange-400 hover:text-orange-300 mt-0.5"
            >
              This Week
            </button>
          </div>
          <button
            onClick={() => setWeekStart((w) => { const d = new Date(w); d.setDate(d.getDate() + 7); return d; })}
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Shift summary — the rules the grid is judging arrivals against */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-gray-500">
          <span>Shift {otSettings.shiftStart} – {otSettings.shiftEnd}</span>
          <span>{otSettings.graceMinutes} min grace before a day counts as late</span>
          <span>{otSettings.otEnabled ? "Overtime auto-calculated after shift end" : "Overtime calculation is off"}</span>
        </div>

        {/* Grid */}
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-4 overflow-x-auto">
          {loadingStaff ? (
            <LoadingBlock className="py-16" />
          ) : staff.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">No active employees.</p>
          ) : (
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs font-medium text-gray-500 pb-3 pr-4 sticky left-0 bg-[#162032]">Employee</th>
                  {weekDays.map((d) => (
                    <th key={d.toISOString()} className="text-center text-xs font-medium text-gray-500 pb-3 px-1">
                      <div>{d.toLocaleDateString("en-LK", { weekday: "short" })}</div>
                      <div className="text-gray-600">{d.getDate()}</div>
                    </th>
                  ))}
                  <th className="text-right text-xs font-medium text-gray-500 pb-3 pl-4">Week OT</th>
                  <th className="text-right text-xs font-medium text-gray-500 pb-3 pl-4">Late</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => {
                  const weekRecords = weekDays
                    .map((d) => recordFor(s.id, d))
                    .filter((r): r is AttendanceDayRecord => !!r);
                  const weekOt = weekRecords.reduce((sum, r) => sum + effectiveOtHours(r, otSettings), 0);
                  const weekLate = weekRecords.filter(
                    (r) => (r.lateMinutes ?? lateMinutesFor(r.inTime, r.status, otSettings)) > 0,
                  ).length;
                  return (
                    <tr key={s.id} className="border-b border-white/5">
                      <td className="py-2 pr-4 text-white font-medium whitespace-nowrap sticky left-0 bg-[#162032]">{s.fullName}</td>
                      {weekDays.map((d) => {
                        const isSunday = d.getDay() === 0;
                        const isFuture = d > today;
                        const status = statusFor(s.id, d);
                        const record = recordFor(s.id, d);
                        const late = record
                          ? record.lateMinutes ?? lateMinutesFor(record.inTime, record.status, otSettings)
                          : 0;
                        const ot = record ? effectiveOtHours(record, otSettings) : 0;
                        let cellClass = "w-12 h-9 mx-auto flex items-center justify-center rounded-lg text-xs font-medium transition select-none relative ";
                        if (isSunday) cellClass += "bg-white/3 text-gray-600 cursor-default";
                        else if (isFuture) cellClass += "text-gray-600 cursor-default";
                        else if (status) cellClass += `${ATTENDANCE_COLORS[status]} ${canMark ? "cursor-pointer" : "cursor-default"}`;
                        else cellClass += `bg-white/5 text-gray-400 ${canMark ? "hover:bg-white/10 cursor-pointer" : "cursor-default"}`;
                        if (late > 0) cellClass += " ring-1 ring-amber-400/70";
                        const title = record?.inTime || record?.outTime
                          ? `In ${record.inTime ?? "—"} · Out ${record.outTime ?? "—"}${late > 0 ? ` · ${formatMinutes(late)} late` : ""}${ot > 0 ? ` · ${ot}h OT` : ""}`
                          : undefined;
                        return (
                          <td key={d.toISOString()} className="py-1 px-1 text-center align-top">
                            <div
                              onClick={() => handleCellClick(s, d)}
                              className={cellClass}
                              title={title}
                            >
                              {status ? STATUS_ABBR[status] : ""}
                              {late > 0 && (
                                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400" />
                              )}
                            </div>
                            {(record?.inTime || record?.outTime) && (
                              <div className="mt-0.5 text-[10px] leading-tight text-gray-500 whitespace-nowrap">
                                {record?.inTime ?? "—"}–{record?.outTime ?? "—"}
                              </div>
                            )}
                            {ot > 0 && (
                              <div className="text-[10px] leading-tight text-orange-400">+{ot}h</div>
                            )}
                          </td>
                        );
                      })}
                      <td className="py-2 pl-4 text-right text-orange-300 whitespace-nowrap">
                        {weekOt > 0 ? `${Number(weekOt.toFixed(2))}h` : "—"}
                      </td>
                      <td className="py-2 pl-4 text-right text-amber-300 whitespace-nowrap">
                        {weekLate > 0 ? `${weekLate}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 items-center">
          {(["present", "absent", "half_day", "holiday"] as AttendanceStatus[]).map((s) => (
            <div key={s} className="flex items-center gap-1.5">
              <div className={`w-3 h-3 rounded ${ATTENDANCE_COLORS[s].split(" ")[0]}`} />
              <span className="text-xs text-gray-500 capitalize">{s.replace("_", " ")}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded ring-1 ring-amber-400/70 relative">
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" />
            </div>
            <span className="text-xs text-gray-500">Late arrival</span>
          </div>
          {canMark && <p className="text-xs text-gray-600 ml-auto">Click a day to set status and in/out times{saving && " · Saving…"}</p>}
        </div>
      </div>

      {editing && (
        <DayEditor
          staff={editing.staff}
          day={editing.day}
          record={recordFor(editing.staff.id, editing.day)}
          settings={otSettings}
          markedByName={currentUser?.displayName ?? currentUser?.email ?? "Staff"}
          markedBy={currentUser?.uid ?? ""}
          onClose={() => setEditing(null)}
          onSave={async (record) => {
            await saveDay(editing.staff.id, editing.day, record);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// ── Day editor ───────────────────────────────────────────────────────────────
// One employee, one day: the status plus the times they actually clocked in
// and out. Lateness and overtime are shown as they are typed, so whoever is
// marking the day sees what it will cost before saving it.
function DayEditor({
  staff, day, record, settings, markedBy, markedByName, onClose, onSave,
}: {
  staff: StaffMember;
  day: Date;
  record: AttendanceDayRecord | undefined;
  settings: OvertimeSettings;
  markedBy: string;
  markedByName: string;
  onClose: () => void;
  onSave: (record: AttendanceDayRecord | null) => Promise<void>;
}) {
  const [status, setStatus] = useState<AttendanceStatus>(record?.status ?? "present");
  const [inTime, setInTime] = useState(record?.inTime ?? "");
  const [outTime, setOutTime] = useState(record?.outTime ?? "");
  const [otManual, setOtManual] = useState(record?.otManual ?? false);
  const [manualOt, setManualOt] = useState(record?.otManual ? String(record?.otHours ?? 0) : "");
  const [note, setNote] = useState(record?.note ?? "");
  const [busy, setBusy] = useState(false);

  const late = lateMinutesFor(inTime, status, settings);
  const worked = workedMinutesFor(inTime, outTime);
  const calculatedOt = overtimeHoursFor({ status, inTime, outTime }, settings);
  const otHours = otManual ? Number(manualOt) || 0 : calculatedOt;
  const invalidRange = !!inTime && !!outTime && worked === null;

  async function handleSave() {
    setBusy(true);
    try {
      const next: AttendanceDayRecord = {
        status,
        ...(inTime ? { inTime } : {}),
        ...(outTime ? { outTime } : {}),
        lateMinutes: late,
        otHours,
        otManual,
        ...(note.trim() ? { note: note.trim() } : {}),
        markedBy,
        markedByName,
        markedAt: Timestamp.now(),
      };
      await onSave(next);
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    setBusy(true);
    try {
      await onSave(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-white">{staff.fullName}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {day.toLocaleDateString("en-LK", { weekday: "long", day: "2-digit", month: "short", year: "numeric" })}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-5">
          <div>
            <label className="text-xs text-gray-400">Status</label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition ${
                    status === s ? ATTENDANCE_COLORS[s] : "bg-white/5 text-gray-400 hover:bg-white/10 border border-transparent"
                  }`}
                >
                  {s.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400">In Time</label>
              <input
                type="time"
                value={inTime}
                onChange={(e) => setInTime(e.target.value)}
                className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">Out Time</label>
              <input
                type="time"
                value={outTime}
                onChange={(e) => setOutTime(e.target.value)}
                className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setInTime(settings.shiftStart)}
              className="text-[11px] text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg px-2.5 py-1 transition"
            >
              In at shift start ({settings.shiftStart})
            </button>
            <button
              onClick={() => setOutTime(settings.shiftEnd)}
              className="text-[11px] text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg px-2.5 py-1 transition"
            >
              Out at shift end ({settings.shiftEnd})
            </button>
            <button
              onClick={() => {
                const now = new Date();
                const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
                if (!inTime) setInTime(hhmm); else setOutTime(hhmm);
              }}
              className="text-[11px] text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg px-2.5 py-1 transition"
            >
              Now
            </button>
          </div>

          {/* Live read-out of what the times mean */}
          <div className="bg-[#0B1120] border border-white/5 rounded-xl px-4 py-3 space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Hours worked</span>
              <span className="text-gray-300">{formatMinutes(worked)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Late</span>
              {late > 0 ? (
                <span className="flex items-center gap-1.5 text-amber-300 font-medium">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {formatMinutes(late)} late
                </span>
              ) : (
                <span className="text-green-400">On time</span>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Overtime{otManual ? " (manual)" : " (auto)"}</span>
              <span className="text-orange-300">{otHours > 0 ? `${otHours}h` : "—"}</span>
            </div>
            {!settings.otEnabled && (
              <p className="text-[11px] text-gray-600 pt-1">
                Overtime calculation is switched off in Payroll Settings.
              </p>
            )}
          </div>

          <div>
            <label className="flex items-center gap-2 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={otManual}
                onChange={(e) => {
                  setOtManual(e.target.checked);
                  if (e.target.checked && !manualOt) setManualOt(String(calculatedOt));
                }}
                className="accent-orange-500"
              />
              Override overtime hours
            </label>
            {otManual && (
              <input
                type="number"
                step="0.25"
                min={0}
                value={manualOt}
                onChange={(e) => setManualOt(e.target.value)}
                className="mt-2 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              />
            )}
          </div>

          <div>
            <label className="text-xs text-gray-400">Note (optional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. came late — vehicle breakdown"
              className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
            />
          </div>

          {invalidRange && (
            <p className="text-xs text-red-400">Enter both times in HH:MM to record hours.</p>
          )}

          {record?.markedByName && (
            <p className="text-[11px] text-gray-600">Last saved by {record.markedByName}.</p>
          )}

          <div className="flex gap-3">
            {record && (
              <button
                onClick={handleClear}
                disabled={busy}
                className="bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 font-medium py-2.5 px-4 rounded-lg transition text-sm"
              >
                Clear
              </button>
            )}
            <button
              onClick={onClose}
              className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 rounded-lg transition text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={busy}
              className="flex-1 bg-[#F97316] hover:bg-orange-600 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
