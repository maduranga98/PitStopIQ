import { useState, useRef } from "react";
import { doc, Timestamp } from "firebase/firestore";
import { safeSetDoc } from "../../lib/firestoreWrite";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import {
  ChevronRight, ChevronLeft, Camera, X, Check,
  AlertTriangle, Fuel, Car,
} from "lucide-react";
import { db, storage } from "../../config/firebase";
import type {
  FuelLevel, OverallCondition, ChecklistStatus,
  ChecklistItem, DamageReport,
} from "../../types/auth";
import { INSPECTION_CHECKLIST_ITEMS } from "../../types/auth";

const FUEL_OPTIONS: { value: FuelLevel; label: string; icon: string }[] = [
  { value: "empty",         label: "Empty",  icon: "□□□□" },
  { value: "quarter",       label: "1/4",    icon: "■□□□" },
  { value: "half",          label: "1/2",    icon: "■■□□" },
  { value: "three_quarter", label: "3/4",    icon: "■■■□" },
  { value: "full",          label: "Full",   icon: "■■■■" },
];

const CONDITION_OPTIONS: { value: OverallCondition; label: string; color: string }[] = [
  { value: "good",          label: "Good",          color: "border-green-500  bg-green-500/10  text-green-300" },
  { value: "minor_damage",  label: "Minor Damage",  color: "border-amber-500  bg-amber-500/10  text-amber-300" },
  { value: "major_damage",  label: "Major Damage",  color: "border-red-500    bg-red-500/10    text-red-300"   },
];

const STATUS_OPTIONS: { value: ChecklistStatus; label: string; color: string }[] = [
  { value: "ok",              label: "OK",            color: "border-green-500 bg-green-500/15 text-green-300" },
  { value: "needs_attention", label: "Needs Attn",    color: "border-amber-500 bg-amber-500/15 text-amber-300" },
  { value: "damaged",         label: "Damaged",       color: "border-red-500   bg-red-500/15   text-red-300"   },
];

interface DamageReportDraft {
  id: string;
  location: string;
  description: string;
  photoFile: File | null;
  photoPreview: string | null;
  uploading: boolean;
}

interface Props {
  centerId: string;
  jobId: string;
  conductedBy: string;
  plateNumber?: string;
  onComplete: () => void;
}

