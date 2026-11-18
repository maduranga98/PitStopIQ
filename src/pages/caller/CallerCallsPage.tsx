import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, ExternalLink, MapPin, Phone, PhoneCall, StickyNote, XCircle } from "lucide-react";
import { useCallerLeads } from "../../contexts/callerLeadsContext";
import { clearNextCall } from "../../lib/leads";
import StarRating from "../../components/admin/StarRating";
import { TAG_META, ratingOf, type Lead } from "../../types/leads";

function when(ts?: { toDate: () => Date } | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * "Calls": the signed-in caller's own schedule — every next call they booked
 * on a lead assigned to them, soonest first. The feed is the caller's leads
 * only (the rules never let a caller read anyone else's), so nothing here
 * needs filtering by owner, and no query of its own: it derives from the same
 * subscription the board uses.
 */
export default function CallerCallsPage() {
  const navigate = useNavigate();
  const { leads: all, loading, error } = useCallerLeads();
  const [failed, setFailed] = useState("");

  const scheduled = useMemo(
    () => all
      .filter((l) => l.nextCallAt && !l.isDeleted)
      .sort((a, b) => (a.nextCallAt!.seconds ?? 0) - (b.nextCallAt!.seconds ?? 0)),
    [all],
  );

  const { overdue, upcoming } = useMemo(() => {
    const now = new Date().getTime();
    const overdue: Lead[] = [];
    const upcoming: Lead[] = [];
    for (const l of scheduled) {
      const at = l.nextCallAt?.toDate?.().getTime();
      if (at !== undefined && at < now) overdue.push(l);
      else upcoming.push(l);
    }
    return { overdue, upcoming };
  }, [scheduled]);

  async function clear(lead: Lead) {
    setFailed("");
    try {
      await clearNextCall(lead.id);
    } catch {
      setFailed("Couldn't clear that call. Check the connection and try again.");
    }
  }

  const card = (lead: Lead, late: boolean) => (
    <div key={lead.id} className={`bg-gray-900 border rounded-xl p-4 ${late ? "border-red-500/30" : "border-gray-800"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-white flex items-center gap-2 min-w-0">
            <span className="truncate">{lead.businessName}</span>
            <StarRating compact value={ratingOf(lead)} />
          </p>
          {lead.contactName && <p className="text-sm text-gray-400">{lead.contactName}</p>}
          {(lead.tags ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {(lead.tags ?? []).map((t) => TAG_META[t] && (
                <span key={t} className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${TAG_META[t].chip}`}>
                  {TAG_META[t].label}
                </span>
              ))}
            </div>
          )}
          <p className={`text-sm mt-1.5 flex items-center gap-1.5 ${late ? "text-red-300" : "text-sky-300"}`}>
            <PhoneCall className="w-3.5 h-3.5" /> {when(lead.nextCallAt)}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {lead.phone && (
            <a
              href={`tel:${lead.phone}`}
              aria-label={`Call ${lead.businessName}`}
              title="Call now"
              className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white flex items-center justify-center transition-colors"
            >
              <Phone className="w-3.5 h-3.5" />
            </a>
          )}
          <button
            onClick={() => navigate("/caller", { state: { leadId: lead.id } })}
            title="Open lead"
            aria-label="Open lead"
            className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
          <button
            onClick={() => void clear(lead)}
            title="Clear this call"
            aria-label="Clear this call"
            className="p-1.5 rounded-lg text-gray-500 hover:text-red-300 hover:bg-gray-800 transition-colors"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      </div>

      {lead.nextCallNote && <p className="text-sm text-gray-300 mt-2 whitespace-pre-wrap">{lead.nextCallNote}</p>}

      {(lead.phone || lead.location || lead.district || lead.notes) && (
        <div className="grid sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-gray-800 text-xs text-gray-500">
          <div className="space-y-1">
            {(lead.phone || lead.location) && (
              <p className="flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                {lead.phone}{lead.location ? ` · ${lead.location}` : ""}
              </p>
            )}
            {lead.district && (
              <p className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 flex-shrink-0" /> {lead.district}</p>
            )}
          </div>
          {lead.notes && (
            <p className="flex items-start gap-1.5">
              <StickyNote className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span className="whitespace-pre-wrap">{lead.notes}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white flex items-center gap-2">
          <PhoneCall className="w-5 h-5 text-sky-400" /> My scheduled calls
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          The calls you booked from a lead's log, soonest first.
        </p>
      </div>

      {failed && <p role="alert" className="mb-4 text-sm text-amber-300">{failed}</p>}

      {loading ? (
        <div className="py-20 flex justify-center"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-orange-500" /></div>
      ) : error ? (
        <p className="text-center text-red-400 py-20 text-sm">Couldn't load your calls. Check the connection and reload.</p>
      ) : scheduled.length === 0 ? (
        <p className="text-sm text-gray-600 py-12 text-center border border-dashed border-gray-800 rounded-xl">
          Nothing booked. Set a next call date when you log a call on one of your leads.
        </p>
      ) : (
        <div className="space-y-6">
          {overdue.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-2">Overdue ({overdue.length})</h2>
              <div className="space-y-3">{overdue.map((l) => card(l, true))}</div>
            </section>
          )}
          {upcoming.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Upcoming ({upcoming.length})</h2>
              <div className="space-y-3">{upcoming.map((l) => card(l, false))}</div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
