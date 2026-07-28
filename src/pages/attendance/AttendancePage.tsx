import { useEffect, useState, useCallback, useMemo } from "react";
import {
  doc, getDoc, collection, onSnapshot, orderBy, query,
} from "firebase/firestore";
import { safeSetDoc } from "../../lib/firestoreWrite";
import { ChevronLeft, ChevronRight, CalendarCheck } from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { StaffMember, AttendanceStatus } from "../../types/auth";
import { LoadingBlock } from "../../components/LoadingProgress";
import PageHeader from "../../components/layout/PageHeader";

// ── Constants / Helpers ──────────────────────────────────────────────────────
const ATTENDANCE_COLORS: Record<AttendanceStatus, string> = {
  present:  "bg-green-500/30 text-green-300 border border-green-500/40",
  absent:   "bg-red-500/30 text-red-300 border border-red-500/40",
  half_day: "bg-amber-500/30 text-amber-300 border border-amber-500/40",
  holiday:  "bg-blue-500/30 text-blue-300 border border-blue-500/40",
};

const ATTENDANCE_CYCLE: (AttendanceStatus | "unmarked")[] = ["present", "absent", "half_day", "holiday", "unmarked"];

const STATUS_ABBR: Record<AttendanceStatus, string> = {
  present: "P", absent: "A", half_day: "½", holiday: "H",
};

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

export default function AttendancePage() {
  const { currentUser } = useAuth();
  const centerId = currentUser?.centerId ?? "";
  const viewerRole = currentUser?.role;
  const canMark = viewerRole === "Owner" || viewerRole === "Manager";
  const canView = viewerRole === "Owner" || viewerRole === "Manager";

  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(true);
  // Cache of month attendance docs, keyed "staffId:YYYY-MM" -> days map.
  const [monthDocs, setMonthDocs] = useState<Record<string, Record<string, AttendanceStatus>>>({});
  const [saving, setSaving] = useState(false);

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

  // Load (and cache) the month attendance docs the visible week touches, for every staff member.
  const loadMonthDocs = useCallback(async () => {
    if (!centerId || staff.length === 0) return;
    const entries = await Promise.all(
      staff.flatMap((s) =>
        monthKeys.map(async (ym) => {
          const snap = await getDoc(doc(db, "servicecenters", centerId, "staff", s.id, "attendance", ym));
          const days = snap.exists() ? (snap.data() as { days?: Record<string, AttendanceStatus> }).days ?? {} : {};
          return [`${s.id}:${ym}`, days] as const;
        }),
      ),
    );
    setMonthDocs((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
  }, [centerId, staff, monthKeys]);

  useEffect(() => {
    loadMonthDocs();
  }, [loadMonthDocs]);

  function statusFor(staffId: string, day: Date): AttendanceStatus | undefined {
    const ym = yearMonthKey(day);
    const days = monthDocs[`${staffId}:${ym}`];
    return days?.[dateKey(day)];
  }

  async function handleCellClick(staffId: string, day: Date) {
    if (!canMark || !centerId) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (day > today) return; // can't mark future
    if (day.getDay() === 0) return; // Sunday isn't marked

    const ym = yearMonthKey(day);
    const cacheKey = `${staffId}:${ym}`;
    const currentDays = monthDocs[cacheKey] ?? {};
    const key = dateKey(day);
    const current = currentDays[key];
    const idx = current ? ATTENDANCE_CYCLE.indexOf(current) : ATTENDANCE_CYCLE.length - 1;
    const next = ATTENDANCE_CYCLE[(idx + 1) % ATTENDANCE_CYCLE.length];

    const newDays = { ...currentDays };
    if (next === "unmarked") {
      delete newDays[key];
    } else {
      newDays[key] = next as AttendanceStatus;
    }

    setMonthDocs((prev) => ({ ...prev, [cacheKey]: newDays }));
    setSaving(true);
    try {
      await safeSetDoc(
        doc(db, "servicecenters", centerId, "staff", staffId, "attendance", ym),
        { days: newDays },
        { merge: true },
      );
    } finally {
      setSaving(false);
    }
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
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

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

        {/* Grid */}
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-4 overflow-x-auto">
          {loadingStaff ? (
            <LoadingBlock className="py-16" />
          ) : staff.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">No active employees.</p>
          ) : (
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs font-medium text-gray-500 pb-3 pr-4 sticky left-0 bg-[#162032]">Employee</th>
                  {weekDays.map((d) => (
                    <th key={d.toISOString()} className="text-center text-xs font-medium text-gray-500 pb-3 px-1">
                      <div>{d.toLocaleDateString("en-LK", { weekday: "short" })}</div>
                      <div className="text-gray-600">{d.getDate()}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.id} className="border-b border-white/5">
                    <td className="py-2 pr-4 text-white font-medium whitespace-nowrap sticky left-0 bg-[#162032]">{s.fullName}</td>
                    {weekDays.map((d) => {
                      const isSunday = d.getDay() === 0;
                      const isFuture = d > today;
                      const status = statusFor(s.id, d);
                      let cellClass = "w-10 h-9 mx-auto flex items-center justify-center rounded-lg text-xs font-medium transition select-none ";
                      if (isSunday) cellClass += "bg-white/3 text-gray-600 cursor-default";
                      else if (isFuture) cellClass += "text-gray-600 cursor-default";
                      else if (status) cellClass += `${ATTENDANCE_COLORS[status]} ${canMark ? "cursor-pointer" : "cursor-default"}`;
                      else cellClass += `bg-white/5 text-gray-400 ${canMark ? "hover:bg-white/10 cursor-pointer" : "cursor-default"}`;
                      return (
                        <td key={d.toISOString()} className="py-1 px-1 text-center">
                          <div onClick={() => handleCellClick(s.id, d)} className={cellClass}>
                            {status ? STATUS_ABBR[status] : ""}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
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
          {canMark && <p className="text-xs text-gray-600 ml-auto">Click a day to change status{saving && " · Saving…"}</p>}
        </div>
      </div>
    </div>
  );
}
