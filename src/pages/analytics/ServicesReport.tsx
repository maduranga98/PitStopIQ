import { useEffect, useState, useMemo } from "react";
import { collection, query, where, getDocs, Timestamp } from "firebase/firestore";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell,
  ResponsiveContainer, Legend,
} from "recharts";
import { Download } from "lucide-react";
import { db } from "../../config/firebase";
import { downloadCSV } from "../../lib/csvExport";

const PIE_COLORS = ["#F97316", "#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#EF4444", "#06B6D4"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface JobDoc {
  id: string;
  createdAt: Timestamp;
  status: string;
  serviceType?: string;
  technicianName?: string;
  technicianId?: string;
  startTime?: Timestamp;
  endTime?: Timestamp;
  licensePlate?: string;
  customerId?: string;
  mileageIn?: number;
  mileageOut?: number;
}

interface Props {
  centerId: string;
  startDate: Date;
  endDate: Date;
}

function isoWeekLabel(d: Date): string {
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
  return `W${week} '${String(d.getFullYear()).slice(2)}`;
}

function durationHours(job: JobDoc): number | null {
  if (!job.startTime || !job.endTime) return null;
  const ms = job.endTime.toMillis() - job.startTime.toMillis();
  if (ms < 15 * 60 * 1000) return null; // exclude < 15 min
  return ms / 3600000;
}

export default function ServicesReport({ centerId, startDate, endDate }: Props) {
  const [jobs, setJobs] = useState<JobDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!centerId) return;
    setLoading(true);
    getDocs(
      query(
        collection(db, "servicecenters", centerId, "jobs"),
        where("createdAt", ">=", Timestamp.fromDate(startDate)),
        where("createdAt", "<=", Timestamp.fromDate(endDate)),
      ),
    ).then((snap) => {
      setJobs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as JobDoc)));
      setLoading(false);
    });
  }, [centerId, startDate, endDate]);

  // Services by type (pie)
  const typeData = useMemo(() => {
    const map = new Map<string, number>();
    jobs.forEach((j) => {
      const key = j.serviceType || "General";
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }));
  }, [jobs]);

  // Services per week (bar)
  const weekData = useMemo(() => {
    const map = new Map<string, number>();
    jobs.forEach((j) => {
      const key = isoWeekLabel(j.createdAt.toDate());
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return Array.from(map.entries()).map(([week, count]) => ({ week, count }));
  }, [jobs]);

  // Avg duration
  const avgDuration = useMemo(() => {
    const durations = jobs.map(durationHours).filter((d): d is number => d !== null);
    if (durations.length === 0) return null;
    return durations.reduce((s, d) => s + d, 0) / durations.length;
  }, [jobs]);

  // Peak day (horizontal bar)
  const dayData = useMemo(() => {
    const counts = new Array(7).fill(0);
    jobs.forEach((j) => {
      counts[j.createdAt.toDate().getDay()]++;
    });
    return DAYS.map((day, i) => ({ day, count: counts[i] }));
  }, [jobs]);

  // Peak hour heatmap: [dayOfWeek][hour] = count
  const heatmap = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
    jobs.forEach((j) => {
      const d = j.createdAt.toDate();
      grid[d.getDay()][d.getHours()]++;
    });
    return grid;
  }, [jobs]);

  const maxHeat = useMemo(() => Math.max(...heatmap.flat(), 1), [heatmap]);

  // Technician leaderboard
  const leaderboard = useMemo(() => {
    const map = new Map<string, { name: string; jobs: JobDoc[] }>();
    jobs.forEach((j) => {
      const key = j.technicianId || j.technicianName || "Unassigned";
      const name = j.technicianName || "Unassigned";
      if (!map.has(key)) map.set(key, { name, jobs: [] });
      map.get(key)!.jobs.push(j);
    });
    return Array.from(map.values())
      .map(({ name, jobs: tjobs }) => {
        const durations = tjobs.map(durationHours).filter((d): d is number => d !== null);
        const avgDur = durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : null;
        const dayCounts = new Array(7).fill(0);
        tjobs.forEach((j) => dayCounts[j.createdAt.toDate().getDay()]++);
        const busiestDayIdx = dayCounts.indexOf(Math.max(...dayCounts));
        return { name, count: tjobs.length, avgDur, busiestDay: DAYS[busiestDayIdx] };
      })
      .sort((a, b) => b.count - a.count);
  }, [jobs]);

  function handleExport() {
    const headers = ["Service ID", "Date", "Plate", "Service Type", "Technician", "Mileage In", "Mileage Out", "Duration (hrs)"];
    const rows = jobs.map((j) => [
      j.id,
      j.createdAt.toDate().toLocaleDateString("en-GB"),
      j.licensePlate ?? "",
      j.serviceType ?? "",
      j.technicianName ?? "",
      j.mileageIn?.toString() ?? "",
      j.mileageOut?.toString() ?? "",
      (durationHours(j) ?? "").toString(),
    ]);
    downloadCSV(`services-report-${startDate.toISOString().slice(0, 10)}.csv`, headers, rows);
  }

  if (loading) return <div className="text-center text-gray-400 py-16">Loading services data…</div>;

  return (
    <div className="space-y-6">
      {/* Key metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Total Services</div>
          <div className="text-3xl font-bold text-white">{jobs.length}</div>
          <div className="text-xs text-gray-600 mt-0.5">In period</div>
        </div>
        <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Avg Job Duration</div>
          <div className="text-3xl font-bold text-white">
            {avgDuration !== null ? `${avgDuration.toFixed(1)}h` : "—"}
          </div>
          <div className="text-xs text-gray-600 mt-0.5">Excluding &lt;15 min entries</div>
        </div>
        <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Service Types</div>
          <div className="text-3xl font-bold text-white">{typeData.length}</div>
          <div className="text-xs text-gray-600 mt-0.5">Unique types</div>
        </div>
      </div>

      {/* Two column: type pie + week bar */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
          <h3 className="text-sm font-semibold text-white mb-4">Services by Type</h3>
          {typeData.length === 0 ? (
            <div className="text-center text-gray-500 py-8 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={typeData} cx="50%" cy="50%" innerRadius={50} outerRadius={90} dataKey="value">
                  {typeData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "#0B1120", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                  formatter={(v: number, n: string) => [v, n]}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: "#9ca3af" }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
          <h3 className="text-sm font-semibold text-white mb-4">Services per Week</h3>
          {weekData.length === 0 ? (
            <div className="text-center text-gray-500 py-8 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={weekData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <XAxis dataKey="week" tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#0B1120", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} labelStyle={{ color: "#fff" }} />
                <Bar dataKey="count" fill="#3B82F6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Peak day */}
      <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
        <h3 className="text-sm font-semibold text-white mb-4">Peak Day Analysis</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={dayData} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
            <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="day" tick={{ fill: "#9ca3af", fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
            <Tooltip contentStyle={{ background: "#0B1120", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} labelStyle={{ color: "#fff" }} />
            <Bar dataKey="count" fill="#10B981" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Peak Hour Heatmap */}
      <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
        <h3 className="text-sm font-semibold text-white mb-4">Peak Hour Heat Map</h3>
        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            {/* Hour labels */}
            <div className="flex mb-1 ml-8">
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="flex-1 text-center text-[9px] text-gray-600">
                  {h % 3 === 0 ? `${h}h` : ""}
                </div>
              ))}
            </div>
            {DAYS.map((day, di) => (
              <div key={day} className="flex items-center mb-0.5">
                <div className="w-8 text-xs text-gray-500 shrink-0">{day}</div>
                {heatmap[di].map((count, h) => {
                  const opacity = count === 0 ? 0.05 : 0.1 + (count / maxHeat) * 0.9;
                  return (
                    <div
                      key={h}
                      title={`${day} ${h}:00 — ${count} job${count !== 1 ? "s" : ""}`}
                      className="flex-1 h-5 rounded-sm mx-px cursor-default"
                      style={{ backgroundColor: `rgba(249, 115, 22, ${opacity})` }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <div className="text-xs text-gray-600">Low</div>
          <div className="flex gap-0.5">
            {[0.05, 0.25, 0.5, 0.75, 1].map((o) => (
              <div key={o} className="w-4 h-3 rounded-sm" style={{ backgroundColor: `rgba(249, 115, 22, ${o})` }} />
            ))}
          </div>
          <div className="text-xs text-gray-600">High</div>
        </div>
      </div>

      {/* Technician Leaderboard */}
      <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Technician Leaderboard</h3>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 text-xs font-medium bg-[#F97316]/10 hover:bg-[#F97316]/20 text-[#F97316] border border-[#F97316]/20 px-3 py-1.5 rounded-lg transition"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
        {leaderboard.length === 0 ? (
          <div className="text-center text-gray-500 py-6 text-sm">No services data</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">#</th>
                  <th className="text-left text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Technician</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Jobs</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Avg Duration</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2">Busiest Day</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {leaderboard.map((t, i) => (
                  <tr key={t.name}>
                    <td className="py-3 pr-4 text-gray-600 text-xs">{i + 1}</td>
                    <td className="py-3 pr-4 text-white font-medium">{t.name}</td>
                    <td className="py-3 pr-4 text-right text-[#F97316] font-bold">{t.count}</td>
                    <td className="py-3 pr-4 text-right text-gray-400">
                      {t.avgDur !== null ? `${t.avgDur.toFixed(1)}h` : "—"}
                    </td>
                    <td className="py-3 text-right text-gray-400">{t.busiestDay}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
