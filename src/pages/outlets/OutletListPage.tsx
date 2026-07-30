import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, doc, onSnapshot, orderBy, query, Timestamp,
} from "firebase/firestore";
import {
  Store, Plus, X, AlertTriangle, Edit2, Power, Phone, MapPin, History,
  Link2, Copy, Check, RefreshCw, UserCog,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { safeAddDoc, safeUpdateDoc } from "../../lib/firestoreWrite";
import { generatePosToken, mintPosShortLink, posTerminalUrl, shortPosTerminalUrl } from "../../lib/outletsPos";
import type { Outlet, StaffMember } from "../../types/auth";
import { LoadingBlock } from "../../components/LoadingProgress";

// ── Add / Edit modal ──────────────────────────────────────────────────────────

function OutletModal({
  outlet, centerId, uid, userName, staff, onClose,
}: {
  outlet: Outlet | null;
  centerId: string;
  uid: string;
  userName: string;
  staff: StaffMember[];
  onClose: () => void;
}) {
  const [name, setName] = useState(outlet?.name ?? "");
  const [address, setAddress] = useState(outlet?.address ?? "");
  const [phone, setPhone] = useState(outlet?.phone ?? "");
  const [notes, setNotes] = useState(outlet?.notes ?? "");
  const [cashierId, setCashierId] = useState(outlet?.assignedCashierId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) { setError("Enter an outlet name."); return; }
    setSaving(true);
    setError("");
    const cashier = staff.find(s => s.id === cashierId);
    try {
      if (outlet) {
        await safeUpdateDoc(doc(db, "servicecenters", centerId, "outlets", outlet.id), {
          name: trimmed,
          address: address.trim() || null,
          phone: phone.trim() || null,
          notes: notes.trim() || null,
          assignedCashierId: cashier?.id ?? null,
          assignedCashierName: cashier?.fullName ?? null,
          updatedAt: Timestamp.now(),
        });
      } else {
        await safeAddDoc(collection(db, "servicecenters", centerId, "outlets"), {
          name: trimmed,
          address: address.trim() || null,
          phone: phone.trim() || null,
          notes: notes.trim() || null,
          assignedCashierId: cashier?.id ?? null,
          assignedCashierName: cashier?.fullName ?? null,
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
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
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
              Assigned Cashier <span className="text-gray-600 font-normal">(optional)</span>
            </label>
            <select
              value={cashierId}
              onChange={e => setCashierId(e.target.value)}
              className="w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white text-sm transition appearance-none"
            >
              <option value="">Unassigned</option>
              {staff.map(s => (
                <option key={s.id} value={s.id}>{s.fullName} ({s.role})</option>
              ))}
            </select>
            <p className="text-xs text-gray-600 mt-1.5">
              Shown on this outlet's POS terminal and its sales log — the terminal link itself needs no login.
            </p>
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

// ── POS terminal link card ──────────────────────────────────────────────────

function PosLinkRow({ outlet, centerId, canManage }: { outlet: Outlet; centerId: string; canManage: boolean }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const token = generatePosToken();
      const code = await mintPosShortLink(centerId, outlet.id, token);
      await safeUpdateDoc(doc(db, "servicecenters", centerId, "outlets", outlet.id), {
        posToken: token,
        posShortCode: code ?? null,
        updatedAt: Timestamp.now(),
      });
    } catch {
      setError("Could not create the POS link. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!outlet.posToken) return;
    const link = outlet.posShortCode
      ? shortPosTerminalUrl(outlet.posShortCode)
      : posTerminalUrl(centerId, outlet.id, outlet.posToken);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy the link.");
    }
  }

  if (!canManage) return null;

  return (
    <div className="mt-3 pt-3 border-t border-white/5">
      <p className="text-xs font-medium text-gray-400 flex items-center gap-1.5 mb-2">
        <Link2 className="h-3.5 w-3.5" /> POS Terminal Link
      </p>
      {outlet.posToken ? (
        <div className="flex gap-2">
          <button
            onClick={copyLink}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 px-3 py-2 rounded-lg transition"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy Link"}
          </button>
          <button
            onClick={generate}
            disabled={busy}
            title="Regenerating revokes the old link"
            className="flex items-center justify-center gap-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 px-3 py-2 rounded-lg transition disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
          </button>
        </div>
      ) : (
        <button
          onClick={generate}
          disabled={busy}
          className="w-full flex items-center justify-center gap-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 px-3 py-2 rounded-lg transition disabled:opacity-60"
        >
          <Link2 className="h-3.5 w-3.5" /> {busy ? "Creating…" : "Create POS Link"}
        </button>
      )}
      <p className="text-[11px] text-gray-600 mt-1.5">
        Open this link on the counter device — it rings up sales and moves stock with no login. Treat it like a password.
      </p>
      {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OutletListPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const centerId = currentUser?.centerId ?? "";

  const canView = usePermission("outlets.view");
  const canCreate = usePermission("outlets.create");
  const canEdit = usePermission("outlets.edit");
  const canManageLink = usePermission("pos.sell");
  const canViewSales = usePermission("pos.viewSales");

  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
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

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(
      query(collection(db, "servicecenters", centerId, "staff"), orderBy("fullName")),
      snap => {
        setStaff(snap.docs.map(d => ({ id: d.id, ...d.data() } as StaffMember)).filter(s => s.active));
      },
      () => setStaff([]),
    );
  }, [centerId]);

  const staffById = useMemo(() => new Map(staff.map(s => [s.id, s])), [staff]);

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
        title="Outlets & POS"
        actions={
          <div className="flex items-center gap-2">
            {canViewSales && (
              <button
                onClick={() => navigate("/pos/sales")}
                className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium px-4 py-2.5 rounded-xl transition text-sm"
              >
                <History className="h-4 w-4" /> Sales History
              </button>
            )}
            {canCreate && (
              <button
                onClick={() => setModalTarget(null)}
                className="flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2.5 rounded-xl transition text-sm"
              >
                <Plus className="h-4 w-4" /> Add Outlet
              </button>
            )}
          </div>
        }
      />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <p className="text-sm text-gray-500 mb-6 max-w-2xl">
          This page is where outlets are managed and their sales are reviewed — the actual register is a separate,
          shareable link opened on the counter device (see each outlet's POS Terminal Link below).
        </p>
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
            {outlets.map(outlet => {
              const cashier = outlet.assignedCashierId ? staffById.get(outlet.assignedCashierId) : undefined;
              return (
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
                      <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                        <UserCog className="h-3 w-3 flex-shrink-0" />
                        {cashier ? cashier.fullName : outlet.assignedCashierName || "No cashier assigned"}
                      </p>
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
                  <PosLinkRow outlet={outlet} centerId={centerId} canManage={canManageLink} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modalTarget !== undefined && (
        <OutletModal
          outlet={modalTarget}
          centerId={centerId}
          uid={currentUser?.uid ?? ""}
          userName={currentUser?.displayName ?? currentUser?.email ?? "Staff"}
          staff={staff}
          onClose={() => setModalTarget(undefined)}
        />
      )}
    </div>
  );
}
