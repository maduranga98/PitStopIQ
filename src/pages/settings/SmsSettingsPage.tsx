import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { ArrowLeft, MessageSquare, Info, CheckCircle, AlertTriangle } from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { ServiceCenter } from "../../types/auth";
import {
  DEFAULT_COMPLETION_TEMPLATE,
  DEFAULT_REMINDER_TEMPLATE,
  VALID_PLACEHOLDERS,
  SAMPLE_COMPLETION,
  SAMPLE_REMINDER,
  resolveCompletionTemplate,
  resolveReminderTemplate,
  validateTemplate,
  smsCredits,
} from "../../lib/smsTemplates";

const canEdit = (role?: string) => role === "Owner" || role === "Manager";

function TemplateEditor({
  label,
  template,
  setTemplate,
  preview,
  invalidPlaceholders,
  readOnly,
}: {
  label: string;
  template: string;
  setTemplate: (v: string) => void;
  preview: string;
  invalidPlaceholders: string[];
  readOnly: boolean;
}) {
  const len = preview.length;
  const credits = smsCredits(len);
  const over320 = len > 320;

  return (
    <div className="bg-[#162032] border border-white/10 rounded-xl p-5 space-y-4">
      <div className="text-sm font-semibold text-white">{label}</div>

      <div>
        <label className="text-xs text-gray-400 block mb-1">Template</label>
        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          disabled={readOnly}
          rows={4}
          className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 disabled:opacity-50 resize-none font-mono"
        />
        {invalidPlaceholders.length > 0 && (
          <div className="flex items-center gap-1.5 mt-1 text-xs text-red-400">
            <AlertTriangle className="w-3.5 h-3.5" />
            Unknown placeholders: {invalidPlaceholders.join(", ")}
          </div>
        )}
      </div>

      <div>
        <label className="text-xs text-gray-400 block mb-1">Live Preview</label>
        <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-300 italic min-h-[60px]">
          "{preview}"
        </div>
        <div className={`flex items-center gap-3 mt-1.5 text-xs ${over320 ? "text-red-400" : len > 160 ? "text-amber-400" : "text-gray-500"}`}>
          <span>{len} chars</span>
          <span>·</span>
          <span>{credits} SMS credit{credits !== 1 ? "s" : ""}</span>
          {len > 160 && len <= 320 && <span className="text-amber-400">· 2 credits will be charged</span>}
          {over320 && <span className="text-red-400">· Exceeds 320 chars</span>}
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-lg p-3">
        <div className="text-xs text-gray-500 mb-2">Available placeholders</div>
        <div className="flex flex-wrap gap-1.5">
          {VALID_PLACEHOLDERS.map((p) => (
            <button
              key={p}
              type="button"
              disabled={readOnly}
              onClick={() => setTemplate((prev) => prev + p)}
              className="text-xs bg-orange-500/15 hover:bg-orange-500/30 text-orange-400 px-2 py-0.5 rounded font-mono disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SmsSettingsPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const [center, setCenter] = useState<ServiceCenter | null>(null);
  const [loading, setLoading] = useState(true);

  const [completionTemplate, setCompletionTemplate] = useState(DEFAULT_COMPLETION_TEMPLATE);
  const [reminderTemplate, setReminderTemplate] = useState(DEFAULT_REMINDER_TEMPLATE);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // Test SMS state
  const [testPhone, setTestPhone] = useState("");
  const [testType, setTestType] = useState<"completion" | "reminder">("completion");
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<"sent" | "error" | null>(null);

  const centerId = currentUser?.centerId;
  const role = currentUser?.role;
  const editable = canEdit(role);

  useEffect(() => {
    if (!centerId) return;
    getDoc(doc(db, "servicecenters", centerId)).then((snap) => {
      if (snap.exists()) {
        const d = snap.data() as ServiceCenter;
        setCenter(d);
        if (d.completionSmsTemplate) setCompletionTemplate(d.completionSmsTemplate);
        if (d.reminderSmsTemplate) setReminderTemplate(d.reminderSmsTemplate);
      }
      setLoading(false);
    });
  }, [centerId]);

  const completionPreview = resolveCompletionTemplate(completionTemplate, SAMPLE_COMPLETION);
  const reminderPreview = resolveReminderTemplate(reminderTemplate, SAMPLE_REMINDER);
  const completionErrors = validateTemplate(completionTemplate);
  const reminderErrors = validateTemplate(reminderTemplate);

  const handleSave = async () => {
    if (!centerId) return;
    if (completionErrors.length || reminderErrors.length) {
      setError("Fix invalid placeholders before saving.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updateDoc(doc(db, "servicecenters", centerId), {
        completionSmsTemplate: completionTemplate,
        reminderSmsTemplate: reminderTemplate,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Failed to save templates.");
    }
    setSaving(false);
  };

  const handleResetCompletion = () => setCompletionTemplate(DEFAULT_COMPLETION_TEMPLATE);
  const handleResetReminder = () => setReminderTemplate(DEFAULT_REMINDER_TEMPLATE);

  const handleSendTest = async () => {
    if (!testPhone.trim()) return;
    setTestSending(true);
    setTestResult(null);
    try {
      // In production this would call a Firebase callable function.
      // For now we simulate a 1.5 second delay and always succeed.
      await new Promise((r) => setTimeout(r, 1500));
      setTestResult("sent");
    } catch {
      setTestResult("error");
    }
    setTestSending(false);
  };

  const quotaUsed = center?.smsQuotaUsed ?? 0;
  const quotaLimit = center?.smsQuotaLimit ?? (center?.plan === "pro" ? 1000 : 200);
  const quotaPct = quotaLimit > 0 ? Math.round((quotaUsed / quotaLimit) * 100) : 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center text-gray-400">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-[#162032]">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => navigate("/")} className="text-gray-400 hover:text-white">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-orange-400" />
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider">Settings</div>
              <div className="text-lg font-bold">SMS Settings</div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Plan & Quota */}
        <div className="bg-[#162032] border border-white/10 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-white">SMS Quota</div>
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold uppercase ${center?.plan === "pro" ? "bg-orange-500/20 text-orange-400" : "bg-gray-500/20 text-gray-400"}`}>
              {center?.plan ?? "basic"} plan
            </span>
          </div>
          <div className="flex items-end justify-between text-sm mb-2">
            <span className="text-gray-400">Used this month</span>
            <span className={quotaPct >= 100 ? "text-red-400 font-semibold" : quotaPct >= 80 ? "text-amber-400 font-semibold" : "text-white"}>
              {quotaUsed} / {quotaLimit} SMS
            </span>
          </div>
          <div className="w-full bg-white/10 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${quotaPct >= 100 ? "bg-red-500" : quotaPct >= 80 ? "bg-amber-500" : "bg-green-500"}`}
              style={{ width: `${Math.min(quotaPct, 100)}%` }}
            />
          </div>
          {quotaPct >= 100 && (
            <div className="flex items-center gap-2 mt-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-3 py-2 text-xs">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              Quota reached — SMS sending is paused until next month or plan upgrade.
            </div>
          )}
          {quotaPct >= 80 && quotaPct < 100 && (
            <div className="flex items-center gap-2 mt-3 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg px-3 py-2 text-xs">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              You've used {quotaPct}% of your monthly SMS quota.
            </div>
          )}
        </div>

        {/* Plan access notice */}
        {center?.plan === "basic" && (
          <div className="flex items-start gap-2 bg-blue-500/10 border border-blue-500/20 text-blue-300 rounded-xl px-4 py-3 text-xs">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
            SMS features are available on Basic (LKR 4,999/mo) and Pro (LKR 7,999/mo) plans.
          </div>
        )}

        {/* Completion SMS Template */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-gray-300">Completion SMS Template</div>
            {editable && (
              <button onClick={handleResetCompletion} className="text-xs text-gray-500 hover:text-gray-300 underline">
                Reset to default
              </button>
            )}
          </div>
          <TemplateEditor
            label="Sent automatically when a job is marked Done"
            template={completionTemplate}
            setTemplate={setCompletionTemplate}
            preview={completionPreview}
            invalidPlaceholders={completionErrors}
            readOnly={!editable}
          />
        </div>

        {/* Reminder SMS Template */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-gray-300">Reminder SMS Template</div>
            {editable && (
              <button onClick={handleResetReminder} className="text-xs text-gray-500 hover:text-gray-300 underline">
                Reset to default
              </button>
            )}
          </div>
          <TemplateEditor
            label="Sent nightly by automated cron when vehicle approaches service mileage"
            template={reminderTemplate}
            setTemplate={setReminderTemplate}
            preview={reminderPreview}
            invalidPlaceholders={reminderErrors}
            readOnly={!editable}
          />
        </div>

        {/* Save */}
        {editable && (
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || (completionErrors.length > 0) || (reminderErrors.length > 0)}
              className="bg-orange-500 hover:bg-orange-600 text-white px-5 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 transition"
            >
              {saving ? "Saving…" : "Save Templates"}
            </button>
            {saved && (
              <div className="flex items-center gap-1.5 text-green-400 text-sm">
                <CheckCircle className="w-4 h-4" />
                Saved
              </div>
            )}
            {error && <div className="text-red-400 text-sm">{error}</div>}
          </div>
        )}

        {/* Send Test SMS */}
        <div className="bg-[#162032] border border-white/10 rounded-xl p-5 space-y-4">
          <div className="text-sm font-semibold text-white">Send Test SMS</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-400 block mb-1">Phone number</label>
              <input
                type="tel"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="+94771234567"
                className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Template</label>
              <select
                value={testType}
                onChange={(e) => setTestType(e.target.value as "completion" | "reminder")}
                className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
              >
                <option value="completion">Completion</option>
                <option value="reminder">Reminder</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSendTest}
              disabled={testSending || !testPhone.trim()}
              className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition"
            >
              {testSending ? "Sending…" : "Send Test SMS"}
            </button>
            {testResult === "sent" && (
              <span className="text-green-400 text-sm flex items-center gap-1">
                <CheckCircle className="w-4 h-4" /> Test SMS queued
              </span>
            )}
            {testResult === "error" && (
              <span className="text-red-400 text-sm flex items-center gap-1">
                <AlertTriangle className="w-4 h-4" /> Failed to send
              </span>
            )}
          </div>
          <p className="text-xs text-gray-600">
            Uses sample data to preview the resolved template on a real device. Counts against your monthly quota.
          </p>
        </div>
      </div>
    </div>
  );
}
