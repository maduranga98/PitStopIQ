import { useState, type FormEvent } from "react";
import { UserPlus } from "lucide-react";
import AdminModal, { Field, inputClass } from "./AdminModal";
import { SRI_LANKA_DISTRICTS } from "../../types/auth";
import {
  LEAD_STAGES, LEAD_TAGS, MAX_TRACKED_CALLS, TAG_META,
  blankLeadDraft, type LeadDraft, type LeadStage, type LeadTag,
} from "../../types/leads";

// The words already in the tracker sheet's Source column, so a lead typed in
// by hand reads the same as one imported from it.
const SOURCES = [
  "FB Lead", "Insta Lead", "WhatsApp", "phone call", "whatapp call",
  "Referral", "Walk-in", "Website", "Field visit",
];

/** Add one lead by hand, or edit one already on the board. */
export default function LeadFormModal({
  initial, onSave, onClose,
}: {
  initial?: LeadDraft;
  onSave: (draft: LeadDraft) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<LeadDraft>(initial ?? blankLeadDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = <K extends keyof LeadDraft>(key: K, value: LeadDraft[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleTag = (tag: LeadTag) =>
    setForm((f) => ({
      ...f,
      tags: f.tags.includes(tag) ? f.tags.filter((t) => t !== tag) : [...f.tags, tag],
    }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!form.businessName.trim()) {
      setError("A business name is the one thing a lead needs.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(form);
      onClose();
    } catch {
      setError("Couldn't save the lead. Check the connection and try again.");
      setSaving(false);
    }
  }

  return (
    <AdminModal
      title={initial ? "Edit lead" : "Add lead"}
      icon={<UserPlus className="w-4 h-4 text-orange-400" />}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="lead-form"
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white transition-colors"
          >
            {saving ? "Saving…" : initial ? "Save changes" : "Add lead"}
          </button>
        </>
      }
    >
      <form id="lead-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Business name *">
            <input
              className={inputClass}
              value={form.businessName}
              onChange={(e) => set("businessName", e.target.value)}
              placeholder="Silva Auto Care"
              autoFocus
            />
          </Field>
          <Field label="Contact person">
            <input
              className={inputClass}
              value={form.contactName ?? ""}
              onChange={(e) => set("contactName", e.target.value)}
              placeholder="Nimal Silva"
            />
          </Field>
          <Field label="Phone">
            <input
              className={inputClass}
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="077 123 4567"
              inputMode="tel"
            />
          </Field>
          <Field label="Email">
            <input
              className={inputClass}
              value={form.email ?? ""}
              onChange={(e) => set("email", e.target.value)}
              placeholder="owner@example.com"
              inputMode="email"
            />
          </Field>
          <Field label="Location">
            <input
              className={inputClass}
              value={form.location ?? ""}
              onChange={(e) => set("location", e.target.value)}
              placeholder="Nugegoda"
            />
          </Field>
          <Field label="District">
            <select
              className={inputClass}
              value={form.district ?? ""}
              onChange={(e) => set("district", e.target.value)}
            >
              <option value="">—</option>
              {SRI_LANKA_DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Source">
            <input
              className={inputClass}
              value={form.source ?? ""}
              onChange={(e) => set("source", e.target.value)}
              placeholder="Referral"
              list="lead-sources"
            />
            <datalist id="lead-sources">
              {SOURCES.map((s) => <option key={s} value={s} />)}
            </datalist>
          </Field>
          <Field label="Lead date">
            <input
              type="date"
              className={inputClass}
              value={form.leadDate ?? ""}
              onChange={(e) => set("leadDate", e.target.value)}
            />
          </Field>
          <Field label="Status">
            <select
              className={inputClass}
              value={form.stage}
              onChange={(e) => set("stage", e.target.value as LeadStage)}
            >
              {LEAD_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </Field>
          <Field
            label="Calls made"
            hint="Logging a call raises this on its own — set it here only to back-fill."
          >
            <select
              className={inputClass}
              value={form.callCount}
              onChange={(e) => set("callCount", Number(e.target.value))}
            >
              {Array.from({ length: MAX_TRACKED_CALLS + 1 }, (_, n) => (
                <option key={n} value={n}>{n === 0 ? "No calls yet" : `${n} call${n > 1 ? "s" : ""}`}</option>
              ))}
            </select>
          </Field>
          <Field label="Next follow-up">
            <input
              type="date"
              className={inputClass}
              value={form.nextFollowUp ?? ""}
              onChange={(e) => set("nextFollowUp", e.target.value)}
            />
          </Field>
          <Field label="Follow-up note" hint="When it isn't a date — “after 7.30”, “sir call me”.">
            <input
              className={inputClass}
              value={form.followUpNote ?? ""}
              onChange={(e) => set("followUpNote", e.target.value)}
              placeholder="next week visit"
            />
          </Field>
          <Field label="Demo date & time">
            <input
              className={inputClass}
              value={form.demoAt ?? ""}
              onChange={(e) => set("demoAt", e.target.value)}
              placeholder="7.30 pm"
            />
          </Field>
          <Field label="Price told?">
            <input
              className={inputClass}
              value={form.priceNote ?? ""}
              onChange={(e) => set("priceNote", e.target.value)}
              placeholder="What was quoted, and what they said to it"
            />
          </Field>
          <Field label="Closed amount (Rs)" hint="Once they sign. Adds to the revenue figure on the board.">
            <input
              type="number"
              min={0}
              className={inputClass}
              value={form.closedAmount || ""}
              onChange={(e) => set("closedAmount", Number(e.target.value))}
              placeholder="0"
            />
          </Field>
        </div>

        <Field label="Main problem" hint="What they said is wrong today — the reason they would buy.">
          <input
            className={inputClass}
            value={form.mainProblem ?? ""}
            onChange={(e) => set("mainProblem", e.target.value)}
            placeholder="Customers අඩුයි / no inventory control / service පිළිවෙල නෑ"
          />
        </Field>

        <Field label="Tags">
          <div className="flex flex-wrap gap-2">
            {LEAD_TAGS.map((tag) => {
              const on = form.tags.includes(tag.key);
              return (
                <button
                  key={tag.key}
                  type="button"
                  onClick={() => toggleTag(tag.key)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    on ? TAG_META[tag.key].chip : "bg-gray-950 border border-gray-800 text-gray-500 hover:text-gray-300"
                  }`}
                >
                  {tag.label}
                </button>
              );
            })}
          </div>
        </Field>

        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={form.demoRequested === true}
            onChange={(e) => set("demoRequested", e.target.checked)}
            className="w-4 h-4 accent-orange-500"
          />
          They've asked for a demo
        </label>

        <Field label="Notes">
          <textarea
            className={`${inputClass} min-h-[90px] resize-y`}
            value={form.notes ?? ""}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Background worth keeping — fleet size, what they run today, who decides."
          />
        </Field>

        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </AdminModal>
  );
}
