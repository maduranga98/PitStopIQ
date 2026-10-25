// A post-service checklist filled in with no job card behind it — any vehicle,
// any time. The same page opens an existing record: a draft to carry on with,
// or a signed-off report (read-only, frozen by the security rules).
//
// Nothing is written until the first save, so opening the form and walking away
// leaves no record behind.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ClipboardCheck, Loader2, Lock, Trash2 } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import ChecklistFillForm from "../../components/checklist/ChecklistFillForm";
import { useAuth } from "../../contexts/AuthContext";
import { fetchActiveStaff, fetchCustomers, fetchVehiclesForCustomer } from "../../lib/refData";
import { toIsoDate } from "../../lib/scheduling";
import {
  canCompleteChecklist, canReassignChecklist, canCompleteTemplate, chooseTemplate,
  eligibleTemplates, fetchActiveTemplates,
} from "../../lib/postServiceChecklist";
import {
  completeStandalone, createStandalone, deleteStandalone, fetchStandalone, newStandaloneId,
  reassignStandalone, saveStandalone, startingSections,
} from "../../lib/standaloneChecklists";
import {
  allRated, filledSectionsOf, headerError, ratedProgress, type StandaloneHeaderInput,
} from "../../lib/checklistFill";
import type {
  Customer, FilledChecklistSection, PostServiceChecklistTemplate, StaffMember,
  StandalonePostServiceChecklist, Vehicle,
} from "../../types/auth";

const fieldClass =
  "w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 disabled:opacity-50";
const labelClass = "text-xs text-gray-400 uppercase tracking-wider font-semibold";

