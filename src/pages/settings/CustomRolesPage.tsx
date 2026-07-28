import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, doc, onSnapshot, query, where, getDocs, Timestamp,
} from "firebase/firestore";
import { safeAddDoc, safeUpdateDoc, safeDeleteDoc } from "../../lib/firestoreWrite";
import {
  ArrowLeft, Plus, Shield, Users2, Edit2, Trash2, Save, Loader2, AlertTriangle,
} from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { DEFAULT_PERMISSIONS } from "../../lib/defaultPermissions";
import { PermissionsGrid } from "../../components/settings/PermissionsEditor";
import type { CustomRole, RolePermissions, StaffRoleKey } from "../../types/permissions";
import { LoadingBlock } from "../../components/LoadingProgress";

const BASE_ROLE_OPTIONS: { key: StaffRoleKey; label: string }[] = [
  { key: "manager",      label: "Manager" },
  { key: "technician",   label: "Technician" },
  { key: "cashier",      label: "Cashier" },
  { key: "receptionist", label: "Receptionist" },
];

const BASE_ROLE_LABEL: Record<StaffRoleKey, string> = {
  manager: "Manager", technician: "Technician", cashier: "Cashier", receptionist: "Receptionist",
};

function setValueAtKey(perms: RolePermissions, key: string, value: boolean): RolePermissions {
  const [section, field] = key.split(".");
  if (!section || !field) return perms;
  return {
    ...perms,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [section]: { ...(perms as any)[section], [field]: value },
  } as RolePermissions;
}

