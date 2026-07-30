import { useEffect, useMemo, useState } from "react";
import {
  collection, doc, onSnapshot, orderBy, query, serverTimestamp, writeBatch,
} from "firebase/firestore";
import { Building2, Plus, Trash2, Pencil, X, Check, Crown, UserPlus, UserMinus } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { safeAddDoc, safeDeleteDoc } from "../../lib/firestoreWrite";
import { addStaffToDepartment, removeStaffFromDepartment, setDepartmentHead } from "../../lib/departments";
import { staffDisplayName } from "../../lib/jobTechnicians";
import type { Department, StaffMember } from "../../types/auth";
import { LoadingBlock } from "../../components/LoadingProgress";

export default function DepartmentsPage() {
  const { currentUser } = useAuth();
  const centerId = currentUser?.centerId ?? "";

  const canView = usePermission("departments.view");
  const canCreate = usePermission("departments.create");
  const canEdit = usePermission("departments.edit");
  const canDelete = usePermission("departments.delete");
  const canAssign = usePermission("departments.assignStaff");

  const [departments, setDepartments] = useState<Department[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addingStaffId, setAddingStaffId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(
      query(collection(db, "servicecenters", centerId, "departments"), orderBy("name")),
      (snap) => {
        setDepartments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Department)));
        setLoading(false);
      },
    );
  }, [centerId]);

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(
      query(collection(db, "servicecenters", centerId, "staff"), orderBy("fullName")),
      (snap) => setStaff(snap.docs.map((d) => ({ id: d.id, ...d.data() } as StaffMember))),
    );
  }, [centerId]);

  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  async function createDepartment() {
    const name = newName.trim();
    if (!name || !currentUser) return;
    setError("");
    try {
      await safeAddDoc(collection(db, "servicecenters", centerId, "departments"), {
        centerId,
        name,
        memberStaffIds: [],
        memberStaffNames: [],
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid,
        createdByName: currentUser.displayName ?? currentUser.email ?? "",
      });
      setNewName("");
      setCreating(false);
    } catch {
      setError("Failed to create the department");
    }
  }

  async function renameDepartment(dept: Department) {
    const name = editName.trim();
    if (!name) return;
    try {
      await writeBatch(db)
        .update(doc(db, "servicecenters", centerId, "departments", dept.id), {
          name,
          updatedAt: serverTimestamp(),
        })
        .commit();
      // Keep members' denormalised department name in step with the rename.
      if (dept.memberStaffIds.length > 0) {
        const batch = writeBatch(db);
        for (const staffId of dept.memberStaffIds) {
          batch.update(doc(db, "servicecenters", centerId, "staff", staffId), { departmentName: name });
        }
        await batch.commit();
      }
      setEditingId(null);
    } catch {
      setError("Failed to rename the department");
    }
  }

  async function deleteDepartment(dept: Department) {
    if (!confirm(`Delete "${dept.name}"? Its members will be unassigned.`)) return;
    try {
      if (dept.memberStaffIds.length > 0) {
        const batch = writeBatch(db);
        for (const staffId of dept.memberStaffIds) {
          batch.update(doc(db, "servicecenters", centerId, "staff", staffId), {
            departmentId: null,
            departmentName: null,
          });
        }
        await batch.commit();
      }
      await safeDeleteDoc(doc(db, "servicecenters", centerId, "departments", dept.id));
    } catch {
      setError("Failed to delete the department");
    }
  }

  if (!canView) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <Building2 className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to view Departments.</p>
        </div>
      </div>
    );
  }

  const availableStaff = (dept: Department) =>
    staff.filter((s) => s.active && !s.departmentId || staffById.get(s.id)?.departmentId === dept.id)
      .filter((s) => !dept.memberStaffIds.includes(s.id));

  return (
    <div className="min-h-screen bg-[#0B1120]">
      <PageHeader
        icon={<Building2 className="w-5 h-5" />}
        title="Departments"
        actions={
          canCreate && (
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 bg-[#F97316] hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
            >
              <Plus className="w-4 h-4" /> New Department
            </button>
          )
        }
      />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-4">
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-300 text-sm rounded-lg px-4 py-2.5">
            {error}
          </div>
        )}

        {creating && (
          <div className="bg-[#162032] border border-white/10 rounded-xl p-4 flex gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createDepartment()}
              placeholder="Department name — e.g. Engine, Body & Paint, Electrical"
              className="flex-1 bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
            />
            <button onClick={createDepartment} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm">
              Create
            </button>
            <button onClick={() => { setCreating(false); setNewName(""); }} className="text-gray-400 hover:text-white px-2 text-sm">
              Cancel
            </button>
          </div>
        )}

        {loading ? (
          <LoadingBlock />
        ) : departments.length === 0 ? (
          <div className="bg-[#162032] border border-white/10 rounded-xl p-10 text-center">
            <Building2 className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">No departments yet. Create one to start routing jobs by team.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {departments.map((dept) => {
              const isExpanded = expandedId === dept.id;
              return (
                <div key={dept.id} className="bg-[#162032] border border-white/10 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3">
                    {editingId === dept.id ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          autoFocus
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && renameDepartment(dept)}
                          className="flex-1 bg-white/5 border border-white/10 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-orange-500"
                        />
                        <button onClick={() => renameDepartment(dept)} className="text-green-400 hover:text-green-300">
                          <Check className="w-4 h-4" />
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-gray-500 hover:text-white">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : dept.id)}
                        className="flex items-center gap-2 flex-1 text-left"
                      >
                        <span className="text-white font-semibold">{dept.name}</span>
                        <span className="text-xs text-gray-500">
                          {dept.memberStaffIds.length} member{dept.memberStaffIds.length === 1 ? "" : "s"}
                          {dept.headStaffName ? ` · Head: ${dept.headStaffName}` : ""}
                        </span>
                      </button>
                    )}
                    {editingId !== dept.id && (
                      <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                        {canEdit && (
                          <button onClick={() => { setEditingId(dept.id); setEditName(dept.name); }} className="text-gray-500 hover:text-white">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button onClick={() => deleteDepartment(dept)} className="text-gray-500 hover:text-red-400">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="border-t border-white/10 px-4 py-3 space-y-3">
                      {dept.memberStaffIds.length > 0 && (
                        <div className="space-y-1.5">
                          {dept.memberStaffIds.map((sid, i) => {
                            const member = staffById.get(sid);
                            const isHead = dept.headStaffId === sid;
                            return (
                              <div key={sid} className="flex items-center justify-between text-sm bg-white/[0.03] rounded-lg px-3 py-2">
                                <div className="flex items-center gap-2">
                                  {isHead && <Crown className="w-3.5 h-3.5 text-amber-400" />}
                                  <span className="text-white">{dept.memberStaffNames[i] ?? member?.fullName ?? "—"}</span>
                                  {member?.role && <span className="text-xs text-gray-500">{member.role}</span>}
                                </div>
                                {canAssign && (
                                  <div className="flex items-center gap-3">
                                    {!isHead && (
                                      <button
                                        onClick={() => member && setDepartmentHead(db, centerId, dept, member)}
                                        className="text-xs text-gray-400 hover:text-amber-400"
                                      >
                                        Make head
                                      </button>
                                    )}
                                    {isHead && (
                                      <button
                                        onClick={() => setDepartmentHead(db, centerId, dept, null)}
                                        className="text-xs text-gray-400 hover:text-white"
                                      >
                                        Clear head
                                      </button>
                                    )}
                                    <button
                                      onClick={() => removeStaffFromDepartment(db, centerId, dept, sid)}
                                      className="text-gray-500 hover:text-red-400"
                                    >
                                      <UserMinus className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {canAssign && (
                        <div className="flex gap-2">
                          <select
                            value={addingStaffId}
                            onChange={(e) => setAddingStaffId(e.target.value)}
                            className="flex-1 bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                          >
                            <option value="">Add staff member…</option>
                            {availableStaff(dept).map((s) => (
                              <option key={s.id} value={s.id}>
                                {staffDisplayName(s)} ({s.role})
                              </option>
                            ))}
                          </select>
                          <button
                            disabled={!addingStaffId}
                            onClick={() => {
                              const s = staffById.get(addingStaffId);
                              if (s) { addStaffToDepartment(db, centerId, dept, s); setAddingStaffId(""); }
                            }}
                            className="flex items-center gap-1.5 bg-orange-500/10 hover:bg-orange-500/20 disabled:opacity-40 text-[#F97316] border border-orange-500/20 px-3 py-2 rounded-lg text-sm"
                          >
                            <UserPlus className="w-3.5 h-3.5" /> Add
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
