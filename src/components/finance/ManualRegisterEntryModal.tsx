import { useState } from "react";
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, Calendar, Clock, FileText, Loader2, X,
} from "lucide-react";
import {
  createManualEntry, updateManualEntry, validateManualEntry, type ManualEntryInput,
} from "../../lib/manualRegisterEntries";
import type { ManualRegisterEntry } from "../../types/auth";

// Adding a cheque or a credit by hand.
//
// Most paper reaches the register through the document it was recorded on. The
// rest — the landlord's post-dated rent cheque, money lent to a mechanic, a
// bill the owner agreed to settle next month — has no document, and used to be
// invisible to the calendar. This is the form for those.

/** "2026-08-14" for a Date, in local time — what <input type="date"> wants. */
function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Midday local, so a date never slips a day across a timezone boundary. */
function fromDateInputValue(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
}

const inputClass =
  "w-full bg-[#0B1120] border border-white/10 text-white placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316] transition";

type Kind = ManualRegisterEntry["kind"];
type Direction = ManualRegisterEntry["direction"];

export default function ManualRegisterEntryModal({
  centerId, actor, entry, defaultDate, onClose, onSaved,
}: {
  centerId: string;
  actor: { uid: string; name: string };
  /** Editing an existing hand-typed entry; omitted when adding a new one. */
  entry?: ManualRegisterEntry;
  /** Pre-fill the cheque date — the calendar passes the day that was clicked. */
  defaultDate?: Date;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const editing = !!entry;
  const [kind, setKind] = useState<Kind>(entry?.kind ?? "cheque");
  const [direction, setDirection] = useState<Direction>(entry?.direction ?? "incoming");
  const [amount, setAmount] = useState(entry ? String(entry.amount) : "");
  const [partyName, setPartyName] = useState(entry?.partyName ?? "");
  const [partySubtitle, setPartySubtitle] = useState(entry?.partySubtitle ?? "");
  const [partyPhone, setPartyPhone] = useState(entry?.partyPhone ?? "");
  const [reference, setReference] = useState(entry?.reference ?? "");
  const [date, setDate] = useState(() =>
    toDateInputValue(entry?.date?.toDate() ?? new Date()));
  const [chequeDate, setChequeDate] = useState(() =>
    toDateInputValue(entry?.chequeDate?.toDate() ?? defaultDate ?? new Date()));
  const [chequeNumber, setChequeNumber] = useState(entry?.chequeNumber ?? "");
  const [bank, setBank] = useState(entry?.bank ?? "");
  const [branch, setBranch] = useState(entry?.branch ?? "");
  const [note, setNote] = useState(entry?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const incoming = direction === "incoming";

  async function handleSave() {
    setError("");
    const when = fromDateInputValue(date);
    const chequeWhen = fromDateInputValue(chequeDate);
    const input: ManualEntryInput = {
      kind,
      direction,
      amount: Number(amount),
      partyName,
      partySubtitle,
      partyPhone,
      reference,
      date: when ?? new Date(NaN),
      chequeDate: kind === "cheque" ? chequeWhen ?? undefined : undefined,
      chequeNumber,
      bank,
      branch,
      note,
    };
    const problem = validateManualEntry(input);
    if (problem) { setError(problem); return; }

    setSaving(true);
    try {
      if (entry) await updateManualEntry(centerId, entry.id, input);
      else await createManualEntry(centerId, input, actor);
      onSaved?.();
      onClose();
    } catch {
      setError("Couldn't save this entry. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-white">
              {editing ? "Edit entry" : "Add cheque or credit"}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              For paper with no invoice, order or delivery behind it.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-3 py-2 text-xs">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />{error}
          </div>
        )}

        <Choice
          label="What is it?"
          value={kind}
          onChange={setKind}
          options={[
            ["cheque", "Cheque", <FileText key="c" className="h-3.5 w-3.5" />],
            ["credit", "Credit", <Clock key="k" className="h-3.5 w-3.5" />],
          ]}
        />

        <Choice
          label="Which way is the money going?"
          value={direction}
          onChange={setDirection}
          options={[
            ["incoming", "We receive", <ArrowDownLeft key="i" className="h-3.5 w-3.5" />],
            ["outgoing", "We pay", <ArrowUpRight key="o" className="h-3.5 w-3.5" />],
          ]}
        />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (LKR)">
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              className={inputClass}
            />
          </Field>
          <Field label={kind === "cheque" ? "Received / written on" : "Agreed on"}>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className={`${inputClass} pl-9`}
              />
            </div>
          </Field>
        </div>

        <Field label={incoming ? "Who is paying us?" : "Who are we paying?"}>
          <input
            type="text"
            value={partyName}
            onChange={e => setPartyName(e.target.value)}
            placeholder="e.g. Sunil Perera / Lanka Insurance"
            className={inputClass}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="What for (optional)">
            <input
              type="text"
              value={partySubtitle}
              onChange={e => setPartySubtitle(e.target.value)}
              placeholder="e.g. Shop rent"
              className={inputClass}
            />
          </Field>
          <Field label="Phone (optional)">
            <input
              type="tel"
              value={partyPhone}
              onChange={e => setPartyPhone(e.target.value)}
              placeholder="07XXXXXXXX"
              className={inputClass}
            />
          </Field>
        </div>
        {incoming && (
          <p className="-mt-2 text-[11px] text-gray-600">
            With a phone number on file, a thank-you SMS goes out when this is marked received.
          </p>
        )}

        {kind === "cheque" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cheque number">
                <input
                  type="text"
                  value={chequeNumber}
                  onChange={e => setChequeNumber(e.target.value)}
                  placeholder="e.g. 004512"
                  className={inputClass}
                />
              </Field>
              <Field label="Date on the cheque">
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                  <input
                    type="date"
                    value={chequeDate}
                    onChange={e => setChequeDate(e.target.value)}
                    className={`${inputClass} pl-9`}
                  />
                </div>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bank">
                <input
                  type="text"
                  value={bank}
                  onChange={e => setBank(e.target.value)}
                  placeholder="e.g. Commercial Bank"
                  className={inputClass}
                />
              </Field>
              <Field label="Branch (optional)">
                <input
                  type="text"
                  value={branch}
                  onChange={e => setBranch(e.target.value)}
                  placeholder="e.g. Kurunegala"
                  className={inputClass}
                />
              </Field>
            </div>
            <p className="-mt-2 text-[11px] text-gray-600">
              The date on the cheque is the day it lands on the calendar
              {incoming ? " — the day to take it to the bank." : " — the day the account must cover it."}
            </p>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Reference (optional)">
            <input
              type="text"
              value={reference}
              onChange={e => setReference(e.target.value)}
              placeholder={kind === "cheque" ? "Defaults to the cheque no." : "e.g. RENT-07"}
              className={inputClass}
            />
          </Field>
          <Field label="Note (optional)">
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Anything worth remembering"
              className={inputClass}
            />
          </Field>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white py-2.5 rounded-lg text-sm transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? "Saving…" : editing ? "Save changes" : "Add to register"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Choice<T extends string>({ label, value, onChange, options }: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: [T, string, React.ReactNode][];
}) {
  return (
    <div>
      <label className="text-xs text-gray-400 block mb-1">{label}</label>
      <div className="grid grid-cols-2 gap-2">
        {options.map(([key, text, icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium border transition ${
              value === key
                ? "bg-[#F97316]/15 border-[#F97316] text-white"
                : "bg-[#0B1120] border-white/10 text-gray-400 hover:text-white hover:border-white/25"
            }`}
          >
            {icon}{text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-gray-400 block mb-1">{label}</label>
      {children}
    </div>
  );
}
