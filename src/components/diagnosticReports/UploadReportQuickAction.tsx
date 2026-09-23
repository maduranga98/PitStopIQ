import { useState } from "react";
import { X, Search, Car } from "lucide-react";
import { searchVehiclesByPlate } from "../../lib/search";
import DiagnosticReportUploadSheet from "./DiagnosticReportUploadSheet";
import type { Vehicle } from "../../types/auth";
import type { DiagnosticReport } from "../../types/diagnosticReports";

interface UploadReportQuickActionProps {
  open: boolean;
  onClose: () => void;
  centerId: string;
  uploadedBy: string;
  uploadedByName: string;
  onCreated?: (report: DiagnosticReport) => void;
}

/** The dashboard's "Upload Scan Report" tile: search a vehicle by plate,
 *  then hand off to the shared upload sheet as a standalone report. */
export default function UploadReportQuickAction({
  open, onClose, centerId, uploadedBy, uploadedByName, onCreated,
}: UploadReportQuickActionProps) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Vehicle[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Vehicle | null>(null);

  async function handleSearch(value: string) {
    setTerm(value);
    if (value.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      setResults(await searchVehiclesByPlate(centerId, value));
    } finally {
      setSearching(false);
    }
  }

  function close() {
    setTerm("");
    setResults([]);
    setSelected(null);
    onClose();
  }

  if (!open) return null;

  if (selected) {
    return (
      <DiagnosticReportUploadSheet
        open
        onClose={close}
        onCreated={(report) => { onCreated?.(report); close(); }}
        centerId={centerId}
        vehicleId={selected.id}
        customerId={selected.customerId}
        serviceId={null}
        uploadedBy={uploadedBy}
        uploadedByName={uploadedByName}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50">
      <div className="bg-[#0B1120] border border-white/10 sm:rounded-xl rounded-t-2xl w-full sm:max-w-md max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 className="text-base font-semibold text-white">Upload Scan Report</h2>
          <button onClick={close} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-gray-400">Find the vehicle to attach this scan report to.</p>
          <div className="relative">
            <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              autoFocus
              value={term}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Plate number…"
              className="w-full bg-white/5 border border-white/10 text-white rounded-lg pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-orange-500"
            />
          </div>
          {searching && <p className="text-xs text-gray-500">Searching…</p>}
          {!searching && term.trim().length >= 2 && results.length === 0 && (
            <p className="text-xs text-gray-500">No vehicle found for "{term}".</p>
          )}
          <div className="space-y-1.5">
            {results.map((v) => (
              <button
                key={v.id}
                onClick={() => setSelected(v)}
                className="w-full flex items-center gap-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-3 py-2.5 text-left transition"
              >
                <Car className="w-4 h-4 text-[#F97316] flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-mono font-bold text-white">{v.plateNumber}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {[v.make, v.model].filter(Boolean).join(" ")}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