export default function PostServiceChecklistFormPage() {
  const { id } = useParams();
  const { currentUser } = useAuth();
  const centerId = currentUser?.centerId;
  const navigate = useNavigate();
  const isNew = !id;
  const user = useMemo(() => ({ uid: currentUser?.uid, role: currentUser?.role }), [currentUser?.uid, currentUser?.role]);

  // Generated once, so the first save and every later one address the same document.
  const [newId] = useState(() => (centerId ? newStandaloneId(centerId) : ""));
  const recordId = id ?? newId;

  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState<StandalonePostServiceChecklist | null>(null);
  const [persisted, setPersisted] = useState(!isNew);
  const [templates, setTemplates] = useState<PostServiceChecklistTemplate[]>([]);
  const [template, setTemplate] = useState<PostServiceChecklistTemplate | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadedVehicles, setVehicles] = useState<Vehicle[]>([]);

  const [header, setHeader] = useState<StandaloneHeaderInput>({
    customerId: null, customerNameManual: "", vehicleId: null, plateNumberManual: "", mileage: "",
  });
  const [customerQuery, setCustomerQuery] = useState("");
  const [date, setDate] = useState(() => toIsoDate(new Date()));
  const [sections, setSections] = useState<FilledChecklistSection[]>([]);
  const [remarks, setRemarks] = useState("");

  const [busy, setBusy] = useState<"" | "save" | "complete" | "delete">("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!centerId) return;
    let live = true;
    (async () => {
      try {
        const [tpls, people, existing] = await Promise.all([
          fetchActiveTemplates(centerId),
          fetchActiveStaff(centerId).catch(() => [] as StaffMember[]),
          id ? fetchStandalone(centerId, id) : Promise.resolve(null),
        ]);
        if (!live) return;
        setTemplates(tpls);
        setStaff(people);
        if (existing) {
          setRecord(existing);
          setSections(filledSectionsOf(existing));
          setRemarks(existing.remarks ?? "");
          setHeader({
            customerId: existing.customerId, customerNameManual: existing.customerNameManual ?? "",
            vehicleId: existing.vehicleId, plateNumberManual: existing.plateNumberManual ?? "",
            mileage: existing.mileage != null ? String(existing.mileage) : "",
          });
          setDate(toIsoDate(existing.date.toDate()));
        } else if (id) {
          setError("That checklist couldn't be found.");
        } else {
          const chosen = chooseTemplate(tpls, user.role);
          setTemplate(chosen);
          if (chosen) setSections(startingSections(chosen));
        }
      } catch {
        if (live) setError("Couldn't load the checklist. Check your connection and try again.");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [centerId, id, user.role]);

  // Customers are only needed while the header can still change.
  const completed = !!record?.completedAt;
  useEffect(() => {
    if (!centerId || completed) return;
    fetchCustomers(centerId).then(setCustomers).catch(() => {});
  }, [centerId, completed]);

  useEffect(() => {
    if (!centerId || !header.customerId) return;
    let live = true;
    fetchVehiclesForCustomer(centerId, header.customerId).then((v) => live && setVehicles(v)).catch(() => {});
    return () => { live = false; };
  }, [centerId, header.customerId]);

  // Only the picked customer's vehicles are offered; with none picked, none are.
  const vehicles = header.customerId ? loadedVehicles : [];

  // ── Permissions ───────────────────────────────────────────────────────────
  const eligible = useMemo(() => eligibleTemplates(templates, user.role), [templates, user.role]);
  const snapshot = record ?? (template ? { allowedRoles: template.allowedRoles, assignedTo: template.defaultAssignee ?? null } : null);
  const mayFill = !completed && !!snapshot && canCompleteChecklist(snapshot, user);
  const canReassign = persisted && !completed && canReassignChecklist(user.role);
  const assignable = staff.filter((s) => s.active !== false && canCompleteTemplate({ allowedRoles: snapshot?.allowedRoles ?? [] }, s.role));
  const canDelete = persisted && user.role === "Owner" && !record?.sentToCustomer;

  const anyRated = ratedProgress(sections).done > 0;
  const problem = headerError(header);
  const { done, total } = ratedProgress(sections);
  const ready = allRated(sections) && !problem;

  const content = () => ({ header, date: new Date(`${date}T00:00:00`), sections, remarks });

  // ── Actions ───────────────────────────────────────────────────────────────
  async function persist(): Promise<void> {
    if (!centerId || !user.uid) return;
    if (persisted) {
      await saveStandalone(centerId, recordId, content());
    } else if (template) {
      await createStandalone(centerId, recordId, template, user.uid, content());
      setPersisted(true);
    }
  }

  async function handleSave() {
    if (busy) return;
    if (problem) { setError(problem); return; }
    setBusy("save"); setError("");
    try {
      await persist();
      navigate("/post-service-checklists");
    } catch {
      setError("Couldn't save the checklist. Check your connection and try again.");
      setBusy("");
    }
  }

  async function handleComplete() {
    if (busy || !ready || !centerId || !user.uid) return;
    setBusy("complete"); setError("");
    try {
      await persist();
      await completeStandalone(centerId, recordId, content(), user.uid);
      navigate("/post-service-checklists");
    } catch {
      setError("Couldn't sign off the checklist. Check your connection and try again.");
      setBusy("");
    }
  }

  async function handleDelete() {
    if (!centerId || busy) return;
    setBusy("delete"); setError("");
    try {
      await deleteStandalone(centerId, recordId);
      navigate("/post-service-checklists");
    } catch {
      setError("Couldn't delete the checklist. Check your connection and try again.");
      setBusy(""); setConfirmDelete(false);
    }
  }

  async function handleReassign(uid: string) {
    if (!centerId || !record) return;
    const previous = record.assignedTo;
    setRecord({ ...record, assignedTo: uid || null });
    try { await reassignStandalone(centerId, recordId, uid || null); }
    catch { setRecord({ ...record, assignedTo: previous }); setError("Couldn't reassign the checklist."); }
  }

  function pickTemplate(templateId: string) {
    const t = eligible.find((x) => x.id === templateId) ?? null;
    setTemplate(t);
    setSections(t ? startingSections(t) : []);
  }

  const matches = customerQuery.trim()
    ? customers.filter((c) => c.name.toLowerCase().includes(customerQuery.trim().toLowerCase()) || c.phone.includes(customerQuery.trim())).slice(0, 6)
    : [];
  const pickedCustomer = customers.find((c) => c.id === header.customerId);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center text-gray-500 text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }

  const noTemplate = isNew && !template;
  const subject = completed ? "Signed-off report" : isNew ? "New checklist" : "Checklist";

  return (
    <div className="min-h-screen bg-[#0B1120]">
      <PageHeader
        icon={<ClipboardCheck className="w-5 h-5" />}
        title={subject}
        actions={
          <button
            onClick={() => navigate("/post-service-checklists")}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4" /> All checklists
          </button>
        }
      />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {error && !record && !isNew && <p className="text-sm text-red-400">{error}</p>}

        {noTemplate && (
          <div className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
            {templates.length === 0
              ? "No active checklist is set up yet. The Owner can add one in Settings → Services & Modules → Post-Service Checklist."
              : eligible.length === 0
                ? "None of the active checklists names your role. Ask the Owner or a Manager."
                : "Pick which checklist to fill in."}
            {eligible.length > 1 && (
              <select
                value=""
                onChange={(e) => pickTemplate(e.target.value)}
                className={`${fieldClass} mt-3 [&>option]:bg-[#0B1120]`}
                aria-label="Checklist"
              >
                <option value="" disabled>Choose…</option>
                {eligible.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </div>
        )}

        {(record || template) && (
          <>
            {/* ── Header: what this was done on ── */}
            <section className="bg-[#162032] border border-white/10 rounded-2xl p-4 sm:p-5 space-y-4" aria-label="Vehicle and customer">
              <div className="flex items-center justify-between gap-3">
                <h2 className={labelClass}>{record?.templateName ?? template?.name}</h2>
                {isNew && !persisted && eligible.length > 1 && (
                  <select
                    value={template?.id ?? ""}
                    onChange={(e) => !anyRated && pickTemplate(e.target.value)}
                    disabled={anyRated}
                    aria-label="Checklist"
                    title={anyRated ? "Clear the ratings to switch checklist" : undefined}
                    className="bg-[#0B1120] border border-white/10 text-white rounded-lg px-2 py-1.5 text-xs disabled:opacity-40 [&>option]:bg-[#0B1120]"
                  >
                    {eligible.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}
              </div>

              {completed ? (
                <ReadOnlyHeader record={record!} customers={customers} staff={staff} />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Customer: on file, or typed in */}
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className={labelClass} htmlFor="cust">Customer <span className="text-gray-600 normal-case tracking-normal">(optional)</span></label>
                    {header.customerId ? (
                      <div className="flex items-center justify-between gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
                        <span className="truncate">{pickedCustomer ? `${pickedCustomer.name} · ${pickedCustomer.phone}` : "Customer on file"}</span>
                        <button
                          type="button"
                          disabled={!mayFill}
                          onClick={() => setHeader((h) => ({ ...h, customerId: null, vehicleId: null }))}
                          className="text-xs text-orange-400 hover:text-orange-300 disabled:opacity-40"
                        >Change</button>
                      </div>
                    ) : (
                      <>
                        <input
                          id="cust"
                          value={customerQuery || header.customerNameManual}
                          onChange={(e) => { setCustomerQuery(e.target.value); setHeader((h) => ({ ...h, customerNameManual: e.target.value })); }}
                          disabled={!mayFill}
                          placeholder="Search customers, or type a name"
                          className={fieldClass}
                        />
                        {matches.length > 0 && (
                          <div className="border border-white/10 rounded-lg divide-y divide-white/5 overflow-hidden">
                            {matches.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => { setHeader((h) => ({ ...h, customerId: c.id, customerNameManual: "" })); setCustomerQuery(""); }}
                                className="w-full text-left px-3 py-2 text-sm text-white hover:bg-white/5 flex justify-between gap-2"
                              >
                                <span className="truncate">{c.name}</span><span className="text-gray-500">{c.phone}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Vehicle: one of the customer's, or a typed plate */}
                  <div className="space-y-1.5">
                    <label className={labelClass} htmlFor="plate">Vehicle</label>
                    {vehicles.length > 0 && (
                      <select
                        value={header.vehicleId ?? ""}
                        onChange={(e) => setHeader((h) => ({ ...h, vehicleId: e.target.value || null }))}
                        disabled={!mayFill}
                        aria-label="Vehicle on file"
                        className={`${fieldClass} [&>option]:bg-[#0B1120]`}
                      >
                        <option value="">Other — type the plate</option>
                        {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plateNumber}{v.make ? ` · ${v.make} ${v.model ?? ""}` : ""}</option>)}
                      </select>
                    )}
                    {!header.vehicleId && (
                      <input
                        id="plate"
                        value={header.plateNumberManual}
                        onChange={(e) => setHeader((h) => ({ ...h, plateNumberManual: e.target.value }))}
                        disabled={!mayFill}
                        maxLength={20}
                        placeholder="CAI 5598"
                        className={`${fieldClass} uppercase`}
                      />
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className={labelClass} htmlFor="date">Date</label>
                      <input id="date" type="date" value={date} max={toIsoDate(new Date())} onChange={(e) => e.target.value && setDate(e.target.value)} disabled={!mayFill} className={fieldClass} />
                    </div>
                    <div className="space-y-1.5">
                      <label className={labelClass} htmlFor="km">Mileage <span className="text-gray-600 normal-case tracking-normal">(km)</span></label>
                      <input id="km" inputMode="numeric" value={header.mileage} onChange={(e) => setHeader((h) => ({ ...h, mileage: e.target.value }))} disabled={!mayFill} placeholder="Optional" className={fieldClass} />
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* ── The checks ── */}
            {!completed && (
              <div className="flex items-center gap-3">
                <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-[#F97316] transition-all duration-200" style={{ width: total ? `${(done / total) * 100}%` : "0%" }} />
                </div>
                <span className="text-xs text-gray-400 tabular-nums">{done}/{total}</span>
              </div>
            )}

            <ChecklistFillForm
              sections={sections}
              onChange={setSections}
              remarks={remarks}
              onRemarksChange={setRemarks}
              readOnly={completed}
              disabled={!mayFill || !!busy}
            />

            {!completed && !mayFill && snapshot && (
              <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  {snapshot.assignedTo
                    ? "This checklist is assigned to someone else."
                    : `Only ${[...new Set([...snapshot.allowedRoles, "Owner", "Manager"])].join(", ")} can fill this in.`}
                </span>
              </div>
            )}

            {canReassign && (
              <div className="space-y-1.5">
                <label className={labelClass} htmlFor="assignee">Assigned to</label>
                <select id="assignee" value={record?.assignedTo ?? ""} onChange={(e) => handleReassign(e.target.value)} className={`${fieldClass} [&>option]:bg-[#0B1120]`}>
                  <option value="">Anyone who can complete it</option>
                  {assignable.map((s) => <option key={s.id} value={s.id}>{s.fullName || s.displayName || s.email}</option>)}
                </select>
              </div>
            )}

            {error && (record || isNew) && <p className="text-xs text-red-400">{error}</p>}
            {!completed && problem && anyRated && <p className="text-xs text-amber-400">{problem}</p>}

            <div className="flex items-center justify-between gap-3 pb-8">
              <div>
                {canDelete && (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    disabled={!!busy}
                    className="text-sm text-red-400 hover:text-red-300 flex items-center gap-1.5 disabled:opacity-40"
                  >
                    <Trash2 className="w-4 h-4" /> Delete
                  </button>
                )}
                {completed && record?.sentToCustomer && (
                  <span className="text-xs text-gray-500 flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Sent to the customer — can't be deleted</span>
                )}
              </div>
              {!completed && mayFill && (
                <div className="flex items-center gap-2">
                  <button onClick={handleSave} disabled={!!busy || (!persisted && !anyRated && !header.plateNumberManual && !header.vehicleId)} className="text-sm text-gray-300 hover:text-white px-4 py-2 disabled:opacity-40">
                    {busy === "save" ? "Saving…" : "Save draft"}
                  </button>
                  <button onClick={handleComplete} disabled={!ready || !!busy} className="bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-2">
                    {busy === "complete" && <Loader2 className="w-4 h-4 animate-spin" />}
                    Complete &amp; sign off
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmDelete(false)} />
          <div className="relative bg-[#162032] border border-white/10 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-semibold text-white">Delete this checklist?</h3>
            <p className="text-sm text-gray-400">It's removed for good. A checklist that has been sent to the customer can't be deleted.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(false)} className="text-sm text-gray-400 hover:text-white px-4 py-2">Cancel</button>
              <button onClick={handleDelete} disabled={!!busy} className="bg-red-500/90 hover:bg-red-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReadOnlyHeader({ record, customers, staff }: {
  record: StandalonePostServiceChecklist; customers: Customer[]; staff: StaffMember[];
}) {
  const customer = customers.find((c) => c.id === record.customerId);
  const signer = staff.find((s) => s.id === record.completedBy);
  const at = record.completedAt?.toDate?.();
  const rows: [string, string][] = [
    ["Vehicle", record.plateNumberManual || "On file"],
    ["Customer", record.customerNameManual || customer?.name || (record.customerId ? "On file" : "—")],
    ["Date", record.date.toDate().toLocaleDateString()],
    ["Mileage", record.mileage != null ? `${record.mileage.toLocaleString()} km` : "—"],
    ["Signed off by", `${signer?.fullName || signer?.displayName || "Staff"}${at ? ` · ${at.toLocaleString()}` : ""}`],
  ];
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 sm:block">
          <dt className="text-xs text-gray-500">{k}</dt>
          <dd className="text-white">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
