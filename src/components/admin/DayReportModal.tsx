import { useEffect, useState } from "react";
import {
  FileText, Download, PhoneCall, StickyNote, Users, CalendarClock, Wallet, Sparkles,
} from "lucide-react";
import AdminModal, { inputClass } from "./AdminModal";
import { downloadCSV } from "../../lib/csvExport";
import {
  DAY_REPORT_HEADERS, dayReportRows, loadDayReport, type DayReport,
} from "../../lib/dayReport";
import {
  OUTCOME_LABEL, STAGE_META, TAG_META, demoLabel, type Lead,
} from "../../types/leads";

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const longDay = (date: string) => {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
};

function Tile({ icon: Icon, label, value, tone }: {
  icon: typeof Users; label: string; value: string | number; tone: string;
}) {
  return (
    <div className="bg-gray-950 border border-gray-800 rounded-xl px-3 py-2.5 flex items-center gap-2.5">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${tone}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-base font-semibold text-white leading-tight">{value}</p>
        <p className="text-[11px] text-gray-500 truncate">{label}</p>
      </div>
    </div>
  );
}

/**
 * The day-end report: what the team did on one date, in one screen, with the
 * same thing as a spreadsheet one click away.
 *
 * Deliberately a read rather than a stored document — the report is a view of
 * the call log, so running it for last Tuesday tomorrow gives the same answer,
 * and nothing has to be generated at the end of the day for it to exist.
 */
