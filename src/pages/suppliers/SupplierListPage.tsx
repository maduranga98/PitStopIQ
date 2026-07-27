import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc, onSnapshot, orderBy, query, Timestamp } from "firebase/firestore";
import {
  Building2, Plus, Search, Edit2, Trash2, X, AlertTriangle, Phone,
  PackagePlus, Power, MessageCircle, Tag, FileText, ChevronDown, ChevronUp,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { safeSetDoc, safeUpdateDoc, safeDeleteDoc } from "../../lib/firestoreWrite";
import { LoadingBlock } from "../../components/LoadingProgress";
import type { Supplier, SupplierSupply } from "../../types/auth";
import { validateLKMobile } from "../../lib/suppliers";
import { formatLKR } from "../../lib/inventoryPricing";

// Who the workshop buys from. A supplier record is deliberately thin — the rep,
// the company they work for, the brand they carry and a mobile number — because
// that is what a storekeeper actually needs when a delivery turns up.

function formatDate(ts?: Timestamp | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const inputClass =
  "w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition";

// ── Add / Edit modal ──────────────────────────────────────────────────────────

interface FormState {
  name: string;
  companyName: string;
  brand: string;
  mobile: string;
  email: string;
  address: string;
  notes: string;
  isActive: boolean;
}

function SupplierFormModal({
  centerId,
  existing,
  onClose,
}: {
  centerId: string;
  existing: Supplier | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>({
    name: existing?.name ?? "",
    companyName: existing?.companyName ?? "",
    brand: existing?.brand ?? "",
    mobile: existing?.mobile ?? "",
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
    if (!form.name.trim()) e.name = "Supplier name is required.";
    else if (form.name.trim().length > 100) e.name = "Max 100 characters.";
    if (!form.companyName.trim()) e.companyName = "Company name is required.";
    else if (form.companyName.trim().length > 100) e.companyName = "Max 100 characters.";
    if (!form.brand.trim()) e.brand = "Brand is required.";
    else if (form.brand.trim().length > 60) e.brand = "Max 60 characters.";
    if (!form.mobile.trim()) e.mobile = "Mobile number is required.";
    else if (!validateLKMobile(form.mobile)) e.mobile = "Enter a valid Sri Lanka number (e.g. 0771234567).";
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
        companyName: form.companyName.trim(),
        brand: form.brand.trim(),
        mobile: form.mobile.trim(),
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
        isActive: form.isActive,
        centerId,
        updatedAt: Timestamp.now(),
      };

      if (existing) {
        await safeUpdateDoc(doc(db, "servicecenters", centerId, "suppliers", existing.id), payload);
      } else {
        await safeSetDoc(doc(collection(db, "servicecenters", centerId, "suppliers")), {
          ...payload,
          createdAt: Timestamp.now(),
        });
      }
      onClose();
    } catch {
      setGeneralError("Could not save the supplier. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        noValidate
        className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-white">
            {existing ? "Edit Supplier" : "Add Supplier"}
          </h3>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Supplier Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={e => set("name", e.target.value)}
              placeholder="e.g. Nuwan Perera"
              maxLength={100}
              className={inputClass}
            />
            {errors.name && <p className="mt-1 text-xs text-red-400">{errors.name}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Company Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={form.companyName}
              onChange={e => set("companyName", e.target.value)}
              placeholder="e.g. Kandy Auto Parts (Pvt) Ltd"
              maxLength={100}
              className={inputClass}
            />
            {errors.companyName && <p className="mt-1 text-xs text-red-400">{errors.companyName}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Brand <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={form.brand}
              onChange={e => set("brand", e.target.value)}
              placeholder="e.g. Castrol"
              maxLength={60}
              className={inputClass}
            />
            {errors.brand && <p className="mt-1 text-xs text-red-400">{errors.brand}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Mobile <span className="text-red-400">*</span>
            </label>
            <input
              type="tel"
              value={form.mobile}
              onChange={e => set("mobile", e.target.value)}
              placeholder="e.g. 0771234567"
              className={inputClass}
            />
            {errors.mobile && <p className="mt-1 text-xs text-red-400">{errors.mobile}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Email <span className="text-gray-600 font-normal">(optional)</span>
            </label>
            <input
              type="email"
              value={form.email}
              onChange={e => set("email", e.target.value)}
              placeholder="e.g. sales@kandyautoparts.lk"
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
              placeholder="Credit terms, delivery days, anything worth remembering…"
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
              <span className="block text-sm font-medium text-gray-300">Active supplier</span>
              <span className="block text-xs text-gray-600 mt-0.5">
                Inactive suppliers stay on record but can't be picked when booking a delivery in.
              </span>
            </span>
          </label>
        </div>

        {generalError && (
          <p className="text-sm text-red-400 flex items-center gap-1.5 mt-4">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {generalError}
          </p>
        )}

        <div className="flex gap-3 mt-6">
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
            {saving ? "Saving…" : existing ? "Save Changes" : "Add Supplier"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Delete confirm ────────────────────────────────────────────────────────────

function DeleteModal({
  supplier, centerId, onClose,
}: {
  supplier: Supplier;
  centerId: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    setBusy(true);
    try {
      await safeDeleteDoc(doc(db, "servicecenters", centerId, "suppliers", supplier.id));
      onClose();
    } catch {
      setError("Could not delete the supplier. Please try again.");
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
            <h3 className="text-base font-semibold text-white">Delete Supplier</h3>
            <p className="text-sm text-gray-400 mt-1">
              Delete <strong className="text-white">{supplier.companyName}</strong>? Past deliveries stay on
              record, and items keep the supplier details they were saved with. Deactivate instead if you may
              buy from them again.
            </p>
          </div>
        </div>
        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
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

// ── Supply history ────────────────────────────────────────────────────────────

function SupplyCard({ supply }: { supply: SupplierSupply }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-[#162032] border border-white/10 rounded-2xl p-4">
      <button onClick={() => setOpen(o => !o)} className="w-full text-left">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-semibold text-white">{supply.supplyNumber}</span>
              {supply.invoiceRef && (
                <span className="text-xs text-gray-500 inline-flex items-center gap-1">
                  <FileText className="h-3 w-3" /> {supply.invoiceRef}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {supply.supplierCompany}
              {supply.supplierBrand ? ` · ${supply.supplierBrand}` : ""} · {formatDate(supply.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="text-right">
              <p className="text-sm font-semibold text-white">{formatLKR(supply.total)}</p>
              <p className="text-xs text-gray-500">
                {supply.items.length === 1 ? "1 line" : `${supply.items.length} lines`}
              </p>
            </div>
            {open ? <ChevronUp className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />}
          </div>
        </div>
      </button>

      {open && (
        <div className="mt-3 space-y-1.5">
          {supply.items.map((line, idx) => (
            <div key={idx} className="bg-[#0B1120] border border-white/5 rounded-lg px-3 py-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-gray-200 truncate">
                  {line.itemName}
                  {line.isNewItem && <span className="text-[#F97316] ml-1.5">· new item</span>}
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {line.quantity} {line.unit} × {formatLKR(line.purchasePrice)}
                </p>
              </div>
              <p className="text-xs font-medium text-white flex-shrink-0">{formatLKR(line.lineTotal)}</p>
            </div>
          ))}
          {supply.note && <p className="text-xs text-gray-500 mt-2">Note: {supply.note}</p>}
          <p className="text-[11px] text-gray-600 mt-2">Booked in by {supply.createdByName}</p>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = "suppliers" | "supplies";

export default function SupplierListPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const centerId = currentUser?.centerId ?? "";

  const canView         = usePermission("suppliers.view");
  const canCreate       = usePermission("suppliers.create");
  const canEdit         = usePermission("suppliers.edit");
  const canDelete       = usePermission("suppliers.delete");
  const canRecordSupply = usePermission("suppliers.recordSupply");
  const canViewSupplies = usePermission("suppliers.viewSupplies");

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplies, setSupplies] = useState<SupplierSupply[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("suppliers");
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const [formTarget, setFormTarget] = useState<Supplier | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);

  useEffect(() => {
    if (!centerId || !canView) return;
    return onSnapshot(collection(db, "servicecenters", centerId, "suppliers"), snap => {
      setSuppliers(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() } as Supplier))
          .sort((a, b) => a.companyName.localeCompare(b.companyName)),
      );
      setLoading(false);
    }, () => setLoading(false));
  }, [centerId, canView]);

  useEffect(() => {
    if (!centerId || !canViewSupplies) return;
    const q = query(
      collection(db, "servicecenters", centerId, "supplierSupplies"),
      orderBy("createdAt", "desc"),
    );
    return onSnapshot(q, snap => {
      setSupplies(snap.docs.map(d => ({ id: d.id, ...d.data() } as SupplierSupply)));
    }, () => setSupplies([]));
  }, [centerId, canViewSupplies]);

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase();
    return suppliers
      .filter(s => showInactive || s.isActive !== false)
      .filter(s => !q
        || s.name.toLowerCase().includes(q)
        || s.companyName.toLowerCase().includes(q)
        || s.brand.toLowerCase().includes(q)
        || s.mobile.includes(q));
  }, [suppliers, search, showInactive]);

  const displayedSupplies = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return supplies;
    return supplies.filter(s =>
      s.supplyNumber.toLowerCase().includes(q)
      || s.supplierCompany.toLowerCase().includes(q)
      || (s.invoiceRef ?? "").toLowerCase().includes(q)
      || s.items.some(l => l.itemName.toLowerCase().includes(q)));
  }, [supplies, search]);

  const inactiveCount = suppliers.filter(s => s.isActive === false).length;

  async function toggleActive(supplier: Supplier) {
    await safeUpdateDoc(doc(db, "servicecenters", centerId, "suppliers", supplier.id), {
      isActive: supplier.isActive === false,
      updatedAt: Timestamp.now(),
    });
  }

  if (!canView) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <Building2 className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to view suppliers.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<Building2 className="w-5 h-5" />}
        title="Suppliers"
        actions={
          <div className="flex items-center gap-2">
            {canRecordSupply && (
              <button
                onClick={() => navigate("/suppliers/supply")}
                className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium px-4 py-2.5 rounded-xl transition text-sm"
              >
                <PackagePlus className="h-4 w-4" />
                Record Supply
              </button>
            )}
            {canCreate && (
              <button
                onClick={() => { setFormTarget(null); setFormOpen(true); }}
                className="flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2.5 rounded-xl transition text-sm"
              >
                <Plus className="h-4 w-4" />
                Add Supplier
              </button>
            )}
          </div>
        }
        below={
          canViewSupplies ? (
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-3">
              <div className="flex bg-white/5 rounded-lg p-0.5 gap-0.5 w-fit">
                {([["suppliers", `Suppliers (${suppliers.length})`], ["supplies", `Supplies (${supplies.length})`]] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                      tab === key ? "bg-orange-500 text-white" : "text-gray-400 hover:text-white"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : undefined
        }
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-4 mb-6 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={tab === "suppliers" ? "Search by name, company, brand or mobile…" : "Search by GRN, company, item or invoice…"}
              className="w-full pl-9 pr-4 py-2.5 bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-xl text-sm text-white placeholder-gray-600 transition"
            />
          </div>
          {tab === "suppliers" && inactiveCount > 0 && (
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
        ) : tab === "supplies" ? (
          displayedSupplies.length === 0 ? (
            <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3 text-center">
              <PackagePlus className="h-12 w-12 text-gray-700" />
              <p className="text-gray-400 font-medium">
                {supplies.length === 0 ? "No supplies recorded yet" : "No supplies match your search"}
              </p>
              {supplies.length === 0 && canRecordSupply && (
                <button
                  onClick={() => navigate("/suppliers/supply")}
                  className="mt-2 flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2 rounded-xl transition text-sm"
                >
                  <PackagePlus className="h-4 w-4" /> Record the First Supply
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {displayedSupplies.map(s => <SupplyCard key={s.id} supply={s} />)}
            </div>
          )
        ) : displayed.length === 0 ? (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3 text-center">
            <Building2 className="h-12 w-12 text-gray-700" />
            <p className="text-gray-400 font-medium">
              {suppliers.length === 0 ? "No suppliers yet" : "No suppliers match your search"}
            </p>
            {suppliers.length === 0 && canCreate && (
              <button
                onClick={() => { setFormTarget(null); setFormOpen(true); }}
                className="mt-2 flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2 rounded-xl transition text-sm"
              >
                <Plus className="h-4 w-4" /> Add First Supplier
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {displayed.map(supplier => (
              <div
                key={supplier.id}
                className={`bg-[#162032] border rounded-2xl p-4 ${
                  supplier.isActive === false ? "border-white/5 opacity-70" : "border-white/10"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-white truncate">{supplier.companyName}</p>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{supplier.name}</p>
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-xs text-gray-300 bg-white/5 border border-white/10 px-2 py-1 rounded-lg">
                        <Tag className="h-3 w-3 text-[#F97316]" /> {supplier.brand}
                      </span>
                      <a
                        href={`tel:${supplier.mobile}`}
                        className="inline-flex items-center gap-1 text-xs text-[#F97316] hover:text-[#fb923c]"
                      >
                        <Phone className="h-3 w-3" /> {supplier.mobile}
                      </a>
                      <a
                        href={`https://wa.me/${supplier.mobile.replace(/\D/g, "").replace(/^0/, "94")}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-green-400 hover:text-green-300"
                      >
                        <MessageCircle className="h-3 w-3" /> WhatsApp
                      </a>
                    </div>
                    <p className="text-xs text-gray-600 mt-2">
                      Last supply: {formatDate(supplier.lastSupplyAt)}
                      {supplier.isActive === false && " · inactive"}
                    </p>
                    {supplier.notes && <p className="text-xs text-gray-500 mt-1.5">{supplier.notes}</p>}
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {canRecordSupply && supplier.isActive !== false && (
                      <button
                        onClick={() => navigate(`/suppliers/supply?supplierId=${supplier.id}`)}
                        title="Record a supply from this supplier"
                        className="p-1.5 text-gray-500 hover:text-[#F97316] transition rounded-lg hover:bg-white/5"
                      >
                        <PackagePlus className="h-4 w-4" />
                      </button>
                    )}
                    {canEdit && (
                      <>
                        <button
                          onClick={() => { setFormTarget(supplier); setFormOpen(true); }}
                          title="Edit"
                          className="p-1.5 text-gray-500 hover:text-white transition rounded-lg hover:bg-white/5"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => toggleActive(supplier)}
                          title={supplier.isActive === false ? "Reactivate" : "Deactivate"}
                          className="p-1.5 text-gray-500 hover:text-amber-400 transition rounded-lg hover:bg-amber-500/5"
                        >
                          <Power className="h-4 w-4" />
                        </button>
                      </>
                    )}
                    {canDelete && (
                      <button
                        onClick={() => setDeleteTarget(supplier)}
                        title="Delete"
                        className="p-1.5 text-gray-500 hover:text-red-400 transition rounded-lg hover:bg-red-500/5"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {formOpen && (
        <SupplierFormModal
          centerId={centerId}
          existing={formTarget}
          onClose={() => { setFormOpen(false); setFormTarget(null); }}
        />
      )}

      {deleteTarget && (
        <DeleteModal
          supplier={deleteTarget}
          centerId={centerId}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