export default function CustomRolesPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const centerId = currentUser?.centerId ?? "";
  const isOwner = currentUser?.role === "Owner";
  const isPro = currentUser?.centerPlan === "pro";

  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CustomRole | "new" | null>(null);
  const [staffCounts, setStaffCounts] = useState<Record<string, number>>({});
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    if (!centerId || !isPro) { setLoading(false); return; }
    return onSnapshot(
      collection(db, "servicecenters", centerId, "customRoles"),
      snap => {
        setRoles(snap.docs.map(d => ({ id: d.id, ...d.data() } as CustomRole)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [centerId, isPro]);

  async function handleDelete(role: CustomRole) {
    setDeleteError("");
    const inUse = await getDocs(
      query(collection(db, "servicecenters", centerId, "staff"), where("customRoleId", "==", role.id)),
    );
    if (!inUse.empty) {
      setStaffCounts(prev => ({ ...prev, [role.id]: inUse.size }));
      setDeleteError(`${inUse.size} employee${inUse.size === 1 ? "" : "s"} still ${inUse.size === 1 ? "has" : "have"} "${role.name}" assigned. Reassign them first.`);
      return;
    }
    if (!window.confirm(`Delete the "${role.name}" role? This cannot be undone.`)) return;
    await safeDeleteDoc(doc(db, "servicecenters", centerId, "customRoles", role.id));
  }

  if (!isPro) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <Shield className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h3 className="text-white font-semibold mb-1">Pro plan required</h3>
          <p className="text-gray-400 text-sm">Custom roles are available on the Pro plan.</p>
        </div>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <Shield className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h3 className="text-white font-semibold mb-1">Access Denied</h3>
          <p className="text-gray-400 text-sm">Only the account Owner can manage custom roles.</p>
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <CustomRoleEditor
        centerId={centerId}
        role={editing === "new" ? null : editing}
        existingNames={roles.filter(r => r.id !== (editing === "new" ? "" : editing.id)).map(r => r.name.toLowerCase())}
        onClose={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <div className="border-b border-white/10 bg-[#0B1120]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <button
            onClick={() => navigate("/settings?tab=rolePermissions")}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Users2 className="w-5 h-5 text-[#F97316]" />
          <h1 className="text-xl font-bold">Custom Roles</h1>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm text-gray-400 max-w-md">
            Create named roles with their own feature set, e.g. "Senior Technician" or "Front Desk Lead",
            and assign them to employees instead of the four built-in roles.
          </p>
          <button
            onClick={() => setEditing("new")}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#F97316] hover:bg-[#EA6C10] text-white rounded-xl transition-colors flex-shrink-0"
          >
            <Plus className="w-4 h-4" />
            New Role
          </button>
        </div>

        {deleteError && (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{deleteError}</p>
          </div>
        )}

        {loading ? (
          <LoadingBlock className="py-12" />
        ) : roles.length === 0 ? (
          <div className="text-center py-16 bg-[#162032] border border-white/10 rounded-2xl">
            <Users2 className="w-10 h-10 mx-auto mb-3 text-gray-600" />
            <p className="text-sm text-gray-400">No custom roles yet</p>
            <p className="text-xs text-gray-600 mt-1">Create one to fine-tune what a group of employees can access.</p>
          </div>
        ) : (
          <div className="bg-[#162032] border border-white/10 rounded-2xl overflow-hidden divide-y divide-white/5">
            {roles.map(role => (
              <div key={role.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-white truncate">{role.name}</p>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-gray-400 border border-white/10">
                      Based on {BASE_ROLE_LABEL[role.baseRole]}
                    </span>
                  </div>
                  {staffCounts[role.id] !== undefined && (
                    <p className="text-xs text-gray-500 mt-1">{staffCounts[role.id]} employee(s) assigned</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => setEditing(role)}
                    className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title="Edit"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(role)}
                    className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CustomRoleEditor({
  centerId, role, existingNames, onClose,
}: {
  centerId: string;
  role: CustomRole | null;
  existingNames: string[];
  onClose: () => void;
}) {
  const isEdit = Boolean(role);
  const [name, setName] = useState(role?.name ?? "");
  const [baseRole, setBaseRole] = useState<StaffRoleKey>(role?.baseRole ?? "technician");
  const [perms, setPerms] = useState<RolePermissions>(role?.permissions ?? DEFAULT_PERMISSIONS.technician);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function handleBaseRoleChange(next: StaffRoleKey) {
    setBaseRole(next);
    // Only reseed the feature grid from the new base role's defaults when
    // creating a brand-new role — an existing role's already-configured
    // features shouldn't be silently overwritten by switching the data-access
    // base afterwards.
    if (!isEdit) setPerms(DEFAULT_PERMISSIONS[next]);
  }

  function handleToggle(key: string, value: boolean) {
    setPerms(prev => setValueAtKey(prev, key, value));
  }

  async function handleSave() {
    setError("");
    const trimmed = name.trim();
    if (!trimmed) { setError("Enter a name for this role."); return; }
    if (existingNames.includes(trimmed.toLowerCase())) {
      setError("A custom role with this name already exists.");
      return;
    }
    setSaving(true);
    try {
      if (isEdit && role) {
        await safeUpdateDoc(doc(db, "servicecenters", centerId, "customRoles", role.id), {
          name: trimmed, baseRole, permissions: perms, updatedAt: Timestamp.now(),
        });
      } else {
        await safeAddDoc(collection(db, "servicecenters", centerId, "customRoles"), {
          name: trimmed, baseRole, permissions: perms, createdAt: Timestamp.now(),
        });
      }
      onClose();
    } catch {
      setError("Could not save the role. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <div className="border-b border-white/10 bg-[#0B1120]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Users2 className="w-5 h-5 text-[#F97316]" />
          <h1 className="text-xl font-bold">{isEdit ? "Edit Custom Role" : "New Custom Role"}</h1>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {error && (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        <div className="bg-[#162032] border border-white/10 rounded-2xl p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Role Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={40}
              placeholder="e.g. Senior Technician"
              className="w-full bg-[#0B1120] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#F97316]/50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Data Access Base</label>
            <select
              value={baseRole}
              onChange={e => handleBaseRoleChange(e.target.value as StaffRoleKey)}
              className="w-full bg-[#0B1120] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#F97316]/50"
            >
              {BASE_ROLE_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <p className="text-xs text-gray-600 mt-1.5">
              Determines which underlying data this role's employees can reach — unrelated to which
              features below are turned on. The feature toggles are fully independent of this choice.
            </p>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-gray-300 mb-3">Features</h2>
          <PermissionsGrid perms={perms} onChange={handleToggle} />
        </div>

        <div className="flex gap-3 justify-end pt-2">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-sm text-gray-300 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-[#F97316] hover:bg-[#EA6C10] disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? "Saving…" : "Save Role"}
          </button>
        </div>
      </div>
    </div>
  );
}
