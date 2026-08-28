import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { safeSetDoc } from "../../lib/firestoreWrite";
import {
  ArrowLeft, Wallet, Plus, Trash2, Save, Loader2, Shield, Clock,
} from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type {
  OvertimeSettings, PayrollRoleDefaults, PayslipComponent, UserRole,
} from "../../types/auth";
import { LoadingBlock } from "../../components/LoadingProgress";
import { withOvertimeDefaults, overtimeHourlyRate } from "../../lib/overtime";

const ROLES: UserRole[] = ["Owner", "Manager", "Technician", "Cashier", "Receptionist"];

function emptyDefaults(role: UserRole, centerId: string): PayrollRoleDefaults {
  return { role, basicSalary: 0, commissionRate: undefined, allowances: [], deductions: [], centerId };
}

export default function PayrollSettingsPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const centerId = currentUser?.centerId ?? "";
  const canEdit = currentUser?.role === "Owner" || currentUser?.role === "Manager";

  const [defaultsByRole, setDefaultsByRole] = useState<Record<string, PayrollRoleDefaults>>({});
  const [loading, setLoading] = useState(true);
  const [activeRole, setActiveRole] = useState<UserRole>("Technician");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Shift & overtime policy — one document for the whole center, not per role.
  const [ot, setOt] = useState<OvertimeSettings>(() => withOvertimeDefaults(null));
  const [savingOt, setSavingOt] = useState(false);
  const [savedOt, setSavedOt] = useState(false);

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(collection(db, "servicecenters", centerId, "payrollRoleDefaults"), (snap) => {
      const byRole: Record<string, PayrollRoleDefaults> = {};
      snap.docs.forEach((d) => { byRole[d.id] = { ...(d.data() as PayrollRoleDefaults), role: d.id as UserRole }; });
      setDefaultsByRole(byRole);
      setLoading(false);
    }, () => setLoading(false));
  }, [centerId]);

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(
      doc(db, "servicecenters", centerId, "payrollSettings", "overtime"),
      (snap) => setOt(withOvertimeDefaults(snap.exists() ? (snap.data() as OvertimeSettings) : null)),
      () => {},
    );
  }, [centerId]);

  const current = defaultsByRole[activeRole] ?? emptyDefaults(activeRole, centerId);

  function updateOt(patch: Partial<OvertimeSettings>) {
    setOt((prev) => ({ ...prev, ...patch }));
    setSavedOt(false);
  }

  async function handleSaveOt() {
    if (!centerId || !canEdit) return;
    setSavingOt(true);
    try {
      await safeSetDoc(doc(db, "servicecenters", centerId, "payrollSettings", "overtime"), {
        ...ot,
        centerId,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.uid ?? "",
        updatedByName: currentUser?.displayName ?? currentUser?.email ?? "",
      });
      setSavedOt(true);
    } finally {
      setSavingOt(false);
    }
  }

  function updateCurrent(patch: Partial<PayrollRoleDefaults>) {
    setDefaultsByRole((prev) => ({
      ...prev,
      [activeRole]: { ...(prev[activeRole] ?? emptyDefaults(activeRole, centerId)), ...patch },
    }));
    setSaved(false);
  }

  function updateComponent(kind: "allowances" | "deductions", idx: number, patch: Partial<PayslipComponent>) {
    const list = [...(current[kind] ?? [])];
    list[idx] = { ...list[idx], ...patch };
    updateCurrent({ [kind]: list } as Partial<PayrollRoleDefaults>);
  }

  function addComponent(kind: "allowances" | "deductions") {
    updateCurrent({ [kind]: [...(current[kind] ?? []), { label: "", amount: 0 }] } as Partial<PayrollRoleDefaults>);
  }

  function removeComponent(kind: "allowances" | "deductions", idx: number) {
    updateCurrent({ [kind]: (current[kind] ?? []).filter((_, i) => i !== idx) } as Partial<PayrollRoleDefaults>);
  }

  async function handleSave() {
    if (!centerId || !canEdit) return;
    setSaving(true);
    try {
      await safeSetDoc(doc(db, "servicecenters", centerId, "payrollRoleDefaults", activeRole), {
        role: activeRole,
        basicSalary: current.basicSalary ?? 0,
        commissionRate: current.commissionRate ?? null,
        allowances: (current.allowances ?? []).filter((a) => a.label.trim()),
        deductions: (current.deductions ?? []).filter((d) => d.label.trim()),
        centerId,
        updatedByName: currentUser?.displayName ?? "",
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <Shield className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h3 className="text-white font-semibold mb-1">Access Denied</h3>
          <p className="text-gray-400 text-sm">Only an Owner or Manager can manage payroll defaults.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <div className="border-b border-white/10 bg-[#0B1120]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <button
            onClick={() => navigate("/employees")}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Wallet className="w-5 h-5 text-[#F97316]" /> Payroll Settings
            </h1>
            <p className="text-xs text-gray-500">Per-role salary defaults, plus the center's shift and overtime policy.</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {loading ? <LoadingBlock className="py-20" /> : (
          <>
            <div className="flex gap-1 bg-[#162032] border border-white/10 rounded-xl p-1 w-fit flex-wrap">
              {ROLES.map((role) => (
                <button
                  key={role}
                  onClick={() => setActiveRole(role)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                    activeRole === role ? "bg-[#F97316] text-white" : "text-gray-400 hover:text-white"
                  }`}
                >
                  {role}
                </button>
              ))}
            </div>

            <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400">Basic Salary (LKR)</label>
                  <input
                    type="number"
                    value={current.basicSalary ?? 0}
                    onChange={(e) => updateCurrent({ basicSalary: Number(e.target.value) })}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">Commission Rate (% of job revenue, optional)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={current.commissionRate ?? ""}
                    onChange={(e) => updateCurrent({ commissionRate: e.target.value === "" ? undefined : Number(e.target.value) })}
                    placeholder="e.g. 5"
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>

              <ComponentEditor
                title="Default Allowances"
                items={current.allowances ?? []}
                onAdd={() => addComponent("allowances")}
                onUpdate={(idx, patch) => updateComponent("allowances", idx, patch)}
                onRemove={(idx) => removeComponent("allowances", idx)}
              />

              <ComponentEditor
                title="Default Deductions"
                items={current.deductions ?? []}
                onAdd={() => addComponent("deductions")}
                onUpdate={(idx, patch) => updateComponent("deductions", idx, patch)}
                onRemove={(idx) => removeComponent("deductions", idx)}
              />

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 bg-[#F97316] hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? "Saving…" : `Save ${activeRole} Defaults`}
                </button>
                {saved && <span className="text-xs text-green-400">Saved.</span>}
              </div>
            </div>

            {/* ── Shift & Overtime ───────────────────────────────────────── */}
            <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 space-y-5">
              <div>
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#F97316]" /> Shift &amp; Overtime
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Applies to every employee. Attendance uses the shift to flag late arrivals, and
                  overtime past the shift end is calculated automatically onto each payslip.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-gray-400">Shift Start</label>
                  <input
                    type="time"
                    value={ot.shiftStart}
                    onChange={(e) => updateOt({ shiftStart: e.target.value })}
                    className={otInputClass}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">Shift End</label>
                  <input
                    type="time"
                    value={ot.shiftEnd}
                    onChange={(e) => updateOt({ shiftEnd: e.target.value })}
                    className={otInputClass}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">Late Grace (minutes)</label>
                  <input
                    type="number"
                    min={0}
                    value={ot.graceMinutes}
                    onChange={(e) => updateOt({ graceMinutes: Number(e.target.value) })}
                    className={otInputClass}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={ot.otEnabled}
                  onChange={(e) => updateOt({ otEnabled: e.target.checked })}
                  className="accent-orange-500"
                />
                Calculate overtime automatically
              </label>

              {ot.otEnabled && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-gray-400">Minimum OT (minutes)</label>
                      <input
                        type="number"
                        min={0}
                        value={ot.otMinimumMinutes}
                        onChange={(e) => updateOt({ otMinimumMinutes: Number(e.target.value) })}
                        className={otInputClass}
                      />
                      <p className="text-[11px] text-gray-600 mt-1">Anything shorter isn't counted as overtime.</p>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400">Round OT down to (minutes)</label>
                      <input
                        type="number"
                        min={0}
                        value={ot.otRoundingMinutes}
                        onChange={(e) => updateOt({ otRoundingMinutes: Number(e.target.value) })}
                        className={otInputClass}
                      />
                      <p className="text-[11px] text-gray-600 mt-1">0 keeps the exact minutes worked.</p>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-gray-400">OT Rate</label>
                    <div className="mt-1.5 flex gap-2">
                      {(["multiplier", "fixed"] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => updateOt({ otRateMode: mode })}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                            ot.otRateMode === mode ? "bg-[#F97316] text-white" : "bg-white/5 text-gray-400 hover:text-white"
                          }`}
                        >
                          {mode === "multiplier" ? "× normal hourly rate" : "Fixed rate per hour"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {ot.otRateMode === "fixed" ? (
                    <div className="sm:w-1/2">
                      <label className="text-xs text-gray-400">OT Rate (LKR per hour)</label>
                      <input
                        type="number"
                        min={0}
                        value={ot.otHourlyRate}
                        onChange={(e) => updateOt({ otHourlyRate: Number(e.target.value) })}
                        className={otInputClass}
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="text-xs text-gray-400">Multiplier</label>
                        <input
                          type="number"
                          step="0.1"
                          min={0}
                          value={ot.otMultiplier}
                          onChange={(e) => updateOt({ otMultiplier: Number(e.target.value) })}
                          className={otInputClass}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400">Working Days / Month</label>
                        <input
                          type="number"
                          min={1}
                          value={ot.standardDaysPerMonth}
                          onChange={(e) => updateOt({ standardDaysPerMonth: Number(e.target.value) })}
                          className={otInputClass}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400">Hours / Day</label>
                        <input
                          type="number"
                          min={1}
                          value={ot.standardHoursPerDay}
                          onChange={(e) => updateOt({ standardHoursPerDay: Number(e.target.value) })}
                          className={otInputClass}
                        />
                      </div>
                    </div>
                  )}

                  {/* Worked example against the role currently selected above, so
                      the multiplier settings aren't abstract. */}
                  <p className="text-xs text-gray-500">
                    At the {activeRole} basic salary of LKR {(current.basicSalary ?? 0).toLocaleString()},
                    one overtime hour is worth{" "}
                    <span className="text-orange-300 font-medium">
                      LKR {overtimeHourlyRate(ot, current.basicSalary ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>.
                  </p>
                </>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleSaveOt}
                  disabled={savingOt}
                  className="flex items-center gap-2 bg-[#F97316] hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition"
                >
                  {savingOt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {savingOt ? "Saving…" : "Save Shift & Overtime"}
                </button>
                {savedOt && <span className="text-xs text-green-400">Saved.</span>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const otInputClass =
  "mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500";

function ComponentEditor({
  title, items, onAdd, onUpdate, onRemove,
}: {
  title: string;
  items: PayslipComponent[];
  onAdd: () => void;
  onUpdate: (idx: number, patch: Partial<PayslipComponent>) => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <button
          onClick={onAdd}
          className="flex items-center gap-1 text-xs text-[#F97316] hover:text-orange-400"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-gray-500">None set.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                value={item.label}
                onChange={(e) => onUpdate(idx, { label: e.target.value })}
                placeholder="Label (e.g. Fuel Allowance)"
                className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              />
              <input
                type="number"
                value={item.amount}
                onChange={(e) => onUpdate(idx, { amount: Number(e.target.value) })}
                placeholder="Amount"
                className="w-32 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              />
              <button onClick={() => onRemove(idx)} className="text-gray-500 hover:text-red-400 p-1.5">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
