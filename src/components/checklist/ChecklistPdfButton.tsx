import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { openChecklistPdf, type ChecklistPdfKind } from "../../lib/postServiceChecklistPdf";

/** "PDF" for a signed-off checklist — makes the report on first use, then reopens it. */
export default function ChecklistPdfButton({ centerId, kind, id }: {
  centerId: string; kind: ChecklistPdfKind; id: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function open() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await openChecklistPdf(centerId, kind, id);
    } catch {
      setError("Couldn't make the PDF. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={open}
        disabled={busy}
        className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white border border-white/10 hover:border-white/20 rounded-lg px-3 py-1.5 disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
        PDF
      </button>
      {error && <span role="alert" className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
