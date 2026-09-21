import { useMemo, useState } from "react";
import { Upload, Download, FileSpreadsheet, AlertTriangle } from "lucide-react";
import AdminModal, { Field, inputClass } from "./AdminModal";
import { downloadCSV } from "../../lib/csvExport";
import {
  LEAD_FIELD_LABELS, LEAD_TEMPLATE_HEADERS, REQUIRED_LEAD_FIELDS,
  guessLeadColumnMap, parseLeadRows, parseSpreadsheet,
  type LeadField, type ParsedLeadRow, type ParsedSheet,
} from "../../lib/leadImport";
import { STAGE_META, type LeadDraft } from "../../types/leads";

const FIELDS = Object.keys(LEAD_FIELD_LABELS) as LeadField[];

/**
 * Brings the existing lead spreadsheet onto the board: pick the file, confirm
 * which column is which, then import everything that isn't already there.
 */
export default function LeadImportModal({
  existingPhones, onImport, onClose,
}: {
  existingPhones: ReadonlySet<string>;
  onImport: (drafts: LeadDraft[]) => Promise<void>;
  onClose: () => void;
}) {
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [map, setMap] = useState<Partial<Record<LeadField, number>>>({});
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      const parsed = await parseSpreadsheet(file);
      if (parsed.rows.length === 0) {
        setError("That sheet has a header row and nothing under it.");
      } else {
        setSheet(parsed);
        setMap(guessLeadColumnMap(parsed.headers));
        setFileName(file.name);
      }
    } catch {
      setError("Couldn't read that file. A .csv, .xls or .xlsx export works.");
    }
    setBusy(false);
  }

  const rows: ParsedLeadRow[] = useMemo(
    () => (sheet ? parseLeadRows(sheet.rows, map, existingPhones) : []),
    [sheet, map, existingPhones],
  );

  const importable = useMemo(() => rows.filter((r) => !r.problem), [rows]);
  const skipped = rows.length - importable.length;
  const ready = REQUIRED_LEAD_FIELDS.every((f) => map[f] !== undefined) && importable.length > 0;

  async function handleImport() {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      await onImport(importable.map((r) => r.draft));
      onClose();
    } catch {
      setError("The import didn't go through. Check the connection and try again.");
      setBusy(false);
    }
  }

  function downloadTemplate() {
    downloadCSV(
      "pitstopiq-leads-template.csv",
      LEAD_TEMPLATE_HEADERS.map((h) => h.header),
      [["Silva Auto Care", "Nimal Silva", "0771234567", "owner@example.com",
        "Nugegoda", "Colombo", "Referral", "new", "0", "feature", "Runs 6 bays"]],
    );
  }

  return (
    <AdminModal
      title="Import leads from a spreadsheet"
      icon={<FileSpreadsheet className="w-4 h-4 text-orange-400" />}
      onClose={onClose}
      size="xl"
      footer={
        <>
          <button
            onClick={downloadTemplate}
            className="mr-auto flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
          >
            <Download className="w-4 h-4" /> Template
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!ready || busy}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white transition-colors"
          >
            {busy ? "Importing…" : `Import ${importable.length} lead${importable.length === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      {!sheet ? (
        <label className="flex flex-col items-center justify-center gap-3 py-14 border-2 border-dashed border-gray-800 rounded-xl cursor-pointer hover:border-orange-500/40 transition-colors">
          <Upload className="w-8 h-8 text-gray-600" />
          <span className="text-sm text-gray-300 font-medium">Choose the lead sheet</span>
          <span className="text-xs text-gray-600">.xlsx, .xls or .csv — the columns are matched up next</span>
          <input
            type="file"
            accept=".csv,.xls,.xlsx"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </label>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-gray-400 truncate">
              <span className="text-gray-200 font-medium">{fileName}</span>
              {" — "}{rows.length} row{rows.length === 1 ? "" : "s"}
            </p>
            <button
              onClick={() => { setSheet(null); setMap({}); }}
              className="text-xs text-gray-500 hover:text-gray-300 whitespace-nowrap"
            >
              Choose another file
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {FIELDS.map((field) => (
              <Field
                key={field}
                label={`${LEAD_FIELD_LABELS[field]}${REQUIRED_LEAD_FIELDS.includes(field) ? " *" : ""}`}
              >
                <select
                  className={inputClass}
                  value={map[field] ?? ""}
                  onChange={(e) =>
                    setMap((m) => {
                      const next = { ...m };
                      if (e.target.value === "") delete next[field];
                      else next[field] = Number(e.target.value);
                      return next;
                    })
                  }
                >
                  <option value="">Not in the sheet</option>
                  {sheet.headers.map((h, i) => (
                    <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                  ))}
                </select>
              </Field>
            ))}
          </div>

          {skipped > 0 && (
            <p className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-px" />
              {skipped} row{skipped === 1 ? "" : "s"} will be skipped — they're listed below with the reason.
              Everything else imports.
            </p>
          )}

          <div className="border border-gray-800 rounded-xl overflow-hidden">
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-950 sticky top-0">
                  <tr className="text-left text-xs text-gray-500">
                    <th className="px-3 py-2 font-medium">Business</th>
                    <th className="px-3 py-2 font-medium">Contact</th>
                    <th className="px-3 py-2 font-medium">Phone</th>
                    <th className="px-3 py-2 font-medium">Stage</th>
                    <th className="px-3 py-2 font-medium">Calls</th>
                    <th className="px-3 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/70">
                  {rows.slice(0, 100).map((row, i) => (
                    <tr key={i} className={row.problem ? "opacity-40" : ""}>
                      <td className="px-3 py-2 text-gray-200">{row.draft.businessName || "—"}</td>
                      <td className="px-3 py-2 text-gray-400">{row.draft.contactName || "—"}</td>
                      <td className="px-3 py-2 text-gray-400 font-mono text-xs">{row.draft.phone || "—"}</td>
                      <td className="px-3 py-2 text-gray-400">{STAGE_META[row.draft.stage].label}</td>
                      <td className="px-3 py-2 text-gray-400">{row.draft.callCount}</td>
                      <td className="px-3 py-2 text-xs text-amber-400 whitespace-nowrap">{row.problem ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 100 && (
              <p className="px-3 py-2 text-xs text-gray-600 bg-gray-950 border-t border-gray-800">
                Showing the first 100 of {rows.length}. All {importable.length} importable rows are written.
              </p>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-400 mt-4">{error}</p>}
    </AdminModal>
  );
}
