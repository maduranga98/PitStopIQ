import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { httpsCallable, type FunctionsError } from "firebase/functions";
import { Clock, Maximize2, Minimize2, Wrench, MapPin, AlertTriangle } from "lucide-react";
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
  const [expanded, setExpanded] = useState<string | null>(null);
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

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }

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
                  const open = expanded === job.id;
                  const stale =
                    (job.status === "pending" || job.status === "in_progress") &&
                    job.createdAtMs > 0 &&
                    Math.floor((now - job.createdAtMs) / DAY_MS) > STALE_DAYS;
                  return (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => setExpanded(open ? null : job.id)}
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
                        <span className={open ? "" : "truncate"}>
                          {job.work.length ? (open ? job.work.join(", ") : job.work[0] + (job.work.length > 1 ? ` +${job.work.length - 1}` : "")) : "—"}
                        </span>
                      </div>
                      {open && job.bays.length > 0 && (
                        <div className="text-gray-400 text-xs mt-1 flex items-center gap-1.5">
                          <MapPin className="w-3 h-3" /> {job.bays.join(", ")}
                        </div>
                      )}
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
    </div>
  );
}
