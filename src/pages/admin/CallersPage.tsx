import { useEffect, useMemo, useState, type FormEvent } from "react";
import { orderBy, query } from "firebase/firestore";
import { Check, Copy, Headset, Plus, UserCheck, UserX } from "lucide-react";
import { watchQuery } from "../../lib/listeners";
import {
  callerCounts, callersCollection, createCaller, setCallerActive,
  type CallerCounts, type CreatedCaller,
} from "../../lib/callers";
import { buildCallerHandoverMessage } from "../../lib/callerHandover";
import AdminModal, { Field, inputClass } from "../../components/admin/AdminModal";
import type { Caller } from "../../types/auth";

function when(ts?: { toDate: () => Date } | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="ml-2 text-gray-400 hover:text-white transition-colors flex items-center gap-1 text-xs"
      aria-label={label ? `Copy ${label}` : "Copy"}
    >
      {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

/** Shown once, inline — not a modal, so a stray click or Escape can't lose the password. */
function CredentialsCard({ created, caller, onClose }: {
  created: CreatedCaller; caller: { name: string }; onClose: () => void;
}) {
  const loginUrl = `${window.location.origin}/caller/login`;
  const message = buildCallerHandoverMessage({
    name: caller.name, email: created.email, tempPassword: created.tempPassword, loginUrl,
  });

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const rows: [string, string][] = [
    ["Email", created.email],
    ["Temporary password", created.tempPassword],
    ["Sign-in URL", loginUrl],
  ];

  return (
    <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-5 mb-6">
      <h2 className="text-base font-semibold text-green-400">{caller.name} can now sign in</h2>
      <p className="text-sm text-gray-300 mt-1">
        Pass these on directly. <span className="text-amber-400">The password is shown only once</span> — it
        can't be looked up again. They can set their own with “Forgot password?” on the sign-in page.
      </p>
      <div className="space-y-2 mt-4">
        {rows.map(([label, value]) => (
          <div key={label} className="bg-gray-900 rounded-lg px-4 py-2.5">
            <p className="text-xs text-gray-500 mb-0.5">{label}</p>
            <div className="flex items-center justify-between">
              <p className="text-sm font-mono text-white break-all">{value}</p>
              <CopyButton text={value} label={label} />
            </div>
          </div>
        ))}
        <div className="bg-gray-900 rounded-lg px-4 py-2.5">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-gray-500">WhatsApp message</p>
            <CopyButton text={message} label="message" />
          </div>
          <pre className="text-xs font-sans text-gray-300 whitespace-pre-wrap break-words">{message}</pre>
        </div>
      </div>
      <button
        onClick={onClose}
        className="mt-4 px-4 py-2 rounded-lg text-sm font-medium bg-gray-800 hover:bg-gray-700 text-white transition-colors"
      >
        I've shared it — close
      </button>
    </div>
  );
}

function AddCallerModal({ onCreated, onClose }: {
  onCreated: (created: CreatedCaller, name: string) => void; onClose: () => void;
}) {
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      onCreated(await createCaller(form), form.name.trim());
    } catch (err) {
      setError((err as { message?: string }).message || "Couldn't create the account. Try again.");
      setSaving(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <AdminModal
      title="Add caller"
      icon={<Headset className="w-4 h-4 text-orange-400" />}
      size="sm"
      onClose={saving ? () => undefined : onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={saving}
            className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" form="add-caller-form" disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white transition-colors">
            {saving ? "Creating…" : "Create account"}
          </button>
        </>
      }
    >
      <form id="add-caller-form" onSubmit={submit} className="space-y-4">
        {error && (
          <div role="alert" className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
        <Field label="Name">
          <input className={inputClass} value={form.name} onChange={set("name")} required autoFocus />
        </Field>
        <Field label="Email" hint="They sign in with this. Use a real address — it also receives password resets.">
          <input className={inputClass} type="email" value={form.email} onChange={set("email")} required />
        </Field>
        <Field label="Phone">
          <input className={inputClass} type="tel" value={form.phone} onChange={set("phone")} required placeholder="07XXXXXXXX" />
        </Field>
      </form>
    </AdminModal>
  );
}

function CallerRow({ caller, counts, onToggle }: {
  caller: Caller; counts?: CallerCounts | null; onToggle: () => void;
}) {
  return (
    <li className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-medium text-white truncate">{caller.name}</p>
        <p className="text-xs text-gray-500 truncate">{caller.email} · {caller.phone}</p>
        <p className="text-xs text-gray-600 mt-0.5">Added by {caller.createdByName || "—"} on {when(caller.createdAt)}</p>
      </div>
      <div className="text-xs text-gray-400 space-y-0.5 w-40">
        <p><span className="text-white font-medium">{counts ? counts.assigned : "—"}</span> leads assigned</p>
        <p><span className="text-white font-medium">{counts ? counts.payoutsPending : "—"}</span> payouts pending</p>
      </div>
      <button
        onClick={onToggle}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          caller.isActive
            ? "bg-gray-800 hover:bg-red-900/40 text-gray-300 hover:text-red-300"
            : "bg-gray-800 hover:bg-emerald-900/40 text-gray-300 hover:text-emerald-300"
        }`}
      >
        {caller.isActive ? <><UserX className="w-3.5 h-3.5" /> Deactivate</> : <><UserCheck className="w-3.5 h-3.5" /> Reactivate</>}
      </button>
    </li>
  );
}

export default function CallersPage() {
  const [callers, setCallers] = useState<Caller[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [counts, setCounts] = useState<Record<string, CallerCounts | null>>({});
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<{ result: CreatedCaller; name: string } | null>(null);
  const [toggling, setToggling] = useState<Caller | null>(null);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [toggleError, setToggleError] = useState("");

  useEffect(() => {
    return watchQuery(
      query(callersCollection(), orderBy("createdAt", "desc")),
      (snap) => {
        setCallers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Caller)));
        setLoading(false);
      },
      () => { setLoading(false); setLoadError(true); },
    );
  }, []);

  // Counts are server-side aggregations: a failure (offline) just shows "—".
  const ids = callers.map((c) => c.id).join(",");
  useEffect(() => {
    let live = true;
    for (const id of ids.split(",").filter(Boolean)) {
      callerCounts(id)
        .then((c) => live && setCounts((m) => ({ ...m, [id]: c })))
        .catch(() => live && setCounts((m) => ({ ...m, [id]: null })));
    }
    return () => { live = false; };
  }, [ids]);

  const active = useMemo(() => callers.filter((c) => c.isActive), [callers]);
  const inactive = useMemo(() => callers.filter((c) => !c.isActive), [callers]);

  async function confirmToggle() {
    if (!toggling || toggleBusy) return;
    setToggleBusy(true);
    setToggleError("");
    try {
      await setCallerActive(toggling.id, !toggling.isActive);
      setToggling(null);
    } catch {
      setToggleError("That didn't save. Check the connection and try again.");
    } finally {
      setToggleBusy(false);
    }
  }

  const tc = toggling ? counts[toggling.id] : null;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <Headset className="w-5 h-5 text-orange-400" /> Callers
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Lead handlers. Each works only the leads assigned to them and earns commission on confirmed payments.
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white transition-colors flex-shrink-0"
        >
          <Plus className="w-4 h-4" /> Add Caller
        </button>
      </div>

      {created && (
        <CredentialsCard created={created.result} caller={{ name: created.name }} onClose={() => setCreated(null)} />
      )}

      {loading ? (
        <p className="text-sm text-gray-600">Loading…</p>
      ) : loadError ? (
        <p className="text-sm text-red-400 py-10 text-center border border-dashed border-red-900/50 rounded-xl">
          Couldn't load callers. Check the connection and reload.
        </p>
      ) : callers.length === 0 ? (
        <p className="text-sm text-gray-600 py-10 text-center border border-dashed border-gray-800 rounded-xl">
          No callers yet. Add one to start assigning leads.
        </p>
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Active ({active.length})</h2>
            {active.length === 0
              ? <p className="text-sm text-gray-600">No active callers.</p>
              : <ul className="space-y-2">{active.map((c) => (
                  <CallerRow key={c.id} caller={c} counts={counts[c.id]} onToggle={() => { setToggleError(""); setToggling(c); }} />
                ))}</ul>}
          </section>
          {inactive.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Inactive ({inactive.length})</h2>
              <ul className="space-y-2 opacity-75">{inactive.map((c) => (
                <CallerRow key={c.id} caller={c} counts={counts[c.id]} onToggle={() => { setToggleError(""); setToggling(c); }} />
              ))}</ul>
            </section>
          )}
        </div>
      )}

      {adding && (
        <AddCallerModal
          onClose={() => setAdding(false)}
          onCreated={(result, name) => { setAdding(false); setCreated({ result, name }); }}
        />
      )}

      {toggling && (
        <AdminModal
          title={toggling.isActive ? `Deactivate ${toggling.name}?` : `Reactivate ${toggling.name}?`}
          size="sm"
          onClose={() => setToggling(null)}
          footer={
            <>
              <button onClick={() => setToggling(null)} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white">
                Cancel
              </button>
              <button
                onClick={() => void confirmToggle()}
                disabled={toggleBusy}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white transition-colors"
              >
                {toggleBusy ? "Saving…" : toggling.isActive ? "Deactivate" : "Reactivate"}
              </button>
            </>
          }
        >
          {toggling.isActive ? (
            <div className="space-y-2 text-sm text-gray-300">
              <p>They'll be signed out within seconds and lose access to their leads.</p>
              {tc && (tc.assigned > 0 || tc.payoutsPending > 0) && (
                <p className="text-amber-400">
                  {tc.assigned} lead{tc.assigned === 1 ? "" : "s"} stay assigned to them and {tc.payoutsPending} payout
                  {tc.payoutsPending === 1 ? " remains" : "s remain"} payable. Reassign leads from the Management board.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-300">They'll be able to sign in again and see their assigned leads.</p>
          )}
          {toggleError && <p role="alert" className="text-sm text-red-400 mt-3">{toggleError}</p>}
        </AdminModal>
      )}
    </div>
  );
}
