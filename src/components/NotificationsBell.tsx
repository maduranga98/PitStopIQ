import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Bell, Clock, FileText } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useChequeRegister } from "../hooks/useChequeRegister";
import { reminderEntries, reminderReason, type RegisterEntry } from "../lib/chequeRegister";
import { formatLKR } from "../lib/inventoryPricing";

// Owner-only nudge for the paper that needs chasing: cheques about to fall
// due (or already overdue) and credit that's gone unpaid too long. Reads the
// same live register the Cheques & Credits page shows, so the badge count
// and the page always agree.

const MAX_LISTED = 8;

export default function NotificationsBell() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const isOwner = currentUser?.role === "Owner";

  const { entries } = useChequeRegister(isOwner ? currentUser?.centerId : undefined);
  const reminders = useMemo(() => reminderEntries(entries), [entries]);

  if (!isOwner) return null;

  function goTo(entry?: RegisterEntry) {
    setOpen(false);
    navigate(entry ? `/cheques?entry=${encodeURIComponent(entry.key)}` : "/cheques");
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="relative p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition"
        title="Cheque & credit reminders"
      >
        <Bell className="h-4 w-4" />
        {reminders.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center">
            {reminders.length > 9 ? "9+" : reminders.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 top-full mt-2 right-0 w-80 max-w-[90vw] bg-[#162032] border border-white/10 rounded-xl shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Reminders</p>
              <span className="text-xs text-gray-500">{reminders.length} open</span>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-white/5">
              {reminders.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">Nothing needs your attention.</p>
              ) : (
                reminders.slice(0, MAX_LISTED).map(entry => (
                  <button
                    key={entry.key}
                    onClick={() => goTo(entry)}
                    className="w-full text-left px-4 py-3 hover:bg-white/5 transition flex items-start gap-3"
                  >
                    <span className="mt-0.5 p-1.5 rounded-lg bg-amber-500/10 flex-shrink-0">
                      {entry.kind === "cheque"
                        ? <FileText className="h-3.5 w-3.5 text-amber-400" />
                        : <Clock className="h-3.5 w-3.5 text-amber-400" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm text-white truncate">{entry.partyName}</span>
                        <span className="text-sm font-medium text-gray-300 flex-shrink-0">{formatLKR(entry.amount)}</span>
                      </span>
                      <span className="flex items-center gap-1.5 mt-0.5 text-xs text-amber-400">
                        <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                        {reminderReason(entry)}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
            <button
              onClick={() => goTo()}
              className="w-full text-center text-xs font-medium text-[#F97316] hover:bg-white/5 py-2.5 border-t border-white/10 transition"
            >
              Open Cheques &amp; Credits
            </button>
          </div>
        </>
      )}
    </div>
  );
}
