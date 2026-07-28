import { useEffect, useState } from "react";
import {
  collection, doc, onSnapshot, orderBy, query, Timestamp,
} from "firebase/firestore";
import {
  Store, Plus, X, AlertTriangle, Edit2, Power, Phone, MapPin,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { safeAddDoc, safeUpdateDoc } from "../../lib/firestoreWrite";
import type { Outlet } from "../../types/auth";
import { LoadingBlock } from "../../components/LoadingProgress";

// ── Add / Edit modal ──────────────────────────────────────────────────────────

function OutletModal({
  outlet, centerId, uid, userName, onClose,
}: {
  outlet: Outlet | null;
  centerId: string;
  uid: string;
  userName: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(outlet?.name ?? "");
  const [address, setAddress] = useState(outlet?.address ?? "");
  const [phone, setPhone] = useState(outlet?.phone ?? "");
  const [notes, setNotes] = useState(outlet?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) { setError("Enter an outlet name."); return; }
    setSaving(true);
    setError("");
    try {
      if (outlet) {
        await safeUpdateDoc(doc(db, "servicecenters", centerId, "outlets", outlet.id), {
          name: trimmed,
          address: address.trim() || null,
          phone: phone.trim() || null,
          notes: notes.trim() || null,
          updatedAt: Timestamp.now(),
        });
      } else {
        await safeAddDoc(collection(db, "servicecenters", centerId, "outlets"), {
          name: trimmed,
          address: address.trim() || null,
          phone: phone.trim() || null,
          notes: notes.trim() || null,
          isActive: true,
          centerId,
          createdAt: Timestamp.now(),
          createdBy: uid,
          createdByName: userName,
        });
      }
      onClose();
    } catch {
      setError("Could not save the outlet. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">{outlet ? "Edit Outlet" : "Add Outlet"}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Outlet Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Front Counter"
              className="w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Address <span className="text-gray-600 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={address}
              onChange={e => setAddress(e.target.value)}
              className="w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Phone <span className="text-gray-600 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Notes <span className="text-gray-600 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition"
            />
          </div>
          {error && (
            <p className="text-sm text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
            </p>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm"
          >
            {saving ? "Saving…" : outlet ? "Save Changes" : "Add Outlet"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OutletListPage() {
  const { currentUser } = useAuth();
  const centerId = currentUser?.centerId ?? "";

  const canView = usePermission("outlets.view");
  const canCreate = usePermission("outlets.create");
  const canEdit = usePermission("outlets.edit");

  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalTarget, setModalTarget] = useState<Outlet | null | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(
      query(collection(db, "servicecenters", centerId, "outlets"), orderBy("name")),
      snap => {
        setOutlets(snap.docs.map(d => ({ id: d.id, ...d.data() } as Outlet)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [centerId]);

  async function toggleActive(outlet: Outlet) {
    setBusyId(outlet.id);
    try {
      await safeUpdateDoc(doc(db, "servicecenters", centerId, "outlets", outlet.id), {
        isActive: !outlet.isActive,
        updatedAt: Timestamp.now(),
      });
    } finally {
      setBusyId(null);
    }
  }

  if (!canView) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <Store className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to view Outlets.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<Store className="w-5 h-5" />}
        title="Outlets"
        actions={
          canCreate ? (
            <button
              onClick={() => setModalTarget(null)}
              className="flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2.5 rounded-xl transition text-sm"
            >
              <Plus className="h-4 w-4" /> Add Outlet
            </button>
          ) : undefined
        }
      />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <LoadingBlock className="py-20" />
        ) : outlets.length === 0 ? (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3">
            <Store className="h-12 w-12 text-gray-700" />
            <p className="text-gray-400 font-medium">No outlets yet</p>
            <p className="text-sm text-gray-500 max-w-sm text-center">
              An outlet is a retail counter that sells stock straight from inventory to walk-in customers — separate
              from the workshop's customers and jobs.
            </p>
            {canCreate && (
              <button
                onClick={() => setModalTarget(null)}
                className="mt-2 flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2 rounded-xl transition text-sm"
              >
                <Plus className="h-4 w-4" /> Add First Outlet
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {outlets.map(outlet => (
              <div key={outlet.id} className="bg-[#162032] border border-white/10 rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-white truncate">{outlet.name}</p>
                    {outlet.address && (
                      <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                        <MapPin className="h-3 w-3 flex-shrink-0" /> {outlet.address}
                      </p>
                    )}
                    {outlet.phone && (
                      <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                        <Phone className="h-3 w-3 flex-shrink-0" /> {outlet.phone}
                      </p>
                    )}
                  </div>
                  <span
                    className={`flex-shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${
                      outlet.isActive
                        ? "bg-green-500/15 text-green-400 border-green-500/20"
                        : "bg-white/5 text-gray-400 border-white/10"
                    }`}
                  >
                    {outlet.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
                {outlet.notes && <p className="text-xs text-gray-400 mt-3">{outlet.notes}</p>}
                {canEdit && (
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => setModalTarget(outlet)}
                      className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 px-3 py-2 rounded-lg transition"
                    >
                      <Edit2 className="h-3.5 w-3.5" /> Edit
                    </button>
                    <button
                      onClick={() => toggleActive(outlet)}
                      disabled={busyId === outlet.id}
                      className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 px-3 py-2 rounded-lg transition disabled:opacity-60"
                    >
                      <Power className="h-3.5 w-3.5" /> {outlet.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {modalTarget !== undefined && (
        <OutletModal
          outlet={modalTarget}
          centerId={centerId}
          uid={currentUser?.uid ?? ""}
          userName={currentUser?.displayName ?? currentUser?.email ?? "Staff"}
          onClose={() => setModalTarget(undefined)}
        />
      )}
    </div>
  );
}
