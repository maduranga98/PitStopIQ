import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { httpsCallable, type FunctionsError } from "firebase/functions";
import { Clock, Maximize2, Minimize2, Wrench, MapPin, AlertTriangle, X, Gauge, Droplets, StickyNote, Package, User } from "lucide-react";
import { functions } from "../../config/firebase";
import { LoadingScreen } from "../../components/LoadingProgress";

// The service Kanban board on its own screen. Read-only, no staff login — the
// URL token is the credential (see getBoardScreen in functions/index.js). The
// page polls, because a public screen cannot hold a Firestore listener.

type Status = "pending" | "in_progress" | "done" | "delivered";

interface BoardJob {
  id: string;
  jobNumber: string;
  plateNumber: string;
  vehicle: string;
  status: Status;
  work: string[];
  technicians: string[];
  bays: string[];
  createdAtMs: number;
  lines: { name: string; technician: string; bay: string; bayStatus: "pending" | "in_progress" | "done" | null }[];
  parts: { name: string; quantity: number; partNumber: string }[];
  internalNotes: string;
  mileageIn: number;
  oil: string;
  oilNotes: string;
  inspectorName: string;
}

interface BoardData {
  center: { name: string; logoUrl: string | null };
  jobs: BoardJob[];
  serverNow: number;
}

const POLL_MS = 15_000;
const STALE_DAYS = 3;
const DAY_MS = 86_400_000;

const COLUMNS: { key: Status; label: string; headerBg: string; border: string }[] = [
  { key: "pending",     label: "Pending",     headerBg: "bg-[#475569]", border: "border-[#64748B]" },
  { key: "in_progress", label: "In Progress", headerBg: "bg-[#F59E0B]", border: "border-[#F59E0B]" },
  { key: "done",        label: "Done",        headerBg: "bg-[#16A34A]", border: "border-[#22C55E]" },
  { key: "delivered",   label: "Delivered",   headerBg: "bg-[#1D4ED8]", border: "border-[#3B82F6]" },
];

