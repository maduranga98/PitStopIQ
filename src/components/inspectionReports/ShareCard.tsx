import { useEffect, useState } from "react";
import { AlertCircle, Check, Copy, Eye, Link2Off, Loader2, MessageCircle, MessageSquare, Send } from "lucide-react";
import { callableErrorMessage } from "../../lib/callableError";
import { useNetworkStore } from "../../store/networkSlice";
import {
  SmsQuotaError, loadShareCenter, markShared, previewReportSms, sendReportSms, setReportLinkRevoked,
  setVisibleToCustomer, smsQuotaExhausted, type ShareCenter,
} from "../../lib/inspectionReports/share";
import { buildWhatsAppMessage, publicReportUrl, whatsAppUrl } from "../../lib/inspectionReports/shareText";
import type { InspectionReport } from "../../types/inspectionReports";

const fmt = (ts: { toDate?: () => Date } | null | undefined) =>
  ts?.toDate ? ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

/**
 * Send a finalized report: WhatsApp, SMS (the center's monthly quota) or copy
 * link; see when it was sent and first viewed; choose whether it lists in the
 * customer portal; the Owner can revoke the link. Owner and Manager only.
 * Sending needs a connection.
 */
export default function ShareCard({ report, centerId, isOwner }: { report: InspectionReport; centerId: string; isOwner: boolean }) {
  const online = useNetworkStore((s) => s.status) !== "offline";
  const [center, setCenter] = useState<ShareCenter | null>(null);
  const [busy, setBusy] = useState<"sms" | "revoke" | null>(null);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  useEffect(() => {
    let active = true;
    loadShareCenter(centerId).then((c) => { if (active) setCenter(c); }).catch(() => {});
    return () => { active = false; };
  }, [centerId]);

  const link = publicReportUrl(report.shareToken);
  const revoked = report.shareRevoked === true;
  const phone = report.header.customerPhone;
  const exhausted = center ? smsQuotaExhausted(center) : false;
  const sms = center ? previewReportSms(report, center.name) : null;
  const canSend = online && !revoked && !!phone;

  function whatsApp() {
    const text = buildWhatsAppMessage({
      customerName: report.header.customerName, reportNumber: report.reportNumber ?? "", plate: report.header.plateNumber,
      link, centerPhone: center?.phone,
    });
    window.open(whatsAppUrl(phone, text), "_blank", "noopener");
    markShared(centerId, report.id).catch(() => {});
  }

  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setMsg({ kind: "err", text: "Couldn't copy. Select the link and copy it by hand." }); }
  }

  async function sendSms() {
    if (!center) return;
    setBusy("sms"); setMsg(null);
    try {
      await sendReportSms(centerId, report, center);
      setMsg({ kind: "ok", text: "SMS queued. It's sent within a minute." });
      loadShareCenter(centerId).then(setCenter).catch(() => {});
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof SmsQuotaError ? e.message : "Couldn't queue the SMS. Please try again." });
    } finally { setBusy(null); }
  }

  async function toggleRevoked() {
    setBusy("revoke"); setMsg(null); setConfirmRevoke(false);
    try { await setReportLinkRevoked(centerId, report.id, !revoked); }
    catch (e) { setMsg({ kind: "err", text: callableErrorMessage(e, "Couldn't change the link. Please try again.") }); }
    finally { setBusy(null); }
  }

  return (
    <div className="bg-[#162032] border border-white/10 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Send className="w-4 h-4 text-[#F97316]" />
        <h2 className="text-sm font-semibold flex-1">Share with customer</h2>
        {revoked && <span className="text-[10px] font-semibold uppercase rounded px-1.5 py-px bg-red-500/10 text-red-300 border border-red-500/25">Link revoked</span>}
      </div>

      <div className="flex items-center gap-2 bg-[#0B1120] border border-white/10 rounded-lg px-3 py-2">
        <p className="flex-1 min-w-0 text-xs text-gray-400 truncate">{link}</p>
        <button type="button" onClick={copy} className="flex items-center gap-1 text-xs text-gray-300 hover:text-white">
          {copied ? <><Check className="w-3.5 h-3.5 text-green-400" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={whatsApp} disabled={!canSend}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-40 py-2.5 text-xs font-semibold text-white">
          <MessageCircle className="w-4 h-4" /> WhatsApp
        </button>
        <button type="button" onClick={sendSms} disabled={!canSend || exhausted || !center || busy !== null}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-white/15 hover:border-white/30 disabled:opacity-40 py-2.5 text-xs font-semibold text-gray-100">
          {busy === "sms" ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />} SMS
        </button>
      </div>

      {sms && center && !exhausted && !revoked && (
        <p className="text-[11px] text-gray-500">SMS uses {sms.segments} credit{sms.segments === 1 ? "" : "s"} · {Math.max(0, center.smsLimit - center.smsUsed)} left this month</p>
      )}
      {exhausted && <p className="text-xs text-amber-300">This month's SMS quota is used up. WhatsApp and the link still work.</p>}
      {!phone && <p className="text-xs text-amber-300">This customer has no phone number. Copy the link instead.</p>}
      {!online && <p className="text-xs text-amber-300">Sending needs a connection.</p>}
      {revoked && <p className="text-xs text-gray-400">The link is switched off. Customers who open it see that the report is unavailable.</p>}

      <div className="text-xs text-gray-400 space-y-1">
        <p>{report.sharedAt ? `Sent ${fmt(report.sharedAt)}` : "Not sent yet"}</p>
        <p className="flex items-center gap-1.5">
          <Eye className="w-3.5 h-3.5" />
          {report.viewedAt ? `First viewed ${fmt(report.viewedAt)} · ${report.viewCount ?? 0} view${report.viewCount === 1 ? "" : "s"}` : "Not viewed yet"}
        </p>
      </div>

      <label className="flex items-center justify-between gap-3 text-xs text-gray-300 pt-1">
        <span>Show in the customer's portal<span className="block text-[11px] text-gray-500">The link above works either way.</span></span>
        <button type="button" role="switch" aria-checked={report.visibleToCustomer} aria-label="Show in the customer's portal"
          onClick={() => setVisibleToCustomer(centerId, report.id, !report.visibleToCustomer).catch(() => setMsg({ kind: "err", text: "Couldn't change that. Please try again." }))}
          className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${report.visibleToCustomer ? "bg-[#F97316]" : "bg-white/10"}`}>
          <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${report.visibleToCustomer ? "translate-x-4" : "translate-x-0"}`} />
        </button>
      </label>

      {isOwner && (
        <div className="pt-1">
          {confirmRevoke ? (
            <div className="rounded-lg border border-white/10 bg-[#0B1120] p-3 space-y-2">
              <p className="text-xs text-gray-300">Switch this link off? Anyone who opens it will see the report is unavailable. You can restore it.</p>
              <div className="flex gap-3 text-xs">
                <button onClick={toggleRevoked} className="text-red-300 font-semibold">Revoke link</button>
                <button onClick={() => setConfirmRevoke(false)} className="text-gray-500">Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" disabled={!online || busy !== null} onClick={() => (revoked ? toggleRevoked() : setConfirmRevoke(true))}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-300 disabled:opacity-40">
              <Link2Off className="w-3.5 h-3.5" /> {revoked ? "Restore link" : "Revoke link"}
            </button>
          )}
        </div>
      )}

      {msg && (
        <p className={`flex items-start gap-1.5 text-xs ${msg.kind === "ok" ? "text-green-300" : "text-red-300"}`}>
          {msg.kind === "err" && <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />}{msg.text}
        </p>
      )}
    </div>
  );
}
