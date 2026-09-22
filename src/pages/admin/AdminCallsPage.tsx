import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, orderBy, query, where } from "firebase/firestore";
import { PhoneCall, Building2, MapPin, StickyNote, ExternalLink, XCircle } from "lucide-react";
import { db } from "../../config/firebase";
import { watchQuery } from "../../lib/listeners";
import { clearNextCall } from "../../lib/leads";
import type { Lead } from "../../types/leads";

function when(ts?: { toDate: () => Date } | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Every call booked for later, across the whole pipeline — the schedule that
 * used to live only inside each lead's own log. Soonest first, with the
 * notes and service-center details right here so a call can be worked
 * without opening Management first; "Open in Management" jumps to the same
 * lead there for anything that needs the full call log.
 */
export default function AdminCallsPage() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return watchQuery(
      query(collection(db, "leads"), where("nextCallAt", "!=", null), orderBy("nextCallAt", "asc")),
      (snap) => {
        setLeads(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Lead)).filter((l) => !l.isDeleted));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  const todayISO = () => new Date().toISOString().slice(0, 10);
  const { overdue, upcoming } = useMemo(() => {
    const now = new Date().getTime();
    const overdue: Lead[] = [];
    const upcoming: Lead[] = [];
    for (const l of leads) {
      const at = l.nextCallAt?.toDate?.().getTime();
      if (at !== undefined && at < now) overdue.push(l);
      else upcoming.push(l);
    }
    return { overdue, upcoming };
  }, [leads]);

  const card = (lead: Lead, late: boolean) => (
    <div
      key={lead.id}
      className={`bg-gray-900 border rounded-xl p-4 ${late ? "border-red-500/30" : "border-gray-800"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-white truncate">{lead.businessName}</p>
          {lead.contactName && <p className="text-sm text-gray-400">{lead.contactName}</p>}
          <p className={`text-sm mt-1 flex items-center gap-1.5 ${late ? "text-red-300" : "text-sky-300"}`}>
            <PhoneCall className="w-3.5 h-3.5" /> {when(lead.nextCallAt)}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => clearNextCall(lead.id)}
            title="Clear this call"
            className="p-1.5 rounded-lg text-gray-500 hover:text-red-300 hover:bg-gray-800 transition-colors"
          >
            <XCircle className="w-4 h-4" />
          </button>
          <button
            onClick={() => navigate("/admin/leads", { state: { leadId: lead.id } })}
            title="Open in Management"
            className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
        </div>
      </div>

      {lead.nextCallNote && (
        <p className="text-sm text-gray-300 mt-2 whitespace-pre-wrap">{lead.nextCallNote}</p>
      )}

      <div className="grid sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-gray-800">
        <div className="space-y-1 text-xs text-gray-500">
          {(lead.phone || lead.location) && (
            <p className="flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
              {lead.phone}{lead.location ? ` · ${lead.location}` : ""}
            </p>
          )}
          {lead.district && (
            <p className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 flex-shrink-0" /> {lead.district}
            </p>
          )}
        </div>
        {lead.notes && (
          <p className="text-xs text-gray-500 flex items-start gap-1.5">
            <StickyNote className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span className="whitespace-pre-wrap">{lead.notes}</span>
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white flex items-center gap-2">
          <PhoneCall className="w-5 h-5 text-sky-400" /> Scheduled Calls
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Every next call booked from a lead's log, soonest first. Opens straight into Management for the full history.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-600">Loading…</p>
      ) : leads.length === 0 ? (
        <p className="text-sm text-gray-600 py-10 text-center border border-dashed border-gray-800 rounded-xl">
          Nothing booked. Book a next call from a lead's call log in Management.
        </p>
      ) : (
        <div className="space-y-6">
          {overdue.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-2">
                Overdue ({overdue.length})
              </h2>
              <div className="space-y-3">{overdue.map((l) => card(l, true))}</div>
            </div>
          )}
          {upcoming.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Upcoming ({upcoming.length})
              </h2>
              <div className="space-y-3">{upcoming.map((l) => card(l, false))}</div>
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-gray-700 mt-4">Today: {todayISO()}</p>
    </div>
  );
}