function timeAgo(ms: number, now: number): string {
  if (!ms) return "";
  const mins = Math.floor((now - ms) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

export default function BoardScreenPage() {
  const { centerId, token } = useParams<{ centerId: string; token: string }>();
  const linkComplete = Boolean(centerId && token);

  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(linkComplete);
  // A hard error (revoked / switched off) replaces the board; a soft one (offline blip) keeps it.
  const [fatal, setFatal] = useState(linkComplete ? "" : "This link is incomplete. Ask your service center for a new one.");
  const [offline, setOffline] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [fullscreen, setFullscreen] = useState(false);
  const stopped = useRef(false);

  const load = useCallback(async () => {
    if (!centerId || !token || stopped.current) return;
    try {
      const fn = httpsCallable<{ centerId: string; token: string }, BoardData>(functions, "getBoardScreen");
      const res = await fn({ centerId, token });
      setData(res.data);
      setNow(res.data.serverNow);
      setOffline(false);
    } catch (err) {
      const code = (err as FunctionsError)?.code ?? "";
      if (code === "functions/unavailable" || code === "functions/deadline-exceeded" || code === "functions/internal") {
        setOffline(true);
      } else {
        stopped.current = true;
        setFatal((err as FunctionsError)?.message || "This link is no longer valid.");
      }
    } finally {
      setLoading(false);
    }
  }, [centerId, token]);

  useEffect(() => {
    if (!linkComplete) return;
    stopped.current = false;
    const first = setTimeout(() => void load(), 0);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => { clearTimeout(first); clearInterval(id); clearInterval(tick); };
  }, [linkComplete, load]);

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }

  const selected = selectedId ? data?.jobs.find((j) => j.id === selectedId) ?? null : null;

  if (loading) return <LoadingScreen />;

  if (fatal || !data) {
    return (
      <div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <AlertTriangle className="w-10 h-10 text-orange-400 mx-auto mb-3" />
          <p className="text-white font-semibold">Board unavailable</p>
          <p className="text-gray-400 text-sm mt-1">{fatal || "Could not load the board."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1220] text-white">
      <header className="flex items-center justify-between gap-4 px-6 py-3 border-b border-white/10">
        <div className="flex items-center gap-3 min-w-0">
          {data.center.logoUrl && (
            <img src={data.center.logoUrl} alt="" className="h-8 w-8 rounded object-cover" />
          )}
          <div className="min-w-0">
            <h1 className="text-base font-bold truncate">{data.center.name}</h1>
            <p className="text-xs text-gray-500">Service board · refreshes automatically</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {offline && (
            <span className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-1 rounded-full">
              Reconnecting…
            </span>
          )}
          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300"
            aria-label={fullscreen ? "Exit full screen" : "Full screen"}
          >
            {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </header>

      <main className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
        {COLUMNS.map((col) => {
          const jobs = data.jobs.filter((j) => j.status === col.key);
          return (
            <section key={col.key} className="flex flex-col gap-3 min-w-0">
              <div className={`${col.headerBg} rounded-lg px-3 py-2 flex items-center justify-between`}>
                <span className="text-sm font-semibold">{col.label}</span>
                <span className="text-xs bg-black/20 px-2 py-0.5 rounded-full">{jobs.length}</span>
              </div>
              {jobs.length === 0 ? (
                <div className="text-center text-gray-600 text-sm py-8 border border-dashed border-white/10 rounded-lg">
                  No jobs
                </div>
              ) : (
                jobs.map((job) => {
                  const stale =
                    (job.status === "pending" || job.status === "in_progress") &&
                    job.createdAtMs > 0 &&
                    Math.floor((now - job.createdAtMs) / DAY_MS) > STALE_DAYS;
                  return (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => setSelectedId(job.id)}
                      className={`text-left bg-[#162032] border border-white/10 border-l-4 ${col.border} rounded-lg p-3 hover:bg-white/5 transition-colors`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-extrabold text-2xl tracking-wider text-white">{job.plateNumber || "—"}</span>
                        {stale && (
                          <span className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-300 border border-orange-500/30">
                            <AlertTriangle className="w-3 h-3" />
                            {Math.floor((now - job.createdAtMs) / DAY_MS)}d
                          </span>
                        )}
                      </div>
                      {job.vehicle && <div className="text-gray-300 text-sm">{job.vehicle}</div>}
                      <div className="text-gray-400 text-xs mt-1 flex items-start gap-1.5">
                        <Wrench className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        <span className="truncate">
                          {job.work.length ? job.work[0] + (job.work.length > 1 ? ` +${job.work.length - 1}` : "") : "—"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
                        <span className="truncate">{job.technicians.join(", ")}</span>
                        <span className="flex items-center gap-1 whitespace-nowrap">
                          <Clock className="w-3 h-3" />
                          {timeAgo(job.createdAtMs, now)}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </section>
          );
        })}
      </main>

      {selected && <JobCardModal job={selected} now={now} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

const BAY_STATUS_LABEL = { pending: "Waiting", in_progress: "In progress", done: "Done" } as const;
const BAY_STATUS_CHIP = {
  pending: "bg-slate-500/20 text-slate-300",
  in_progress: "bg-amber-500/20 text-amber-300",
  done: "bg-green-500/20 text-green-300",
} as const;

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
        <Icon className="w-3.5 h-3.5" /> {title}
      </h3>
      {children}
    </section>
  );
}

// The job card without the customer: no name, phone or prices ever reach this page.
function JobCardModal({ job, now, onClose }: { job: BoardJob; now: number; onClose: () => void }) {
  const col = COLUMNS.find((c) => c.key === job.status);
  // A job with no per-service lines (bay/commission modules off) still lists its work.
  const lines = job.lines.length > 0 ? job.lines : job.work.map((name) => ({ name, technician: "", bay: "", bayStatus: null }));
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#162032] border border-white/10 rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-mono font-extrabold text-4xl tracking-wider">{job.plateNumber || "—"}</div>
            <div className="text-gray-300 mt-1">{job.vehicle}</div>
            <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
              {job.jobNumber && <span className="font-mono">{job.jobNumber}</span>}
              {col && <span className={`${col.headerBg} text-white px-2 py-0.5 rounded-full`}>{col.label}</span>}
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{timeAgo(job.createdAtMs, now)}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <Section icon={Wrench} title="Work to do">
          {lines.length === 0 ? (
            <p className="text-gray-500 text-sm">No services listed.</p>
          ) : (
            <ul className="space-y-2">
              {lines.map((l, i) => (
                <li key={i} className="flex items-center justify-between gap-3 bg-white/5 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{l.name}</div>
                    {(l.technician || l.bay) && (
                      <div className="text-xs text-gray-400 flex items-center gap-3 mt-0.5">
                        {l.technician && <span className="flex items-center gap-1"><User className="w-3 h-3" />{l.technician}</span>}
                        {l.bay && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{l.bay}</span>}
                      </div>
                    )}
                  </div>
                  {l.bayStatus && (
                    <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${BAY_STATUS_CHIP[l.bayStatus]}`}>
                      {BAY_STATUS_LABEL[l.bayStatus]}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {job.technicians.length > 0 && (
          <Section icon={User} title="Crew">
            <p className="text-sm">{job.technicians.join(", ")}</p>
          </Section>
        )}

        {job.internalNotes && (
          <Section icon={StickyNote} title="Notes">
            <p className="text-sm whitespace-pre-wrap bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">{job.internalNotes}</p>
          </Section>
        )}

        {(job.mileageIn > 0 || job.oil || job.oilNotes) && (
          <Section icon={Gauge} title="Vehicle">
            <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              {job.mileageIn > 0 && (<><dt className="text-gray-500">Mileage in</dt><dd>{job.mileageIn.toLocaleString()} km</dd></>)}
              {job.oil && (<><dt className="text-gray-500 flex items-center gap-1"><Droplets className="w-3 h-3" />Oil</dt><dd>{job.oil}</dd></>)}
              {job.oilNotes && (<><dt className="text-gray-500">Oil notes</dt><dd>{job.oilNotes}</dd></>)}
            </dl>
          </Section>
        )}

        {job.parts.length > 0 && (
          <Section icon={Package} title="Parts">
            <ul className="text-sm space-y-1">
              {job.parts.map((p, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>{p.name}{p.partNumber && <span className="text-gray-500 font-mono text-xs"> · {p.partNumber}</span>}</span>
                  <span className="text-gray-400">× {p.quantity}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {job.inspectorName && (
          <p className="text-xs text-gray-500 mt-5">Inspection by {job.inspectorName}</p>
        )}
      </div>
    </div>
  );
}
