import { useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import Sheet, { fieldClass, ghostBtn, primaryBtn } from "./Sheet";
import { createVehicleModel, setVehicleModelActive, updateVehicleModel } from "../../lib/repairCatalog/writes";
import { findDuplicateModel } from "../../lib/repairCatalog/models.ts";
import { modelLabel, normalizeModelKey } from "../../lib/repairCatalog/keys.ts";
import type { VehicleModel } from "../../types/repairCatalog";

interface Props {
  centerId: string;
  /** Every model on file (active or not), for duplicate detection. */
  models: VehicleModel[];
  typeOptions: string[];
  /** Editing this model; omitted to create. */
  editing?: VehicleModel;
  /** Prefill for a new model (e.g. from the vehicle form). */
  initial?: { make?: string; model?: string; vehicleType?: string };
  onClose: () => void;
  /** Called with the saved model, or the existing one the user chose instead of a duplicate. */
  onSaved: (model: VehicleModel, outcome: "created" | "updated" | "existing") => void;
}

export default function ModelFormDialog({ centerId, models, typeOptions, editing, initial, onClose, onSaved }: Props) {
  const [make, setMake] = useState(editing?.make ?? initial?.make ?? "");
  const [model, setModel] = useState(editing?.model ?? initial?.model ?? "");
  const [vehicleType, setVehicleType] = useState(editing?.vehicleType ?? initial?.vehicleType ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Checked on every keystroke against the cached list, so the owner is told
  // BEFORE saving that this model is already on file.
  const duplicate = useMemo(
    () => findDuplicateModel(models, make, model, editing?.id),
    [models, make, model, editing?.id],
  );

  const canSave = make.trim() !== "" && model.trim() !== "" && vehicleType.trim() !== "" && !duplicate && !busy;

  async function save() {
    setBusy(true);
    setError("");
    try {
      const input = { make, model, vehicleType, notes };
      if (editing) {
        const res = await updateVehicleModel(centerId, editing.id, input, models);
        if (res.status === "exists") { setBusy(false); return; } // surfaced by `duplicate`
        onSaved({
          ...editing, make: make.trim(), model: model.trim(), vehicleType: vehicleType.trim(), notes,
          key: normalizeModelKey(make, model),
        }, "updated");
      } else {
        const res = await createVehicleModel(centerId, input, models);
        onSaved(res.model, res.status === "created" ? "created" : "existing");
      }
    } catch {
      setError("Couldn't save. Check your connection and try again.");
      setBusy(false);
    }
  }

  async function useExisting() {
    if (!duplicate) return;
    setBusy(true);
    try {
      // An inactive model is brought back rather than duplicated.
      if (duplicate.isActive === false) await setVehicleModelActive(centerId, duplicate.id, true);
      onSaved({ ...duplicate, isActive: true }, "existing");
    } catch {
      setError("Couldn't update the existing model. Try again.");
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={editing ? "Edit model" : "Add vehicle model"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={ghostBtn} onClick={onClose}>Cancel</button>
          <button type="button" className={primaryBtn} disabled={!canSave} onClick={save}>
            {busy ? "Saving…" : editing ? "Save" : "Add model"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1.5 col-span-2 sm:col-span-1">
          <span className="text-sm font-medium text-gray-300">Make</span>
          <input className={fieldClass} value={make} onChange={(e) => setMake(e.target.value)} placeholder="Honda" autoFocus={!initial?.make} />
        </label>
        <label className="space-y-1.5 col-span-2 sm:col-span-1">
          <span className="text-sm font-medium text-gray-300">Model</span>
          <input className={fieldClass} value={model} onChange={(e) => setModel(e.target.value)} placeholder="Dio" autoFocus={!!initial?.make} />
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-gray-300">Vehicle type</span>
        <input className={fieldClass} list="rc-type-options" value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} placeholder="motor bike" />
        <datalist id="rc-type-options">{typeOptions.map((t) => <option key={t} value={t} />)}</datalist>
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-gray-300">Notes <span className="text-gray-500 font-normal">(optional)</span></span>
        <input className={fieldClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 110cc scooter" />
      </label>

      {duplicate && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
          <p className="flex items-start gap-2 text-sm text-amber-200">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              <strong>{modelLabel(duplicate)}</strong> ({duplicate.vehicleType}) is already in your list
              {duplicate.isActive === false ? ", but is switched off" : ""}.
            </span>
          </p>
          {!editing && (
            <button type="button" className={primaryBtn} disabled={busy} onClick={useExisting}>
              {duplicate.isActive === false ? "Switch it back on and use it" : "Use the existing model"}
            </button>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </Sheet>
  );
}
