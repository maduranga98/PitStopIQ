import { useRef, useState } from "react";
import { Contact, Download, Trash2, Upload } from "lucide-react";
import { leadVcfUrl, removeLeadVcf, uploadLeadVcf } from "../../lib/leadVcf";
import type { Lead } from "../../types/leads";

const kb = (n: number) => (n < 1024 ? `${n} B` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Fetches the tokened URL and navigates to it; the file's disposition makes the phone save it. */
function useDownload(leadId: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    setBusy(true);
    setError("");
    try {
      window.location.assign(await leadVcfUrl(leadId));
    } catch {
      setError("Couldn't get the contact file. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, download };
}

/** Super admin: attach, replace, download or remove the lead's .vcf contact card. */
export function LeadVcfAdminPanel({ lead, adminName }: { lead: Lead; adminName: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dl = useDownload(lead.id);
  const vcf = lead.vcfFile;

  async function pick(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      await uploadLeadVcf(lead.id, file, adminName);
    } catch (e) {
      setError(e instanceof Error && e.message.length < 100 ? e.message : "Upload failed. Try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    if (!window.confirm("Remove the contact file from this lead?")) return;
    setBusy(true);
    setError("");
    try { await removeLeadVcf(lead.id); } catch { setError("Couldn't remove it. Try again."); }
    setBusy(false);
  }

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-white flex items-center gap-2">
        <Contact className="w-4 h-4 text-emerald-400" /> Contact file (.vcf)
      </h3>
      <input ref={input} type="file" accept=".vcf,text/vcard,text/x-vcard" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      {vcf ? (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-gray-200 truncate">{vcf.name}</p>
            <p className="text-[11px] text-gray-500">
              {vcf.contacts} contact{vcf.contacts === 1 ? "" : "s"} · {kb(vcf.size)}
              {lead.assignedToName ? ` · caller ${lead.assignedToName} can download it` : " · visible to the caller once assigned"}
            </p>
          </div>
          <button onClick={() => void dl.download()} disabled={dl.busy} title="Download" aria-label="Download"
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-40"><Download className="w-4 h-4" /></button>
          <button onClick={() => input.current?.click()} disabled={busy} title="Replace" aria-label="Replace"
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-40"><Upload className="w-4 h-4" /></button>
          <button onClick={() => void remove()} disabled={busy} title="Remove" aria-label="Remove"
            className="p-2 rounded-lg text-gray-400 hover:text-red-300 hover:bg-gray-800 disabled:opacity-40"><Trash2 className="w-4 h-4" /></button>
        </div>
      ) : (
        <button
          onClick={() => input.current?.click()}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm border border-dashed border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 disabled:opacity-50 transition-colors"
        >
          <Upload className="w-4 h-4" /> {busy ? "Uploading…" : "Upload .vcf file"}
        </button>
      )}
      {(error || dl.error) && <p role="alert" className="text-xs text-red-400">{error || dl.error}</p>}
    </div>
  );
}

/** Caller: one button that saves the contact to the phone. Renders nothing without a file. */
export function LeadVcfCallerButton({ lead }: { lead: Lead }) {
  const dl = useDownload(lead.id);
  if (!lead.vcfFile) return null;
  return (
    <div>
      <button
        onClick={() => void dl.download()}
        disabled={dl.busy}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-gray-800 hover:bg-gray-700 disabled:opacity-60 text-gray-100 transition-colors"
      >
        <Contact className="w-4 h-4 text-emerald-400" />
        {dl.busy ? "Preparing…" : "Save contact to phone (.vcf)"}
      </button>
      {dl.error && <p role="alert" className="text-xs text-red-400 mt-1.5">{dl.error}</p>}
    </div>
  );
}
