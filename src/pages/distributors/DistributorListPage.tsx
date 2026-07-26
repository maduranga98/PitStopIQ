import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc, onSnapshot, Timestamp } from "firebase/firestore";
import {
  Truck, Plus, Search, Edit2, Trash2, X, AlertTriangle, Link2, Copy,
  Check, RefreshCw, Phone, ClipboardList, Power, MessageCircle,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { safeSetDoc, safeUpdateDoc, safeDeleteDoc } from "../../lib/firestoreWrite";
import { LoadingBlock } from "../../components/LoadingProgress";
import type { Distributor } from "../../types/auth";
import {
  distributorPortalUrl, generateAccessToken, mintDistributorShortLink, shortPortalUrl,
} from "../../lib/distributors";

// LK phone: 07XXXXXXXX or +94XXXXXXXXX
function validateLKPhone(phone: string): boolean {
  return /^(\+94|0)\d{9}$/.test(phone.replace(/\s/g, ""));
}

function formatDate(ts?: Timestamp | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const inputClass =
  "w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition";

// ── Add / Edit modal ──────────────────────────────────────────────────────────

interface FormState {
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  isActive: boolean;
}

function DistributorFormModal({
  centerId,
  existing,
  onClose,
}: {
  centerId: string;
  existing: Distributor | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>({
    name: existing?.name ?? "",
    contactPerson: existing?.contactPerson ?? "",
    phone: existing?.phone ?? "",
    email: existing?.email ?? "",
    address: existing?.address ?? "",
    notes: existing?.notes ?? "",
    isActive: existing?.isActive !== false,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [generalError, setGeneralError] = useState("");

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: undefined }));
  }

  function validate(): boolean {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) e.name = "Distributor name is required.";
    else if (form.name.trim().length > 100) e.name = "Max 100 characters.";
    if (!form.phone.trim()) e.phone = "Phone number is required.";
    else if (!validateLKPhone(form.phone)) e.phone = "Enter a valid Sri Lanka number (e.g. 0771234567).";
    if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) e.email = "Enter a valid email address.";
    if (form.notes.trim().length > 300) e.notes = "Max 300 characters.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGeneralError("");
    if (!validate()) return;

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        contactPerson: form.contactPerson.trim() || null,
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
        isActive: form.isActive,
        centerId,
        updatedAt: Timestamp.now(),
      };

      if (existing) {
        await safeUpdateDoc(doc(db, "servicecenters", centerId, "distributors", existing.id), payload);
      } else {
        // A distributor is useless without a share link, so the token is minted
        // up front and the portal is on from the moment they're created.
        const token = generateAccessToken();
        const ref = doc(collection(db, "servicecenters", centerId, "distributors"));
        await safeSetDoc(ref, {
          ...payload,
          accessToken: token,
          portalEnabled: true,
          createdAt: Timestamp.now(),
        });
        const code = await mintDistributorShortLink(centerId, ref.id, token);
        if (code) {
          safeUpdateDoc(doc(db, "servicecenters", centerId, "distributors", ref.id), { shortCode: code })
            .catch(() => { /* the long link still works */ });
        }
      }
      onClose();
    } catch {
      setGeneralError("Could not save the distributor. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">
            {existing ? "Edit Distributor" : "Add Distributor"}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Business Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={e => set("name", e.target.value)}
              placeholder="e.g. Kandy Lubricants Distribution"
              maxLength={100}
              className={inputClass}
            />
            {errors.name && <p className="mt-1 text-xs text-red-400">{errors.name}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Contact Person <span className="text-gray-600 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={form.contactPerson}
              onChange={e => set("contactPerson", e.target.value)}
              placeholder="e.g. Nimal Perera"
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Phone <span className="text-red-400">*</span>
            </label>
            <input
              type="tel"
              value={form.phone}
              onChange={e => set("phone", e.target.value)}
              placeholder="e.g. 0771234567"
              className={inputClass}
            />
            {errors.phone && <p className="mt-1 text-xs text-red-400">{errors.phone}</p>}
            <p className="text-xs text-gray-600 mt-1">Used to send them the portal link over WhatsApp.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Email <span className="text-gray-600 font-normal">(optional)</span>
            </label>
            <input
              type="email"
              value={form.email}
              onChange={e => set("email", e.target.value)}
              placeholder="e.g. orders@kandylubes.lk"
              className={inputClass}
            />
            {errors.email && <p className="mt-1 text-xs text-red-400">{errors.email}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Address <span className="text-gray-600 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={form.address}
              onChange={e => set("address", e.target.value)}
              placeholder="e.g. 42 Peradeniya Road, Kandy"
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Notes <span className="text-gray-600 font-normal">(optional)</span>
            </label>
            <textarea
              value={form.notes}
              onChange={e => set("notes", e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="Credit terms, delivery arrangements…"
              className={`${inputClass} resize-none`}
            />
            {errors.notes && <p className="mt-1 text-xs text-red-400">{errors.notes}</p>}
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={e => set("isActive", e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-white/20 bg-[#0B1120] accent-[#F97316]"
            />
            <span>
              <span className="block text-sm font-medium text-gray-300">Active</span>
              <span className="block text-xs text-gray-600 mt-0.5">
                Inactive distributors can't be released stock and drop off the release picker.
              </span>
            </span>
          </label>

          {generalError && (
            <p className="text-sm text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {generalError}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm"
            >
              {saving ? "Saving…" : existing ? "Save Changes" : "Add Distributor"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Share link modal ──────────────────────────────────────────────────────────

function ShareLinkModal({
  distributor,
  centerId,
  centerName,
  onClose,
}: {
  distributor: Distributor;
  centerId: string;
  centerName: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<"short" | "full" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const fullLink = distributorPortalUrl(centerId, distributor.id, distributor.accessToken);
  const shortLink = distributor.shortCode ? shortPortalUrl(distributor.shortCode) : null;
  const shareLink = shortLink ?? fullLink;
  const portalOn = distributor.portalEnabled !== false;

  const whatsappHref = useMemo(() => {
    const phone = distributor.phone.replace(/\s/g, "").replace(/^0/, "94").replace(/^\+/, "");
    const message =
      `Hi ${distributor.contactPerson || distributor.name}, here is your ${centerName} stock catalog. ` +
      `You can browse what's available and place an order any time: ${shareLink}`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  }, [distributor, centerName, shareLink]);

  async function copy(value: string, which: "short" | "full") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Could not copy — select the link and copy it manually.");
    }
  }

  // Regenerating mints a brand-new token and short code, which kills every link
  // already in circulation. That's the revoke button.
  async function regenerate() {
    setBusy(true);
    setError("");
    try {
      const token = generateAccessToken();
      const code = await mintDistributorShortLink(centerId, distributor.id, token);
      await safeUpdateDoc(doc(db, "servicecenters", centerId, "distributors", distributor.id), {
        accessToken: token,
        shortCode: code ?? null,
        updatedAt: Timestamp.now(),
      });
    } catch {
      setError("Could not regenerate the link. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function togglePortal() {
    setBusy(true);
    setError("");
    try {
      await safeUpdateDoc(doc(db, "servicecenters", centerId, "distributors", distributor.id), {
        portalEnabled: !portalOn,
        updatedAt: Timestamp.now(),
      });
    } catch {
      setError("Could not update the portal. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-semibold text-white">Share Catalog Link</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm text-gray-400 mb-5">
          {distributor.name} can open this link to browse your stock and place an order. No login needed —
          anyone with the link gets in, so share it directly with them.
        </p>

        {!portalOn && (
          <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2.5 mb-4">
            <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300">
              The portal is switched off. The link will show a "temporarily unavailable" notice until you turn it
              back on.
            </p>
          </div>
        )}

        {shortLink && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1.5">
              Short link
            </label>
            <div className="flex gap-2">
              <input
                readOnly
                value={shortLink}
                onFocus={e => e.currentTarget.select()}
                className={`${inputClass} font-mono text-xs`}
              />
              <button
                onClick={() => copy(shortLink, "short")}
                className="flex-shrink-0 px-3 rounded-lg bg-[#F97316] hover:bg-[#ea6c0f] text-white transition"
                title="Copy short link"
              >
                {copied === "short" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}

        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1.5">
            Full link
          </label>
          <div className="flex gap-2">
            <input
              readOnly
              value={fullLink}
              onFocus={e => e.currentTarget.select()}
              className={`${inputClass} font-mono text-xs`}
            />
            <button
              onClick={() => copy(fullLink, "full")}
              className="flex-shrink-0 px-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200 transition"
              title="Copy full link"
            >
              {copied === "full" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-400 flex items-center gap-1.5 mb-4">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
          </p>
        )}

        <a
          href={whatsappHref}
          target="_blank"
          rel="noreferrer"
          className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm mb-3"
        >
          <MessageCircle className="h-4 w-4" />
          Send on WhatsApp
        </a>

        <div className="flex gap-2">
          <button
            onClick={togglePortal}
            disabled={busy}
            className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-medium border px-3 py-2.5 rounded-lg transition disabled:opacity-60 ${
              portalOn
                ? "bg-white/5 hover:bg-white/10 border-white/10 text-gray-200"
                : "bg-green-500/10 hover:bg-green-500/20 border-green-500/20 text-green-400"
            }`}
          >
            <Power className="h-3.5 w-3.5" />
            {portalOn ? "Turn portal off" : "Turn portal on"}
          </button>
          <button
            onClick={regenerate}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-3 py-2.5 rounded-lg transition disabled:opacity-60"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Revoke &amp; regenerate
          </button>
        </div>
        <p className="text-xs text-gray-600 mt-3">
          Regenerating invalidates every link you've already shared with this distributor — use it if a link
          leaks. You'll need to send them the new one.
        </p>
      </div>
    </div>
  );
}

// ── Delete confirm ────────────────────────────────────────────────────────────

function DeleteModal({
  distributor, centerId, onClose,
}: {
  distributor: Distributor; centerId: string; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    setBusy(true);
    setError("");
    try {
      await safeDeleteDoc(doc(db, "servicecenters", centerId, "distributors", distributor.id));
      onClose();
    } catch {
      setError("Could not delete the distributor. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-start gap-3 mb-5">
          <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-base font-semibold text-white">Delete Distributor</h3>
            <p className="text-sm text-gray-400 mt-1">
              Delete <strong className="text-white">{distributor.name}</strong>? Their catalog link stops working
              immediately. Past orders and stock releases stay in the record. Mark them inactive instead if you
              might work with them again.
            </p>
            {error && <p className="text-sm text-red-400 mt-2">{error}</p>}
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={busy}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm"
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DistributorListPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const centerId = currentUser?.centerId ?? "";

  const canView     = usePermission("distributors.view");
  const canCreate   = usePermission("distributors.create");
  const canEdit     = usePermission("distributors.edit");
  const canDelete   = usePermission("distributors.delete");
  const canShare    = usePermission("distributors.shareLink");
  const canSeeOrders = usePermission("distributors.viewOrders");

  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [centerName, setCenterName] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const [formTarget, setFormTarget] = useState<Distributor | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<Distributor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Distributor | null>(null);

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(collection(db, "servicecenters", centerId, "distributors"), snap => {
      setDistributors(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() } as Distributor))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setLoading(false);
    }, () => setLoading(false));
  }, [centerId]);

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(doc(db, "servicecenters", centerId), snap => {
      setCenterName((snap.data()?.name as string | undefined) ?? "your service center");
    }, () => setCenterName("your service center"));
  }, [centerId]);

  // The modal reads from `distributors`, so a token regenerated inside it is
  // reflected without closing and reopening.
  const liveShareTarget = shareTarget
    ? distributors.find(d => d.id === shareTarget.id) ?? null
    : null;

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase();
    return distributors
      .filter(d => showInactive || d.isActive !== false)
      .filter(d => !q || d.name.toLowerCase().includes(q) || d.phone.includes(q)
        || (d.contactPerson ?? "").toLowerCase().includes(q));
  }, [distributors, search, showInactive]);

  const inactiveCount = distributors.filter(d => d.isActive === false).length;

  if (!canView) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <Truck className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to view distributors.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<Truck className="w-5 h-5" />}
        title="Distributors"
        actions={
          <div className="flex items-center gap-2">
            {canSeeOrders && (
              <button
                onClick={() => navigate("/distributors/orders")}
                className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium px-4 py-2.5 rounded-xl transition text-sm"
              >
                <ClipboardList className="h-4 w-4" />
                Orders
              </button>
            )}
            {canCreate && (
              <button
                onClick={() => { setFormTarget(null); setFormOpen(true); }}
                className="flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2.5 rounded-xl transition text-sm"
              >
                <Plus className="h-4 w-4" />
                Add Distributor
              </button>
            )}
          </div>
        }
      />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Filters */}
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-4 mb-6 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, contact or phone…"
              className="w-full pl-9 pr-4 py-2.5 bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-xl text-sm text-white placeholder-gray-600 transition"
            />
          </div>
          {inactiveCount > 0 && (
            <button
              onClick={() => setShowInactive(v => !v)}
              className={`px-3 py-2 rounded-xl text-sm font-medium transition border ${
                showInactive
                  ? "bg-[#F97316]/20 text-[#F97316] border-[#F97316]/40"
                  : "bg-[#0B1120] text-gray-400 border-white/10 hover:border-white/20"
              }`}
            >
              Show inactive ({inactiveCount})
            </button>
          )}
        </div>

        {loading ? (
          <LoadingBlock className="py-20" />
        ) : displayed.length === 0 ? (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3 text-center">
            <Truck className="h-12 w-12 text-gray-700" />
            <p className="text-gray-400 font-medium">
              {distributors.length === 0 ? "No distributors yet" : "No distributors match your search"}
            </p>
            {distributors.length === 0 && (
              <>
                <p className="text-sm text-gray-500 max-w-sm">
                  Add the people who take stock off your hands. Each one gets a private link to browse your
                  catalog and send you orders.
                </p>
                {canCreate && (
                  <button
                    onClick={() => { setFormTarget(null); setFormOpen(true); }}
                    className="mt-2 flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2 rounded-xl transition text-sm"
                  >
                    <Plus className="h-4 w-4" /> Add First Distributor
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {displayed.map(d => {
              const inactive = d.isActive === false;
              const portalOff = d.portalEnabled === false;
              return (
                <div
                  key={d.id}
                  className={`bg-[#162032] border rounded-2xl p-4 ${inactive ? "border-white/5 opacity-70" : "border-white/10"}`}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-white">{d.name}</p>
                        {inactive && (
                          <span className="text-xs px-2 py-0.5 rounded-full border border-gray-500/30 bg-gray-500/15 text-gray-400">
                            Inactive
                          </span>
                        )}
                        {portalOff && !inactive && (
                          <span className="text-xs px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/15 text-amber-400">
                            Portal off
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
                        {d.contactPerson && <span>{d.contactPerson}</span>}
                        <a
                          href={`tel:${d.phone}`}
                          className="inline-flex items-center gap-1 text-[#F97316] hover:text-[#fb923c]"
                        >
                          <Phone className="h-3 w-3" /> {d.phone}
                        </a>
                        {d.email && <span className="text-gray-500">{d.email}</span>}
                      </p>
                      {d.address && <p className="text-xs text-gray-600 mt-1">{d.address}</p>}
                      <p className="text-xs text-gray-600 mt-1.5">
                        Last order: {formatDate(d.lastOrderAt)}
                      </p>
                      {d.notes && <p className="text-xs text-gray-400 mt-1.5">{d.notes}</p>}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {canShare && (
                        <button
                          onClick={() => setShareTarget(d)}
                          className="flex items-center gap-1.5 text-xs font-medium bg-[#F97316]/10 hover:bg-[#F97316]/20 text-[#F97316] border border-[#F97316]/20 px-3 py-1.5 rounded-lg transition"
                        >
                          <Link2 className="h-3.5 w-3.5" />
                          Share Link
                        </button>
                      )}
                      {canEdit && (
                        <button
                          onClick={() => { setFormTarget(d); setFormOpen(true); }}
                          className="p-1.5 text-gray-500 hover:text-white transition rounded-lg hover:bg-white/5"
                          title="Edit"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => setDeleteTarget(d)}
                          className="p-1.5 text-gray-500 hover:text-red-400 transition rounded-lg hover:bg-red-500/5"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {formOpen && (
        <DistributorFormModal
          centerId={centerId}
          existing={formTarget}
          onClose={() => { setFormOpen(false); setFormTarget(null); }}
        />
      )}

      {liveShareTarget && (
        <ShareLinkModal
          distributor={liveShareTarget}
          centerId={centerId}
          centerName={centerName}
          onClose={() => setShareTarget(null)}
        />
      )}

      {deleteTarget && (
        <DeleteModal
          distributor={deleteTarget}
          centerId={centerId}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