export default function VehicleInspectionForm({
  centerId, jobId, conductedBy, plateNumber, onComplete,
}: Props) {
  const [step, setStep] = useState(1);

  // Step 1 — Overview
  const [fuelLevel, setFuelLevel] = useState<FuelLevel>("half");
  const [condition, setCondition] = useState<OverallCondition>("good");
  const [odometer, setOdometer] = useState("");

  // Step 2 — Checklist
  const [checklist, setChecklist] = useState<ChecklistItem[]>(
    INSPECTION_CHECKLIST_ITEMS.map((item) => ({ item, status: "ok" as ChecklistStatus })),
  );

  // Step 3 — Damage reports
  const [damageReports, setDamageReports] = useState<DamageReportDraft[]>([]);

  // Step 4 — Notes
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Which checklist items need attention or are damaged → pre-fill damage reports
  const flaggedItems = checklist.filter(
    (c) => c.status === "needs_attention" || c.status === "damaged",
  );

  function goToStep3() {
    // Pre-populate damage reports for newly flagged items
    const existing = new Set(damageReports.map((r) => r.location));
    const toAdd = flaggedItems
      .filter((f) => !existing.has(f.item))
      .map((f) => ({
        id: crypto.randomUUID(),
        location: f.item,
        description: "",
        photoFile: null,
        photoPreview: null,
        uploading: false,
      }));
    // Remove reports for items that are no longer flagged
    const keep = damageReports.filter((r) => flaggedItems.some((f) => f.item === r.location));
    setDamageReports([...keep, ...toAdd]);
    setStep(3);
  }

  function handleChecklistStatus(item: string, status: ChecklistStatus) {
    setChecklist((prev) =>
      prev.map((c) => (c.item === item ? { ...c, status } : c)),
    );
  }

  function handlePhotoSelect(reportId: string, file: File) {
    const url = URL.createObjectURL(file);
    setDamageReports((prev) =>
      prev.map((r) => r.id === reportId ? { ...r, photoFile: file, photoPreview: url } : r),
    );
  }

  function removeReport(id: string) {
    setDamageReports((prev) => prev.filter((r) => r.id !== id));
  }

  function addReport() {
    setDamageReports((prev) => [
      ...prev,
      { id: crypto.randomUUID(), location: "", description: "", photoFile: null, photoPreview: null, uploading: false },
    ]);
  }

  async function uploadPhoto(report: DamageReportDraft): Promise<string | null> {
    if (!report.photoFile) return null;
    const path = `inspections/${centerId}/${jobId}/${report.id}.jpg`;
    const fileRef = storageRef(storage, path);
    await uploadBytes(fileRef, report.photoFile);
    return getDownloadURL(fileRef);
  }

  // Determine how many steps: skip step 3 if nothing flagged
  const totalSteps = flaggedItems.length > 0 || damageReports.length > 0 ? 4 : 3;
  const stepLabels =
    totalSteps === 4
      ? ["Overview", "Checklist", "Damage", "Notes"]
      : ["Overview", "Checklist", "Notes"];

  function nextStep() {
    if (step === 1) { setStep(2); return; }
    if (step === 2) {
      if (flaggedItems.length > 0) { goToStep3(); return; }
      setStep(totalSteps === 4 ? 3 : 3);
      return;
    }
    if (step === 3 && totalSteps === 4) { setStep(4); return; }
    // should not reach here — last step is handled by complete button
  }

  // Map logical step to display step index (0-based)
  function displayStep() {
    if (totalSteps === 3) {
      // steps 1, 2, 3 → display 0, 1, 2
      return step - 1;
    }
    // steps 1, 2, 3, 4 → display 0, 1, 2, 3
    return step - 1;
  }

  async function handleComplete() {
    setSaving(true);
    setError("");
    try {
      const now = Timestamp.now();
      const photoDeleteAt = Timestamp.fromMillis(now.toMillis() + 30 * 24 * 60 * 60 * 1000);

      // Upload photos
      const finalReports: DamageReport[] = await Promise.all(
        damageReports
          .filter((r) => r.location.trim() || r.description.trim() || r.photoFile)
          .map(async (r) => {
            let photoUrl: string | null = null;
            if (r.photoFile) {
              photoUrl = await uploadPhoto(r);
            }
            return {
              id: r.id,
              location: r.location,
              description: r.description,
              photoUrl,
              photoDeleteAt,
              photosDeleted: false,
            };
          }),
      );

      const odometerNum = parseInt(odometer, 10);

      await safeSetDoc(
        doc(db, "servicecenters", centerId, "jobs", jobId, "inspection", "main"),
        {
          conductedBy,
          completedAt: now,
          fuelLevel,
          odometerReading: isNaN(odometerNum) ? 0 : odometerNum,
          overallCondition: condition,
          checklistItems: checklist.map((c) => ({ item: c.item, status: c.status })),
          damageReports: finalReports,
          notes: notes.trim() || null,
          skipped: false,
          nextPhotoDeleteAt: finalReports.some((r) => r.photoUrl) ? photoDeleteAt : null,
          photosDeleted: false,
        },
      );

      onComplete();
    } catch (e) {
      setError("Failed to save inspection. Please try again.");
      setSaving(false);
    }
  }

  const isLastStep = step === (totalSteps === 4 ? 4 : 3);

  return (
    <div className="fixed inset-0 bg-[#0B1120] z-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-[#162032] border-b border-white/10 flex-shrink-0">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3 mb-4">
            <Car className="w-5 h-5 text-[#F97316]" />
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider">Vehicle Inspection</div>
              {plateNumber && <div className="text-base font-bold text-white">{plateNumber}</div>}
            </div>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-0">
            {stepLabels.map((label, i) => {
              const current = displayStep();
              const done = i < current;
              const active = i === current;
              return (
                <div key={label} className="flex items-center flex-1">
                  <div className="flex flex-col items-center gap-1 flex-1">
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                        done ? "bg-green-500 border-green-500 text-white"
                        : active ? "bg-[#F97316] border-[#F97316] text-white"
                        : "bg-transparent border-white/20 text-gray-500"
                      }`}
                    >
                      {done ? <Check className="w-3 h-3" /> : i + 1}
                    </div>
                    <span className={`text-xs ${active ? "text-white" : "text-gray-500"}`}>{label}</span>
                  </div>
                  {i < stepLabels.length - 1 && (
                    <div className={`h-0.5 flex-1 mx-1 mb-4 ${done ? "bg-green-500" : "bg-white/10"}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">

          {/* ── Step 1: Overview ── */}
          {step === 1 && (
            <>
              {/* Fuel level */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Fuel className="w-4 h-4 text-gray-400" />
                  <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Fuel Level</label>
                </div>
                <div className="flex gap-2">
                  {FUEL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setFuelLevel(opt.value)}
                      className={`flex-1 flex flex-col items-center gap-1.5 py-3 px-1 rounded-xl border-2 transition-all text-xs font-medium ${
                        fuelLevel === opt.value
                          ? "border-[#F97316] bg-[#F97316]/10 text-white"
                          : "border-white/10 bg-white/5 text-gray-400 hover:border-white/30"
                      }`}
                    >
                      <span className="text-[10px] font-mono text-gray-400">{opt.icon}</span>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Overall condition */}
              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold block mb-3">Overall Condition</label>
                <div className="flex gap-3">
                  {CONDITION_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setCondition(opt.value)}
                      className={`flex-1 py-3 px-2 rounded-xl border-2 transition-all text-sm font-medium ${
                        condition === opt.value
                          ? opt.color + " border-opacity-100"
                          : "border-white/10 bg-white/5 text-gray-400 hover:border-white/30"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Odometer */}
              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold block mb-2">Odometer Reading (km)</label>
                <input
                  type="number"
                  value={odometer}
                  onChange={(e) => setOdometer(e.target.value)}
                  placeholder="e.g. 48250"
                  className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-[#F97316] text-sm"
                />
              </div>
            </>
          )}

          {/* ── Step 2: Checklist ── */}
          {step === 2 && (
            <div>
              <p className="text-xs text-gray-500 mb-4">Mark the condition of each item. Items marked Damaged or Needs Attention will prompt a damage report.</p>
              <div className="space-y-2">
                {checklist.map((c) => (
                  <div key={c.item} className="bg-[#162032] border border-white/5 rounded-xl p-3">
                    <div className="text-sm text-white mb-2 font-medium">{c.item}</div>
                    <div className="flex gap-2">
                      {STATUS_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => handleChecklistStatus(c.item, opt.value)}
                          className={`flex-1 py-1.5 px-1 rounded-lg border text-xs font-medium transition-all ${
                            c.status === opt.value
                              ? opt.color
                              : "border-white/10 bg-white/5 text-gray-500 hover:border-white/20"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {flaggedItems.length > 0 && (
                <div className="mt-4 flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <p className="text-xs text-amber-300">
                    {flaggedItems.length} item{flaggedItems.length > 1 ? "s" : ""} flagged — you'll be prompted to add damage details.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Damage Reports ── */}
          {step === 3 && totalSteps === 4 && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">Add details and photos for each damaged or flagged item.</p>
              {damageReports.map((report, idx) => (
                <div key={report.id} className="bg-[#162032] border border-white/10 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Report {idx + 1}</span>
                    <button onClick={() => removeReport(report.id)} className="text-gray-600 hover:text-red-400">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Location */}
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Location</label>
                    {flaggedItems.some((f) => f.item === report.location) ? (
                      <div className="text-sm text-white bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                        {report.location}
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={report.location}
                        onChange={(e) =>
                          setDamageReports((prev) =>
                            prev.map((r) => r.id === report.id ? { ...r, location: e.target.value } : r),
                          )
                        }
                        placeholder="e.g. Front Bumper"
                        className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
                      />
                    )}
                  </div>

                  {/* Description */}
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Description</label>
                    <textarea
                      value={report.description}
                      onChange={(e) =>
                        setDamageReports((prev) =>
                          prev.map((r) => r.id === report.id ? { ...r, description: e.target.value } : r),
                        )
                      }
                      placeholder="Describe the damage…"
                      rows={2}
                      className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316] resize-none"
                    />
                  </div>

                  {/* Photo */}
                  <div>
                    <label className="text-xs text-gray-400 block mb-2">Photo (optional)</label>
                    {report.photoPreview ? (
                      <div className="relative w-32 h-24">
                        <img src={report.photoPreview} alt="damage" className="w-32 h-24 object-cover rounded-lg" />
                        <button
                          onClick={() =>
                            setDamageReports((prev) =>
                              prev.map((r) => r.id === report.id ? { ...r, photoFile: null, photoPreview: null } : r),
                            )
                          }
                          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center"
                        >
                          <X className="w-3 h-3 text-white" />
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-400 cursor-pointer hover:border-white/30 w-fit">
                        <Camera className="w-4 h-4" />
                        Take / Upload Photo
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          ref={(el) => { fileInputRefs.current[report.id] = el; }}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handlePhotoSelect(report.id, file);
                          }}
                        />
                      </label>
                    )}
                    <p className="text-[11px] text-gray-600 mt-1">Photos are automatically deleted after 30 days.</p>
                  </div>
                </div>
              ))}

              <button
                onClick={addReport}
                className="flex items-center gap-2 text-sm text-[#F97316] hover:text-orange-400"
              >
                + Add Another Report
              </button>
            </div>
          )}

          {/* ── Step 3 or 4: Notes ── */}
          {((step === 3 && totalSteps === 3) || (step === 4 && totalSteps === 4)) && (
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold block mb-3">Additional Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any additional observations about the vehicle condition…"
                rows={5}
                className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#F97316] resize-none"
              />
              {error && (
                <div className="mt-4 flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                  <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer buttons */}
      <div className="bg-[#162032] border-t border-white/10 flex-shrink-0">
        <div className="max-w-2xl mx-auto px-4 py-4 flex gap-3">
          {step > 1 && (
            <button
              onClick={() => {
                if (step === 3 && totalSteps === 3) { setStep(2); return; }
                if (step === 3 && totalSteps === 4) { setStep(2); return; }
                if (step === 4) { setStep(3); return; }
                setStep((s) => s - 1);
              }}
              className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white px-4 py-3 rounded-xl text-sm font-medium"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
          )}
          {isLastStep ? (
            <button
              onClick={handleComplete}
              disabled={saving}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving…
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Complete Inspection
                </>
              )}
            </button>
          ) : (
            <button
              onClick={nextStep}
              className="flex-1 flex items-center justify-center gap-1.5 bg-[#F97316] hover:bg-[#ea6c0f] text-white py-3 rounded-xl text-sm font-semibold"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
