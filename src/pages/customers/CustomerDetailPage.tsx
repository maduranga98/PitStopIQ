import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  doc, onSnapshot, collection, query, where, orderBy,
  limit, getDocs, updateDoc, Timestamp,
} from "firebase/firestore";
import {
  ArrowLeft, Edit2, Trash2, Car, Plus, Clock, MessageSquare,
  ChevronDown, ChevronUp, AlertCircle, Check, X,
} from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { Customer, Vehicle, ServiceRecord, SmsLog, UserRole } from "../../types/auth";

const AVATAR_COLORS = [
  "bg-orange-500", "bg-blue-500", "bg-green-500", "bg-purple-500",
  "bg-pink-500", "bg-teal-500", "bg-yellow-500", "bg-red-500",
];

function avatarColor(name: string) {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatPhone(phone: string) {
  if (phone.startsWith("+94") && phone.length === 12) {
    const local = "0" + phone.slice(3);
    return local.slice(0, 3) + " " + local.slice(3, 6) + " " + local.slice(6);
  }
  return phone;
}

function normaliseLKPhone(raw: string): string | null {
  const s = raw.replace(/[\s\-()]/g, "");
  if (/^\+94\d{9}$/.test(s)) return s;
  if (/^0\d{9}$/.test(s)) return "+94" + s.slice(1);
  if (/^94\d{9}$/.test(s)) return "+" + s;
  return null;
}

function formatDate(ts: Timestamp): string {
  return ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(ts: Timestamp): string {
  return ts.toDate().toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

const STATUS_CONFIG = {
  pending:     { label: "Pending",     bg: "bg-gray-500/20",   text: "text-gray-300" },
  in_progress: { label: "In Progress", bg: "bg-amber-500/20",  text: "text-amber-300" },
  done:        { label: "Done",        bg: "bg-green-500/20",  text: "text-green-300" },
  delivered:   { label: "Delivered",   bg: "bg-blue-900/30",   text: "text-blue-300" },
};

const DELIVERY_CONFIG = {
  sent:      { label: "Sent",      bg: "bg-blue-500/20",  text: "text-blue-300" },
  delivered: { label: "Delivered", bg: "bg-green-500/20", text: "text-green-300" },
  failed:    { label: "Failed",    bg: "bg-red-500/20",   text: "text-red-300" },
};

const canWrite = (role?: UserRole) =>
  role === "Owner" || role === "Manager" || role === "Receptionist";
const isOwner = (role?: UserRole) => role === "Owner";

const SERVICE_PAGE_SIZE = 20;

export default function CustomerDetailPage() {
  const { customerId } = useParams<{ customerId: string }>();
  const [searchParams] = useSearchParams();
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [smsLogs, setSmsLogs] = useState<SmsLog[]>([]);
  const [serviceLimit, setServiceLimit] = useState(SERVICE_PAGE_SIZE);
  const [expandedSms, setExpandedSms] = useState<Set<string>>(new Set());

  // Edit state
  const [editing, setEditing] = useState(searchParams.get("edit") === "1");
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editNic, setEditNic] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Delete
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Load customer (real-time)
  useEffect(() => {
    if (!customerId || !currentUser?.centerId) return;
    const ref = doc(db, "servicecenters", currentUser.centerId, "customers", customerId);
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists() || snap.data()?.isDeleted) {
        setNotFound(true);
      } else {
        const c = { id: snap.id, ...snap.data() } as Customer;
        setCustomer(c);
        setEditName(c.name);
        setEditPhone(formatPhone(c.phone));
        setEditNic(c.nic ?? "");
        setEditNotes(c.notes ?? "");
      }
      setLoading(false);
    });
    return unsub;
  }, [customerId, currentUser?.centerId]);

  // Load vehicles
  useEffect(() => {
    if (!customerId || !currentUser?.centerId) return;
    const q = query(
      collection(db, "servicecenters", currentUser.centerId, "vehicles"),
      where("customerId", "==", customerId),
    );
    return onSnapshot(q, (snap) => {
      setVehicles(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Vehicle)));
    });
  }, [customerId, currentUser?.centerId]);

  // Load services
  useEffect(() => {
    if (!customerId || !currentUser?.centerId) return;
    const q = query(
      collection(db, "servicecenters", currentUser.centerId, "services"),
      where("customerId", "==", customerId),
      orderBy("createdAt", "desc"),
      limit(serviceLimit),
    );
    getDocs(q).then((snap) => {
      setServices(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ServiceRecord)));
    });
  }, [customerId, currentUser?.centerId, serviceLimit]);

  // Load SMS logs
  useEffect(() => {
    if (!customerId || !currentUser?.centerId) return;
    const q = query(
      collection(db, "servicecenters", currentUser.centerId, "smsLogs"),
      where("customerId", "==", customerId),
      orderBy("sentAt", "desc"),
    );
    return onSnapshot(q, (snap) => {
      setSmsLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SmsLog)));
    });
  }, [customerId, currentUser?.centerId]);

  function startEdit() {
    if (!customer) return;
    setEditName(customer.name);
    setEditPhone(formatPhone(customer.phone));
    setEditNic(customer.nic ?? "");
    setEditNotes(customer.notes ?? "");
    setEditErrors({});
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setEditErrors({});
  }

  async function saveEdit() {
    const errs: Record<string, string> = {};
    if (!editName.trim()) errs.name = "Name is required";
    else if (editName.trim().length < 2 || editName.trim().length > 80) errs.name = "Name must be 2–80 characters";
    if (!editPhone.trim()) errs.phone = "Phone is required";
    else if (!normaliseLKPhone(editPhone)) errs.phone = "Enter a valid Sri Lanka number";
    if (editNotes.length > 500) errs.notes = "Notes must be 500 characters or less";
    setEditErrors(errs);
    if (Object.keys(errs).length > 0) return;

    if (!customerId || !currentUser?.centerId) return;
    setSaving(true);
    try {
      await updateDoc(
        doc(db, "servicecenters", currentUser.centerId, "customers", customerId),
        {
          name: editName.trim(),
          phone: normaliseLKPhone(editPhone)!,
          nic: editNic.trim() || null,
          notes: editNotes.trim() || null,
        },
      );
      setEditing(false);
    } catch (err) {
      console.error(err);
      setEditErrors({ submit: "Failed to save. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!customerId || !currentUser?.centerId) return;
    setDeleting(true);
    try {
      await updateDoc(
        doc(db, "servicecenters", currentUser.centerId, "customers", customerId),
        { isDeleted: true },
      );
      navigate("/customers");
    } catch {
      setDeleting(false);
    }
  }

  function toggleSms(id: string) {
    setExpandedSms((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#F97316] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-[#0B1120] text-white flex flex-col items-center justify-center gap-4">
        <AlertCircle className="w-12 h-12 text-gray-500" />
        <p className="text-gray-400">Customer not found.</p>
        <button onClick={() => navigate("/customers")} className="text-sm text-[#F97316] hover:underline">
          Back to Customers
        </button>
      </div>
    );
  }

  if (!customer) return null;

  return (
    <div className="min-h-screen bg-[#0B1120] text-white pb-16">
      {/* Header */}
      <div className="border-b border-white/10 bg-[#0B1120]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <button
            onClick={() => navigate("/customers")}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold truncate">{customer.name}</h1>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* ── Profile Card ─────────────────────────────────────────── */}
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-bold shrink-0 ${avatarColor(customer.name)}`}>
                {initials(customer.name)}
              </div>
              <div>
                {!editing ? (
                  <>
                    <h2 className="text-xl font-semibold">{customer.name}</h2>
                    <p className="text-gray-400 text-sm mt-0.5">{formatPhone(customer.phone)}</p>
                    {customer.nic && (
                      <p className="text-gray-500 text-xs mt-0.5">NIC: {customer.nic}</p>
                    )}
                  </>
                ) : (
                  <p className="text-gray-400 text-sm">Editing profile…</p>
                )}
              </div>
            </div>
            {!editing && (
              <div className="flex items-center gap-2 shrink-0">
                {canWrite(currentUser?.role) && (
                  <button
                    onClick={startEdit}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-300 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors"
                  >
                    <Edit2 className="w-3.5 h-3.5" /> Edit
                  </button>
                )}
                {isOwner(currentUser?.role) && (
                  <button
                    onClick={() => setShowDeleteModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-400 hover:text-red-300 border border-red-500/20 hover:border-red-500/40 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Inline edit form */}
          {editing && (
            <div className="mt-5 space-y-4 border-t border-white/10 pt-5">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-400">Full Name *</label>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={80}
                    className={`w-full bg-[#0B1120] border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F97316]/60 ${editErrors.name ? "border-red-500" : "border-white/10"}`}
                  />
                  {editErrors.name && <p className="text-xs text-red-400">{editErrors.name}</p>}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-400">Phone *</label>
                  <input
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className={`w-full bg-[#0B1120] border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F97316]/60 ${editErrors.phone ? "border-red-500" : "border-white/10"}`}
                  />
                  {editErrors.phone && <p className="text-xs text-red-400">{editErrors.phone}</p>}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-400">NIC / Passport</label>
                <input
                  value={editNic}
                  onChange={(e) => setEditNic(e.target.value)}
                  className="w-full bg-[#0B1120] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F97316]/60"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-400">Notes</label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={2}
                  maxLength={500}
                  className={`w-full bg-[#0B1120] border rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-[#F97316]/60 ${editErrors.notes ? "border-red-500" : "border-white/10"}`}
                />
                <div className="flex justify-between">
                  {editErrors.notes ? <p className="text-xs text-red-400">{editErrors.notes}</p> : <span />}
                  <span className="text-xs text-gray-500">{editNotes.length}/500</span>
                </div>
              </div>
              {editErrors.submit && (
                <p className="text-xs text-red-400">{editErrors.submit}</p>
              )}
              <div className="flex gap-2 justify-end">
                <button
                  onClick={cancelEdit}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-400 hover:text-white border border-white/10 rounded-lg transition-colors"
                >
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
                <button
                  onClick={saveEdit}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-[#F97316] hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg transition-colors"
                >
                  {saving
                    ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : <Check className="w-3.5 h-3.5" />
                  }
                  Save
                </button>
              </div>
            </div>
          )}

          {/* Notes display */}
          {!editing && customer.notes && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Notes</p>
              <p className="text-sm text-gray-300 whitespace-pre-wrap">{customer.notes}</p>
            </div>
          )}

          <div className="mt-4 pt-4 border-t border-white/10">
            <p className="text-xs text-gray-500">
              Customer since {formatDate(customer.createdAt)}
            </p>
          </div>
        </div>

        {/* ── Vehicles ─────────────────────────────────────────────── */}
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Car className="w-4 h-4 text-[#F97316]" />
              <h3 className="font-semibold">Vehicles</h3>
              <span className="text-xs text-gray-500">({vehicles.length})</span>
            </div>
            {canWrite(currentUser?.role) && (
              <button
                onClick={() => navigate(`/vehicles/add?customerId=${customerId}`)}
                className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-300 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add Vehicle
              </button>
            )}
          </div>
          {vehicles.length === 0 ? (
            <p className="text-sm text-gray-500">No vehicles registered yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {vehicles.map((v) => (
                <button
                  key={v.id}
                  onClick={() => navigate(`/vehicles/${v.id}`)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-[#F97316]/40 rounded-lg text-sm font-mono text-gray-200 transition-colors"
                >
                  <Car className="w-3.5 h-3.5 text-gray-400" />
                  {v.plateNumber}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Service History ───────────────────────────────────────── */}
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-[#F97316]" />
            <h3 className="font-semibold">Service History</h3>
          </div>
          {services.length === 0 ? (
            <p className="text-sm text-gray-500">No service records yet.</p>
          ) : (
            <div className="space-y-3">
              {services.map((s) => {
                const sc = STATUS_CONFIG[s.status] ?? STATUS_CONFIG.pending;
                return (
                  <button
                    key={s.id}
                    onClick={() => navigate(`/services/${s.id}`)}
                    className="w-full text-left flex items-start gap-4 p-3 hover:bg-white/5 rounded-xl transition-colors group"
                  >
                    <div className="w-2 h-2 rounded-full bg-[#F97316] mt-2 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-white">{s.serviceType}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>
                          {sc.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                        <span>{formatDate(s.createdAt)}</span>
                        {s.plateNumber && <span className="font-mono">{s.plateNumber}</span>}
                        {s.technicianName && <span>{s.technicianName}</span>}
                        {s.totalAmount != null && (
                          <span className="text-gray-400">LKR {s.totalAmount.toLocaleString()}</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {services.length === serviceLimit && (
            <button
              onClick={() => setServiceLimit((l) => l + SERVICE_PAGE_SIZE)}
              className="mt-4 text-sm text-[#F97316] hover:text-orange-400 transition-colors"
            >
              Load more
            </button>
          )}
        </div>

        {/* ── SMS Log ──────────────────────────────────────────────── */}
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <MessageSquare className="w-4 h-4 text-[#F97316]" />
            <h3 className="font-semibold">SMS Log</h3>
          </div>
          {smsLogs.length === 0 ? (
            <p className="text-sm text-gray-500">No messages sent yet.</p>
          ) : (
            <div className="space-y-2">
              {smsLogs.map((log) => {
                const dc = DELIVERY_CONFIG[log.deliveryStatus] ?? DELIVERY_CONFIG.sent;
                const expanded = expandedSms.has(log.id);
                return (
                  <div key={log.id} className="border border-white/10 rounded-xl overflow-hidden">
                    <button
                      onClick={() => toggleSms(log.id)}
                      className="w-full text-left flex items-center gap-3 p-3 hover:bg-white/5 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            log.messageType === "Completion"
                              ? "bg-purple-500/20 text-purple-300"
                              : "bg-blue-500/20 text-blue-300"
                          }`}>
                            {log.messageType}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${dc.bg} ${dc.text}`}>
                            {dc.label}
                          </span>
                          <span className="text-xs text-gray-500">{formatDateTime(log.sentAt)}</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5 truncate">
                          {log.message}
                        </p>
                      </div>
                      {expanded
                        ? <ChevronUp className="w-4 h-4 text-gray-500 shrink-0" />
                        : <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
                      }
                    </button>
                    {expanded && (
                      <div className="px-4 pb-3 pt-0 border-t border-white/5">
                        <p className="text-sm text-gray-300 whitespace-pre-wrap">{log.message}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-start gap-3 mb-5">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold text-white">Delete Customer?</h3>
                <p className="text-sm text-gray-400 mt-1">
                  <span className="text-white">{customer.name}</span> will be hidden from all
                  views. Their data and service history are retained.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 px-4 py-2.5 text-sm text-gray-300 border border-white/10 rounded-lg hover:border-white/20 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-[#E8272A] hover:bg-red-700 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {deleting && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
