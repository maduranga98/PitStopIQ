import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Send, Search, Info } from "lucide-react";
import { getAdminCenters } from "../../lib/adminData";
import { analyzeSms } from "../../lib/smsTemplates";
import {
  ADMIN_SMS_MASKS, ownerRecipients, personalise, sendCustomSms,
  type AdminSmsMask, type OwnerRecipient,
} from "../../lib/adminSms";
import type { ServiceCenter } from "../../types/auth";

type StatusFilter = "all" | ServiceCenter["status"];

const STATUS_CHIPS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "grace_period", label: "Grace" },
  { key: "pending_payment", label: "Pending" },
  { key: "blocked", label: "Blocked" },
];

const BATCH = 5;

/** Super-admin broadcast: a custom SMS to service-center owners, sent through the smsLogs pipeline. */
export default function AdminSendSmsPage() {
  const [centers, setCenters] = useState<ServiceCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [mask, setMask] = useState<AdminSmsMask>("Lumora Tech");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    getAdminCenters()
      .then(setCenters)
      .catch(() => setError("Could not load service centers."))
      .finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = centers.filter((c) => {
      if (status !== "all" && c.status !== status) return false;
      if (!q) return true;
      return [c.name, c.ownerName, c.ownerPhone, c.district].some((v) => (v ?? "").toLowerCase().includes(q));
    });
    return ownerRecipients(list);
  }, [centers, status, search]);

  const allOwners = useMemo(() => ownerRecipients(centers), [centers]);
  const chosen = useMemo(() => allOwners.filter((r) => selected.has(r.key)), [allOwners, selected]);
  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.key));

  const toggle = (k: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  const toggleVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      visible.forEach((r) => (allVisibleSelected ? next.delete(r.key) : next.add(r.key)));
      return next;
    });

  const sample = chosen[0] ?? allOwners[0];
  const preview = sample ? personalise(message, sample) : message;
  const info = analyzeSms(preview);
  const totalSegments = info.segments * chosen.length;
  const canSend = !busy && message.trim().length > 0 && chosen.length > 0;

  async function send() {
    if (!canSend) return;
    if (!window.confirm(`Send this SMS to ${chosen.length} owner${chosen.length === 1 ? "" : "s"} (${totalSegments} SMS credit${totalSegments === 1 ? "" : "s"})?`)) return;
    setBusy(true);
    setNotice("");
    let ok = 0;
    const failed = new Set<string>();
    // Small batches keep the eSMS dispatch trigger (maxInstances 3) from being flooded.
    for (let i = 0; i < chosen.length; i += BATCH) {
      const batch: OwnerRecipient[] = chosen.slice(i, i + BATCH);
      const res = await Promise.allSettled(batch.map((r) => sendCustomSms(r, message, mask)));
      res.forEach((x, j) => {
        if (x.status === "fulfilled") ok++; else failed.add(batch[j].key);
      });
    }
    setSelected(failed);
    if (failed.size === 0) setMessage("");
    setNotice(
      failed.size === 0
        ? `Queued ${ok} message${ok === 1 ? "" : "s"}. Track delivery in the SMS Log.`
        : `Queued ${ok}, could not queue ${failed.size}. Those stay selected - try again.`,
    );
    setBusy(false);
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-white flex items-center gap-2">
          <Send className="w-5 h-5 text-sky-400" /> Send SMS
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Send a custom message to service center owners. Owners with several branches get one SMS.
        </p>
      </div>

      {notice && (
        <p className="text-sm text-sky-300 bg-sky-500/10 border border-sky-500/20 rounded-lg px-3 py-2 mb-3">
          {notice} <Link to="/admin/sms-log" className="underline">Open SMS Log</Link>
        </p>
      )}
      {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2 mb-3">{error}</p>}

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Recipients */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col min-h-[28rem]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-white">Recipients</h2>
            <span className="text-xs text-gray-500">{chosen.length} of {allOwners.length} selected</span>
          </div>

          <div className="flex flex-wrap gap-1.5 mb-3">
            {STATUS_CHIPS.map((c) => (
              <button
                key={c.key}
                onClick={() => setStatus(c.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  status === c.key ? "bg-orange-500 text-white" : "bg-gray-950 border border-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="relative mb-3">
            <Search className="w-4 h-4 text-gray-600 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search center, owner, phone"
              className="w-full bg-gray-950 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer mb-2">
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} className="accent-orange-500 w-4 h-4" />
            Select all shown ({visible.length})
          </label>

          <div className="flex-1 overflow-y-auto max-h-[26rem] border-t border-gray-800">
            {loading ? (
              <p className="text-sm text-gray-600 py-6 text-center">Loading…</p>
            ) : visible.length === 0 ? (
              <p className="text-sm text-gray-600 py-6 text-center">No owners match.</p>
            ) : (
              <ul className="divide-y divide-gray-800">
                {visible.map((r) => (
                  <li key={r.key}>
                    <label className="flex items-center gap-3 py-2.5 cursor-pointer">
                      <input type="checkbox" checked={selected.has(r.key)} onChange={() => toggle(r.key)} className="accent-orange-500 w-4 h-4 flex-shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-white truncate">{r.centerName}</span>
                        <span className="block text-xs text-gray-500 truncate">{r.ownerName || "—"} · {r.phone}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Composer */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col">
          <h2 className="text-sm font-medium text-white mb-3">Message</h2>

          <label className="text-xs text-gray-500 mb-1" htmlFor="sms-mask">Sender name</label>
          <select
            id="sms-mask"
            value={mask}
            onChange={(e) => setMask(e.target.value as AdminSmsMask)}
            className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500 mb-3"
          >
            {ADMIN_SMS_MASKS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>

          <label className="text-xs text-gray-500 mb-1" htmlFor="sms-body">Text</label>
          <textarea
            id="sms-body"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={8}
            placeholder="Dear {OwnerName}, ..."
            className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 resize-y"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 mt-2 text-xs text-gray-500">
            <span>Use <code className="text-gray-300">{"{OwnerName}"}</code> and <code className="text-gray-300">{"{CenterName}"}</code> to personalise.</span>
            <span>
              {info.chars} chars · {info.segments} SMS{info.encoding === "unicode" ? " (Unicode)" : ""}
              {chosen.length > 0 && ` · ${totalSegments} credits total`}
            </span>
          </div>

          {message.trim() && sample && (
            <div className="mt-4">
              <p className="text-xs text-gray-500 mb-1">Preview ({sample.centerName})</p>
              <p className="text-sm text-gray-300 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 whitespace-pre-wrap">{preview}</p>
            </div>
          )}

          <p className="flex items-start gap-1.5 text-xs text-gray-500 mt-4">
            <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            Messages sent between 8 PM and 8 AM (Sri Lanka time) wait in the SMS Log and need a Resend after 8 AM.
          </p>

          <button
            onClick={send}
            disabled={!canSend}
            className="mt-4 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
          >
            <Send className="w-4 h-4" />
            {busy ? "Sending…" : `Send to ${chosen.length} owner${chosen.length === 1 ? "" : "s"}`}
          </button>
        </section>
      </div>
    </div>
  );
}