export default function DayReportModal({
  leads, onClose,
}: {
  /** The board, joined against the day's log for names and current status. */
  leads: Lead[];
  onClose: () => void;
}) {
  const [date, setDate] = useState(todayISO());
  const [loaded, setLoaded] = useState<DayReport | null>(null);
  /** The date a read failed on, so a retry on another day clears it by itself. */
  const [failedOn, setFailedOn] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadDayReport(date, leads)
      .then((r) => { if (live) setLoaded(r); })
      .catch(() => { if (live) setFailedOn(date); });
    return () => { live = false; };
    // `leads` is only the join table for names and current status — re-reading
    // the day every time the board ticks would be a query per keystroke
    // elsewhere in the app. The date is what the report is of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Derived rather than held: while what is loaded is not the date asked for,
  // the report is loading. That keeps the dialog off the cascading-render path
  // a setState-in-effect would put it on, and a stale day can never paint
  // under a new date.
  const failed = failedOn === date;
  const report = loaded?.date === date ? loaded : null;
  const loading = !failed && !report;

  function download() {
    if (!report) return;
    downloadCSV(`pitstopiq-day-report-${report.date}.csv`, DAY_REPORT_HEADERS, dayReportRows(report));
  }

  const empty = report !== null && report.activity.length === 0;

  return (
    <AdminModal
      title="Day report"
      icon={<FileText className="w-4 h-4 text-orange-400" />}
      onClose={onClose}
      size="xl"
      footer={
        <>
          <span className="mr-auto text-xs text-gray-600 truncate">{longDay(date)}</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
          >
            Close
          </button>
          <button
            type="button"
            onClick={download}
            disabled={!report || empty}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:hover:bg-orange-500 text-white transition-colors"
          >
            <Download className="w-4 h-4" /> Download CSV
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            max={todayISO()}
            onChange={(e) => setDate(e.target.value)}
            className={`${inputClass} w-44`}
          />
          {date !== todayISO() && (
            <button
              type="button"
              onClick={() => setDate(todayISO())}
              className="px-3 py-2 rounded-lg text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
            >
              Today
            </button>
          )}
        </div>

        {loading ? (
          <p className="text-center text-gray-600 py-16 text-sm">Building the report…</p>
        ) : failed ? (
          <p className="text-center text-red-400 py-16 text-sm">
            Couldn't load that day. Check the connection and try again.
          </p>
        ) : report ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
              <Tile icon={PhoneCall} label="Calls made" value={report.callCount} tone="bg-sky-500/15 text-sky-400" />
              <Tile icon={StickyNote} label="Notes logged" value={report.noteCount} tone="bg-gray-500/15 text-gray-400" />
              <Tile icon={Users} label="Customers touched" value={report.leadsTouched} tone="bg-orange-500/15 text-orange-400" />
              <Tile icon={Sparkles} label="Demos booked" value={report.demosBooked} tone="bg-violet-500/15 text-violet-400" />
              <Tile icon={CalendarClock} label="New leads" value={report.newLeads.length} tone="bg-cyan-500/15 text-cyan-400" />
              <Tile
                icon={Wallet}
                label={`Won (Rs ${report.wonAmount.toLocaleString("en-LK")})`}
                value={report.wonToday.length}
                tone="bg-green-500/15 text-green-400"
              />
            </div>

            {report.byOutcome.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {report.byOutcome.map((o) => (
                  <span
                    key={o.label}
                    className="text-xs px-2.5 py-1 rounded-full bg-gray-950 border border-gray-800 text-gray-400"
                  >
                    {o.label} <span className="text-white font-semibold">{o.count}</span>
                  </span>
                ))}
              </div>
            )}

            {report.demosToday.length > 0 && (
              <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl px-4 py-3">
                <p className="text-xs font-semibold text-violet-300 mb-2">Demos scheduled for this day</p>
                <ul className="space-y-1">
                  {report.demosToday.map((l) => (
                    <li key={l.id} className="text-sm text-gray-300 flex items-center gap-2">
                      <span className="text-xs text-violet-300/80 font-mono flex-shrink-0">
                        {demoLabel(l) || "—"}
                      </span>
                      <span className="truncate">{l.businessName}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* The day itself, in order */}
            {empty ? (
              <p className="text-center text-gray-600 text-sm py-12 border border-dashed border-gray-800 rounded-xl">
                Nothing was logged on this day.
              </p>
            ) : (
              <div className="border border-gray-800 rounded-xl overflow-x-auto">
                <table className="w-full text-sm min-w-[52rem]">
                  <thead className="bg-gray-950">
                    <tr className="text-left text-xs text-gray-500">
                      <th className="px-3 py-2.5 font-medium">Time</th>
                      <th className="px-3 py-2.5 font-medium">Customer</th>
                      <th className="px-3 py-2.5 font-medium">Type</th>
                      <th className="px-3 py-2.5 font-medium">Outcome</th>
                      <th className="px-3 py-2.5 font-medium">Note</th>
                      <th className="px-3 py-2.5 font-medium">Status now</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/70">
                    {report.activity.map((a) => (
                      <tr key={a.id} className="align-top">
                        <td className="px-3 py-2.5 text-gray-500 text-xs font-mono whitespace-nowrap">
                          {a.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="block text-gray-100 truncate max-w-[12rem]">
                            {a.lead?.businessName ?? "(archived lead)"}
                          </span>
                          {a.lead?.phone && (
                            <span className="block text-xs text-gray-600 font-mono">{a.lead.phone}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-400 whitespace-nowrap">
                          {a.callNumber > 0 ? `Call #${a.callNumber}` : "Note"}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-400 whitespace-nowrap">
                          {OUTCOME_LABEL[a.outcome] ?? a.outcome}
                          {(a.tags ?? []).length > 0 && (
                            <span className="flex flex-wrap gap-1 mt-1">
                              {a.tags.map((t) => (
                                <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded-full ${TAG_META[t].chip}`}>
                                  {TAG_META[t].label}
                                </span>
                              ))}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-300 max-w-[20rem] whitespace-pre-wrap">
                          {a.note || "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          {a.lead && (
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full text-white whitespace-nowrap ${STAGE_META[a.lead.stage].headerBg}`}>
                              {STAGE_META[a.lead.stage].label}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </div>
    </AdminModal>
  );
}
