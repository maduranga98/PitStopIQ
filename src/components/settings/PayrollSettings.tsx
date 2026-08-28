import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, orderBy, query, serverTimestamp } from "firebase/firestore";
import { safeSetDoc } from "../../lib/firestoreWrite";
import {
  Plus, Trash2, Save, Loader2, Shield, Clock, Users, Wallet, Landmark, Search,
} from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type {
  EpfEtfSettings, OvertimeSettings, PayrollRoleDefaults, PayslipComponent,
  StaffMember, StaffPayrollProfile, UserRole,
} from "../../types/auth";
import { LoadingBlock } from "../LoadingProgress";
import { withOvertimeDefaults, overtimeHourlyRate } from "../../lib/overtime";
import {
  emptyProfile, epfEtfRef, payrollProfileRef, resolveEpfEtf, resolvePay,
  withEpfEtfDefaults,
} from "../../lib/payrollProfiles";

const ROLES: UserRole[] = ["Owner", "Manager", "Technician", "Cashier", "Receptionist"];

const inputClass =
  "mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500";

function emptyDefaults(role: UserRole, centerId: string): PayrollRoleDefaults {
  return { role, basicSalary: 0, commissionRate: undefined, allowances: [], deductions: [], centerId };
}

function lkr(n: number): string {
  return `LKR ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

type SectionId = "employees" | "roles" | "shift" | "epf";

const SECTIONS: { id: SectionId; label: string; icon: React.ElementType }[] = [
  { id: "employees", label: "Employees",       icon: Users },
  { id: "roles",     label: "Role Defaults",   icon: Wallet },
  { id: "shift",     label: "Shift & Overtime", icon: Clock },
  { id: "epf",       label: "EPF & ETF",       icon: Landmark },
];

/**
 * Everything that decides what an employee is paid, in one place: each
 * person's own salary and allowances, the role defaults a new person starts
 * from, the shift that drives lateness and overtime, and the statutory EPF/ETF
 * rates. Rendered both as a Settings tab and as the standalone Payroll page,
 * so there is only ever one copy of these controls.
 */
export default function PayrollSettings() {
  const { currentUser } = useAuth();
  const centerId = currentUser?.centerId ?? "";
  const canEdit = currentUser?.role === "Owner" || currentUser?.role === "Manager";

  const [section, setSection] = useState<SectionId>("employees");
  const [defaultsByRole, setDefaultsByRole] = useState<Record<string, PayrollRoleDefaults>>({});
  const [loading, setLoading] = useState(true);
  const [ot, setOt] = useState<OvertimeSettings>(() => withOvertimeDefaults(null));
  const [epf, setEpf] = useState<EpfEtfSettings>(() => withEpfEtfDefaults(null));

  useEffect(() => {
    if (!centerId) return;
    const unsubRoles = onSnapshot(
      collection(db, "servicecenters", centerId, "payrollRoleDefaults"),
      (snap) => {
        const byRole: Record<string, PayrollRoleDefaults> = {};
        snap.docs.forEach((d) => { byRole[d.id] = { ...(d.data() as PayrollRoleDefaults), role: d.id as UserRole }; });
        setDefaultsByRole(byRole);
        setLoading(false);
      },
      () => setLoading(false),
    );
    const unsubOt = onSnapshot(
      doc(db, "servicecenters", centerId, "payrollSettings", "overtime"),
      (snap) => setOt(withOvertimeDefaults(snap.exists() ? (snap.data() as OvertimeSettings) : null)),
      () => {},
    );
    const unsubEpf = onSnapshot(
      epfEtfRef(centerId),
      (snap) => setEpf(withEpfEtfDefaults(snap.exists() ? (snap.data() as EpfEtfSettings) : null)),
      () => {},
    );
    return () => { unsubRoles(); unsubOt(); unsubEpf(); };
  }, [centerId]);

  if (!canEdit) {
    return (
      <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm mx-auto text-center">
        <Shield className="w-10 h-10 text-gray-500 mx-auto mb-3" />
        <h3 className="text-white font-semibold mb-1">Access Denied</h3>
        <p className="text-gray-400 text-sm">Only an Owner or Manager can manage payroll.</p>
      </div>
    );
  }

  if (loading) return <LoadingBlock className="py-20" />;

  return (
    <div className="space-y-5">
      <div className="flex gap-1 bg-[#162032] border border-white/10 rounded-xl p-1 w-fit flex-wrap">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              section === id ? "bg-[#F97316] text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {section === "employees" && (
        <EmployeePaySection centerId={centerId} defaultsByRole={defaultsByRole} centerEpf={epf} />
      )}
      {section === "roles" && (
        <RoleDefaultsSection centerId={centerId} defaultsByRole={defaultsByRole} />
      )}
      {section === "shift" && (
        <ShiftOvertimeSection centerId={centerId} ot={ot} setOt={setOt} defaultsByRole={defaultsByRole} />
      )}
      {section === "epf" && <EpfEtfSection centerId={centerId} epf={epf} setEpf={setEpf} />}
    </div>
  );
}

// ── Employees ────────────────────────────────────────────────────────────────
// The list every workshop actually needs: who earns what. A role default is
// only a starting point — two technicians on the same role routinely earn
// differently, so each person's figures are edited here.

function EmployeePaySection({
  centerId, defaultsByRole, centerEpf,
}: {
  centerId: string;
  defaultsByRole: Record<string, PayrollRoleDefaults>;
  centerEpf: EpfEtfSettings;
}) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [profiles, setProfiles] = useState<Record<string, StaffPayrollProfile>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<StaffMember | null>(null);

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(
      query(collection(db, "servicecenters", centerId, "staff"), orderBy("fullName")),
      (snap) => {
        setStaff(snap.docs.map((d) => ({ id: d.id, ...d.data() } as StaffMember)).filter((s) => s.active));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [centerId]);

  // One listener per employee: the profiles live in a subcollection under each
  // staff document, which a single query can't span.
  useEffect(() => {
    if (!centerId || staff.length === 0) return;
    const unsubs = staff.map((s) =>
      onSnapshot(payrollProfileRef(centerId, s.id), (snap) => {
        setProfiles((prev) => {
          if (!snap.exists()) {
            if (!(s.id in prev)) return prev;
            const next = { ...prev };
            delete next[s.id];
            return next;
          }
          return { ...prev, [s.id]: snap.data() as StaffPayrollProfile };
        });
      }, () => {}),
    );
    return () => unsubs.forEach((u) => u());
  }, [centerId, staff]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter((s) =>
      s.fullName.toLowerCase().includes(q) ||
      s.role.toLowerCase().includes(q) ||
      (s.employeeId ?? "").toLowerCase().includes(q));
  }, [staff, search]);

  if (loading) return <LoadingBlock className="py-16" />;

  return (
    <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-white">Employee Pay</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Set each person's own basic salary, allowances and EPF/ETF. Anyone left on their role's
          defaults follows the Role Defaults tab instead.
        </p>
      </div>

      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search employees…"
          className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-500 py-8 text-center">No active employees.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[620px]">
            <thead>
              <tr className="border-b border-white/10 text-left">
                <th className="pb-3 text-xs font-medium text-gray-500 pr-4">Employee</th>
                <th className="pb-3 text-xs font-medium text-gray-500 pr-4">Role</th>
                <th className="pb-3 text-xs font-medium text-gray-500 pr-4 text-right">Basic Salary</th>
                <th className="pb-3 text-xs font-medium text-gray-500 pr-4 text-right">Allowances</th>
                <th className="pb-3 text-xs font-medium text-gray-500 pr-4">EPF / ETF</th>
                <th className="pb-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const profile = profiles[s.id];
                const pay = resolvePay(profile, defaultsByRole[s.role]);
                const epf = resolveEpfEtf(centerEpf, profile);
                const allowanceTotal = pay.allowances.reduce((sum, a) => sum + (a.amount || 0), 0);
                return (
                  <tr key={s.id} className="border-b border-white/5">
                    <td className="py-3 pr-4">
                      <div className="text-white font-medium">{s.fullName}</div>
                      {profile?.epfNumber && (
                        <div className="text-[11px] text-gray-600">EPF {profile.epfNumber}</div>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-gray-400">{s.customRoleName ?? s.role}</td>
                    <td className="py-3 pr-4 text-right text-white whitespace-nowrap">
                      {lkr(pay.basicSalary)}
                    </td>
                    <td className="py-3 pr-4 text-right text-gray-400 whitespace-nowrap">
                      {allowanceTotal > 0 ? lkr(allowanceTotal) : "—"}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">
                      {epf.enabled ? (
                        <span className="text-xs text-gray-400">
                          {epf.employeeEpfRate}% / {epf.employerEpfRate}% / {epf.etfRate}%
                        </span>
                      ) : (
                        <span className="text-xs text-gray-600">Exempt</span>
                      )}
                    </td>
                    <td className="py-3 text-right whitespace-nowrap">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full mr-2 ${
                        pay.fromProfile
                          ? "bg-[#F97316]/15 text-[#F97316] border border-[#F97316]/25"
                          : "bg-white/5 text-gray-500 border border-white/10"
                      }`}>
                        {pay.fromProfile ? "Custom" : "Role default"}
                      </span>
                      <button
                        onClick={() => setEditing(s)}
                        className="text-xs font-medium text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition"
                      >
                        Set Pay
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EmployeePayModal
          centerId={centerId}
          staff={editing}
          profile={profiles[editing.id] ?? null}
          roleDefaults={defaultsByRole[editing.role] ?? null}
          centerEpf={centerEpf}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function EmployeePayModal({
  centerId, staff, profile, roleDefaults, centerEpf, onClose,
}: {
  centerId: string;
  staff: StaffMember;
  profile: StaffPayrollProfile | null;
  roleDefaults: PayrollRoleDefaults | null;
  centerEpf: EpfEtfSettings;
  onClose: () => void;
}) {
  const { currentUser } = useAuth();
  const base = profile ?? emptyProfile(staff, centerId);
  const seeded = resolvePay(profile, roleDefaults);

  const [useRoleDefaults, setUseRoleDefaults] = useState(base.useRoleDefaults);
  const [basicSalary, setBasicSalary] = useState(seeded.basicSalary);
  const [commissionRate, setCommissionRate] = useState<number | undefined>(seeded.commissionRate);
  const [allowances, setAllowances] = useState<PayslipComponent[]>(seeded.allowances);
  const [deductions, setDeductions] = useState<PayslipComponent[]>(seeded.deductions);
  const [epfNumber, setEpfNumber] = useState(base.epfNumber ?? "");
  const [overrideEpf, setOverrideEpf] = useState(!!profile?.epfEtf);
  const [epf, setEpf] = useState<EpfEtfSettings>(() => resolveEpfEtf(centerEpf, profile));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const allowanceTotal = allowances.reduce((sum, a) => sum + (a.amount || 0), 0);
  const employeeEpf = epf.enabled ? (basicSalary * epf.employeeEpfRate) / 100 : 0;

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await safeSetDoc(payrollProfileRef(centerId, staff.id), {
        staffId: staff.id,
        staffName: staff.fullName,
        role: staff.role,
        useRoleDefaults,
        basicSalary,
        commissionRate: commissionRate ?? null,
        allowances: allowances.filter((a) => a.label.trim()),
        deductions: deductions.filter((d) => d.label.trim()),
        // Only stored when this person genuinely differs from the center —
        // otherwise they keep following the center-wide rates as those change.
        epfEtf: overrideEpf ? epf : null,
        epfNumber: epfNumber.trim() || null,
        centerId,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.uid ?? "",
        updatedByName: currentUser?.displayName ?? currentUser?.email ?? "",
      });
      onClose();
    } catch {
      setError("Couldn't save this employee's pay. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-white">{staff.fullName}</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {staff.customRoleName ?? staff.role}
            {staff.employeeId ? ` · ${staff.employeeId}` : ""}
          </p>
        </div>

        <div className="space-y-5">
          <label className="flex items-start gap-2.5 bg-[#0B1120] border border-white/5 rounded-xl px-4 py-3">
            <input
              type="checkbox"
              checked={useRoleDefaults}
              onChange={(e) => setUseRoleDefaults(e.target.checked)}
              className="accent-orange-500 mt-0.5"
            />
            <span className="text-sm text-gray-300">
              Follow the {staff.role} role defaults
              <span className="block text-xs text-gray-600 mt-0.5">
                Uncheck to set this person's own salary and allowances — the fields below then apply
                to them alone.
              </span>
            </span>
          </label>

          <fieldset disabled={useRoleDefaults} className={useRoleDefaults ? "opacity-50" : ""}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-400">Basic Salary (LKR)</label>
                <input
                  type="number"
                  min={0}
                  value={basicSalary}
                  onChange={(e) => setBasicSalary(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">Commission Rate (%, optional)</label>
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  value={commissionRate ?? ""}
                  onChange={(e) => setCommissionRate(e.target.value === "" ? undefined : Number(e.target.value))}
                  placeholder="e.g. 5"
                  className={inputClass}
                />
              </div>
            </div>

            <div className="mt-4 space-y-4">
              <ComponentEditor
                title="Allowances"
                items={allowances}
                onAdd={() => setAllowances((p) => [...p, { label: "", amount: 0 }])}
                onUpdate={(i, patch) => setAllowances((p) => p.map((x, j) => (i === j ? { ...x, ...patch } : x)))}
                onRemove={(i) => setAllowances((p) => p.filter((_, j) => j !== i))}
              />
              <ComponentEditor
                title="Standing Deductions"
                items={deductions}
                onAdd={() => setDeductions((p) => [...p, { label: "", amount: 0 }])}
                onUpdate={(i, patch) => setDeductions((p) => p.map((x, j) => (i === j ? { ...x, ...patch } : x)))}
                onRemove={(i) => setDeductions((p) => p.filter((_, j) => j !== i))}
              />
            </div>
          </fieldset>

          <div className="border-t border-white/10 pt-5 space-y-4">
            <div>
              <label className="text-xs text-gray-400">EPF Number (optional)</label>
              <input
                value={epfNumber}
                onChange={(e) => setEpfNumber(e.target.value)}
                placeholder="e.g. A/12345/67"
                className={inputClass}
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={overrideEpf}
                onChange={(e) => {
                  setOverrideEpf(e.target.checked);
                  if (!e.target.checked) setEpf(withEpfEtfDefaults(centerEpf));
                }}
                className="accent-orange-500"
              />
              Different EPF/ETF for this employee
            </label>

            {overrideEpf ? (
              <EpfEtfFields epf={epf} onChange={(patch) => setEpf((p) => ({ ...p, ...patch }))} />
            ) : (
              <p className="text-xs text-gray-500">
                Following the center rates: {centerEpf.enabled
                  ? `${centerEpf.employeeEpfRate}% employee EPF, ${centerEpf.employerEpfRate}% employer EPF, ${centerEpf.etfRate}% ETF on ${centerEpf.contributionBase === "gross" ? "gross pay" : "basic salary"}.`
                  : "EPF/ETF is switched off center-wide."}
              </p>
            )}
          </div>

          {/* What this adds up to, before commission and overtime */}
          <div className="bg-[#0B1120] border border-white/5 rounded-xl px-4 py-3 space-y-1 text-xs">
            <div className="flex justify-between text-gray-400">
              <span>Basic + allowances</span>
              <span>{lkr(basicSalary + allowanceTotal)}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Employee EPF deduction</span>
              <span>{epf.enabled ? `-${lkr(employeeEpf)}` : "—"}</span>
            </div>
            <p className="text-[11px] text-gray-600 pt-1">
              Commission, overtime and any advances are added when the payslip is generated.
            </p>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 rounded-lg transition text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-[#F97316] hover:bg-orange-600 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Role defaults ────────────────────────────────────────────────────────────

function RoleDefaultsSection({
  centerId, defaultsByRole,
}: {
  centerId: string;
  defaultsByRole: Record<string, PayrollRoleDefaults>;
}) {
  const { currentUser } = useAuth();
  const [activeRole, setActiveRole] = useState<UserRole>("Technician");
  const [draft, setDraft] = useState<Record<string, PayrollRoleDefaults>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const current = draft[activeRole] ?? defaultsByRole[activeRole] ?? emptyDefaults(activeRole, centerId);

  function update(patch: Partial<PayrollRoleDefaults>) {
    setDraft((prev) => ({ ...prev, [activeRole]: { ...current, ...patch } }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await safeSetDoc(doc(db, "servicecenters", centerId, "payrollRoleDefaults", activeRole), {
        role: activeRole,
        basicSalary: current.basicSalary ?? 0,
        commissionRate: current.commissionRate ?? null,
        allowances: (current.allowances ?? []).filter((a) => a.label.trim()),
        deductions: (current.deductions ?? []).filter((d) => d.label.trim()),
        centerId,
        updatedAt: serverTimestamp(),
        updatedByName: currentUser?.displayName ?? "",
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 space-y-5">
      <div>
        <h2 className="text-base font-semibold text-white">Role Defaults</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          What a new employee on this role starts from. Anyone given their own figures on the
          Employees tab ignores these.
        </p>
      </div>

      <div className="flex gap-1 bg-[#0B1120] border border-white/5 rounded-xl p-1 w-fit flex-wrap">
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-gray-400">Basic Salary (LKR)</label>
          <input
            type="number"
            value={current.basicSalary ?? 0}
            onChange={(e) => update({ basicSalary: Number(e.target.value) })}
            className={inputClass}
          />
        </div>
        <div>
          <label className="text-xs text-gray-400">Commission Rate (% of job revenue, optional)</label>
          <input
            type="number"
            step="0.1"
            value={current.commissionRate ?? ""}
            onChange={(e) => update({ commissionRate: e.target.value === "" ? undefined : Number(e.target.value) })}
            placeholder="e.g. 5"
            className={inputClass}
          />
        </div>
      </div>

      <ComponentEditor
        title="Default Allowances"
        items={current.allowances ?? []}
        onAdd={() => update({ allowances: [...(current.allowances ?? []), { label: "", amount: 0 }] })}
        onUpdate={(i, patch) => update({ allowances: (current.allowances ?? []).map((x, j) => (i === j ? { ...x, ...patch } : x)) })}
        onRemove={(i) => update({ allowances: (current.allowances ?? []).filter((_, j) => j !== i) })}
      />
      <ComponentEditor
        title="Default Deductions"
        items={current.deductions ?? []}
        onAdd={() => update({ deductions: [...(current.deductions ?? []), { label: "", amount: 0 }] })}
        onUpdate={(i, patch) => update({ deductions: (current.deductions ?? []).map((x, j) => (i === j ? { ...x, ...patch } : x)) })}
        onRemove={(i) => update({ deductions: (current.deductions ?? []).filter((_, j) => j !== i) })}
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
  );
}

// ── Shift & overtime ─────────────────────────────────────────────────────────

function ShiftOvertimeSection({
  centerId, ot, setOt, defaultsByRole,
}: {
  centerId: string;
  ot: OvertimeSettings;
  setOt: React.Dispatch<React.SetStateAction<OvertimeSettings>>;
  defaultsByRole: Record<string, PayrollRoleDefaults>;
}) {
  const { currentUser } = useAuth();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const sampleSalary = defaultsByRole.Technician?.basicSalary ?? 0;

  function update(patch: Partial<OvertimeSettings>) {
    setOt((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await safeSetDoc(doc(db, "servicecenters", centerId, "payrollSettings", "overtime"), {
        ...ot,
        centerId,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.uid ?? "",
        updatedByName: currentUser?.displayName ?? currentUser?.email ?? "",
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 space-y-5">
      <div>
        <h2 className="text-base font-semibold text-white">Shift &amp; Overtime</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Applies to every employee. Attendance uses the shift to flag late arrivals, and overtime
          past the shift end is calculated automatically onto each payslip.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="text-xs text-gray-400">Shift Start</label>
          <input type="time" value={ot.shiftStart} onChange={(e) => update({ shiftStart: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-gray-400">Shift End</label>
          <input type="time" value={ot.shiftEnd} onChange={(e) => update({ shiftEnd: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-gray-400">Late Grace (minutes)</label>
          <input type="number" min={0} value={ot.graceMinutes} onChange={(e) => update({ graceMinutes: Number(e.target.value) })} className={inputClass} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-300">
        <input type="checkbox" checked={ot.otEnabled} onChange={(e) => update({ otEnabled: e.target.checked })} className="accent-orange-500" />
        Calculate overtime automatically
      </label>

      {ot.otEnabled && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400">Minimum OT (minutes)</label>
              <input type="number" min={0} value={ot.otMinimumMinutes} onChange={(e) => update({ otMinimumMinutes: Number(e.target.value) })} className={inputClass} />
              <p className="text-[11px] text-gray-600 mt-1">Anything shorter isn't counted as overtime.</p>
            </div>
            <div>
              <label className="text-xs text-gray-400">Round OT down to (minutes)</label>
              <input type="number" min={0} value={ot.otRoundingMinutes} onChange={(e) => update({ otRoundingMinutes: Number(e.target.value) })} className={inputClass} />
              <p className="text-[11px] text-gray-600 mt-1">0 keeps the exact minutes worked.</p>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-400">OT Rate</label>
            <div className="mt-1.5 flex gap-2 flex-wrap">
              {(["multiplier", "fixed"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => update({ otRateMode: mode })}
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
              <input type="number" min={0} value={ot.otHourlyRate} onChange={(e) => update({ otHourlyRate: Number(e.target.value) })} className={inputClass} />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-gray-400">Multiplier</label>
                <input type="number" step="0.1" min={0} value={ot.otMultiplier} onChange={(e) => update({ otMultiplier: Number(e.target.value) })} className={inputClass} />
              </div>
              <div>
                <label className="text-xs text-gray-400">Working Days / Month</label>
                <input type="number" min={1} value={ot.standardDaysPerMonth} onChange={(e) => update({ standardDaysPerMonth: Number(e.target.value) })} className={inputClass} />
              </div>
              <div>
                <label className="text-xs text-gray-400">Hours / Day</label>
                <input type="number" min={1} value={ot.standardHoursPerDay} onChange={(e) => update({ standardHoursPerDay: Number(e.target.value) })} className={inputClass} />
              </div>
            </div>
          )}

          {/* Worked example, so the multiplier settings aren't abstract. Each
              employee's own OT rate follows their own basic salary. */}
          <p className="text-xs text-gray-500">
            At the Technician default salary of {lkr(sampleSalary)}, one overtime hour is worth{" "}
            <span className="text-orange-300 font-medium">{lkr(overtimeHourlyRate(ot, sampleSalary))}</span>.
          </p>
        </>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-[#F97316] hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? "Saving…" : "Save Shift & Overtime"}
        </button>
        {saved && <span className="text-xs text-green-400">Saved.</span>}
      </div>
    </div>
  );
}

// ── EPF / ETF ────────────────────────────────────────────────────────────────

function EpfEtfSection({
  centerId, epf, setEpf,
}: {
  centerId: string;
  epf: EpfEtfSettings;
  setEpf: React.Dispatch<React.SetStateAction<EpfEtfSettings>>;
}) {
  const { currentUser } = useAuth();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function update(patch: Partial<EpfEtfSettings>) {
    setEpf((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await safeSetDoc(epfEtfRef(centerId), {
        ...epf,
        centerId,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.uid ?? "",
        updatedByName: currentUser?.displayName ?? currentUser?.email ?? "",
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 space-y-5">
      <div>
        <h2 className="text-base font-semibold text-white">EPF &amp; ETF</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          The center's default statutory rates. Employee EPF is deducted from pay; employer EPF and
          ETF are the workshop's own cost and appear separately on the payslip. Any employee can be
          given different rates, or exempted, on the Employees tab.
        </p>
      </div>

      <EpfEtfFields epf={epf} onChange={update} />

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-[#F97316] hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? "Saving…" : "Save EPF & ETF"}
        </button>
        {saved && <span className="text-xs text-green-400">Saved.</span>}
      </div>
    </div>
  );
}

/** The EPF/ETF fields, shared by the center-wide setting and the per-employee override. */
function EpfEtfFields({
  epf, onChange,
}: {
  epf: EpfEtfSettings;
  onChange: (patch: Partial<EpfEtfSettings>) => void;
}) {
  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm text-gray-300">
        <input
          type="checkbox"
          checked={epf.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
          className="accent-orange-500"
        />
        Deduct and contribute EPF / ETF
      </label>

      {epf.enabled && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-gray-400">Employee EPF (%)</label>
              <input
                type="number" step="0.5" min={0}
                value={epf.employeeEpfRate}
                onChange={(e) => onChange({ employeeEpfRate: Number(e.target.value) })}
                className={inputClass}
              />
              <p className="text-[11px] text-gray-600 mt-1">Standard 8% — deducted from pay.</p>
            </div>
            <div>
              <label className="text-xs text-gray-400">Employer EPF (%)</label>
              <input
                type="number" step="0.5" min={0}
                value={epf.employerEpfRate}
                onChange={(e) => onChange({ employerEpfRate: Number(e.target.value) })}
                className={inputClass}
              />
              <p className="text-[11px] text-gray-600 mt-1">Standard 12% — paid on top.</p>
            </div>
            <div>
              <label className="text-xs text-gray-400">ETF (%)</label>
              <input
                type="number" step="0.5" min={0}
                value={epf.etfRate}
                onChange={(e) => onChange({ etfRate: Number(e.target.value) })}
                className={inputClass}
              />
              <p className="text-[11px] text-gray-600 mt-1">Standard 3% — employer only.</p>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-400">Contributions calculated on</label>
            <div className="mt-1.5 flex gap-2 flex-wrap">
              {([
                { id: "basic" as const, label: "Basic salary" },
                { id: "gross" as const, label: "Gross pay (incl. OT & allowances)" },
              ]).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => onChange({ contributionBase: opt.id })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    epf.contributionBase === opt.id ? "bg-[#F97316] text-white" : "bg-white/5 text-gray-400 hover:text-white"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Shared ───────────────────────────────────────────────────────────────────

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
        <button onClick={onAdd} type="button" className="flex items-center gap-1 text-xs text-[#F97316] hover:text-orange-400">
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
              <button onClick={() => onRemove(idx)} type="button" className="text-gray-500 hover:text-red-400 p-1.5">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
