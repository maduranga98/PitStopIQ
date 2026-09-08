// Service catalog — set up per vehicle type, without opening a job card.
//
// The catalog is organised the way a workshop actually thinks about it: pick a
// vehicle type, then list what you do for it and what it costs. Not every
// service fits every vehicle — a bike has no wheel alignment, a lorry has no
// interior valet — so a service priced under "car" is only offered when a car
// is being serviced. The "All vehicle types" tab holds the general prices that
// apply to everything.
//
// Storage shape (unchanged): one `servicePrices` document per (service,
// vehicle type) pair. Documents that share a `name` are the same service; the
// one with no `vehicleType` is the general fallback.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, query, orderBy, onSnapshot, doc, getDoc, arrayUnion, arrayRemove, Timestamp,
} from "firebase/firestore";
import {
  ArrowLeft, Plus, Tag, Search, Pencil, Trash2, X, AlertTriangle, Check, Car, Copy,
} from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import PageHeader from "../../components/layout/PageHeader";
import { LoadingBlock } from "../../components/LoadingProgress";
import { safeAddDoc, safeUpdateDoc, safeDeleteDoc, safeSetDoc } from "../../lib/firestoreWrite";
import { DEFAULT_VEHICLE_TYPES, withoutHiddenTypes } from "../../lib/vehicleOptions";
import { catalogPrice, vehicleTypeLabel } from "../../lib/servicePricing";
import type { ServicePriceItem } from "../../types/auth";

function formatMoney(n: number): string {
  return n.toLocaleString("en-LK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export default function ServiceCatalogPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const centerId = currentUser?.centerId;

  const canCreate = usePermission("serviceLibrary.create");
  const canEdit = usePermission("serviceLibrary.edit");
  const canDelete = usePermission("serviceLibrary.delete");

  const [items, setItems] = useState<ServicePriceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [customTypes, setCustomTypes] = useState<string[]>([]);
  // "" = the general "All vehicle types" price list.
  const [activeType, setActiveType] = useState("");
  const [search, setSearch] = useState("");

  // Add row
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  // Inline edit
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Price drafts for services the catalog already knows but this vehicle type
  // has no price for, keyed by service name.
  const [reuseDrafts, setReuseDrafts] = useState<Record<string, string>>({});
  const [reuseBusy, setReuseBusy] = useState<string | null>(null);

  const [deleting, setDeleting] = useState<ServicePriceItem | null>(null);
  const [showAddType, setShowAddType] = useState(false);
  const [newType, setNewType] = useState("");
  const [typeError, setTypeError] = useState("");

  // Vehicle type removal. A built-in type can't be taken out of the shared
  // defaults list, so it is hidden for this center instead; adding it back
  // simply unhides it.
  const [hiddenTypes, setHiddenTypes] = useState<string[]>([]);
  const [deletingType, setDeletingType] = useState<string | null>(null);
  const [typeBusy, setTypeBusy] = useState(false);
  const [typeDeleteError, setTypeDeleteError] = useState("");

  // Live catalog — small collection, and an edit here should show up at once.
  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(
      query(collection(db, "servicecenters", centerId, "servicePrices"), orderBy("name")),
      (snap) => {
        setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ServicePriceItem)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [centerId]);

  // The center's own vehicle types, on top of the built-in list.
  useEffect(() => {
    if (!centerId) return;
    let active = true;
    getDoc(doc(db, "servicecenters", centerId)).then((snap) => {
      if (!active) return;
      const c = snap.data() as { customVehicleTypes?: string[]; hiddenVehicleTypes?: string[] } | undefined;
      setCustomTypes(c?.customVehicleTypes ?? []);
      setHiddenTypes(c?.hiddenVehicleTypes ?? []);
    }).catch(() => { /* non-fatal — the defaults still work */ });
    return () => { active = false; };
  }, [centerId]);

  // Every type worth a tab: the defaults, the center's own, and anything the
  // catalog is already priced for (a type that was later renamed away).
  const vehicleTypes = useMemo(() => {
    const set = new Set<string>([...DEFAULT_VEHICLE_TYPES, ...customTypes]);
    items.forEach((i) => { if (i.vehicleType) set.add(i.vehicleType); });
    return withoutHiddenTypes(set, hiddenTypes);
  }, [customTypes, hiddenTypes, items]);

  const countFor = (type: string) => items.filter((i) => (i.vehicleType ?? "") === type).length;

  // Any real type can go; "All vehicle types" is the general list, not a type.
  const isRemovable = (type: string) => !!type;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((i) => (i.vehicleType ?? "") === activeType)
      .filter((i) => !q || i.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, activeType, search]);

  // A service added under one vehicle type stays in the catalog for all of
  // them: switch tabs and it is waiting here, needing only a price. That saves
  // retyping "Body Wash" once per vehicle type, and keeps one name — not five
  // near-identical ones — flowing through job cards and invoices.
  const unpricedHere = useMemo(() => {
    const q = search.trim().toLowerCase();
    const priced = new Set(
      items.filter((i) => (i.vehicleType ?? "") === activeType).map((i) => i.name.toLowerCase()),
    );
    return Array.from(new Set(items.map((i) => i.name)))
      .filter((name) => !priced.has(name.toLowerCase()))
      .filter((name) => !q || name.toLowerCase().includes(q))
      .sort((a, b) => a.localeCompare(b));
  }, [items, activeType, search]);

  async function priceExisting(name: string) {
    if (!centerId) return;
    const raw = (reuseDrafts[name] ?? "").trim();
    const price = Number(raw);
    if (!raw || !Number.isFinite(price) || price < 0) {
      setError(`Enter a valid price for “${name}”`); return;
    }
    setError("");
    setReuseBusy(name);
    try {
      await safeAddDoc(collection(db, "servicecenters", centerId, "servicePrices"), {
        name,
        defaultPrice: price,
        price,
        centerId,
        createdAt: Timestamp.now(),
        ...(activeType ? { vehicleType: activeType } : {}),
      });
      setReuseDrafts((prev) => { const next = { ...prev }; delete next[name]; return next; });
    } catch {
      setError("Could not save. Check your connection and try again.");
    } finally {
      setReuseBusy(null);
    }
  }

  function switchType(type: string) {
    setActiveType(type);
    setEditId(null);
    setError("");
    setNewName("");
    setNewPrice("");
    setReuseDrafts({});
  }

  async function addService() {
    if (!centerId) return;
    const name = newName.trim();
    const price = Number(newPrice.trim());
    if (!name) { setError("Enter a service name"); return; }
    if (!newPrice.trim() || !Number.isFinite(price) || price < 0) {
      setError("Enter a valid price"); return;
    }
    if (items.some((i) => (i.vehicleType ?? "") === activeType && i.name.toLowerCase() === name.toLowerCase())) {
      setError(`“${name}” is already priced for ${vehicleTypeLabel(activeType)}`); return;
    }
    setError("");
    setAdding(true);
    try {
      // Both price fields are written so readers on either the current
      // `defaultPrice` or the legacy `price` stay consistent.
      await safeAddDoc(collection(db, "servicecenters", centerId, "servicePrices"), {
        name,
        defaultPrice: price,
        price,
        centerId,
        createdAt: Timestamp.now(),
        ...(activeType ? { vehicleType: activeType } : {}),
      });
      setNewName("");
      setNewPrice("");
    } catch {
      setError("Could not save. Check your connection and try again.");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(item: ServicePriceItem) {
    setEditId(item.id);
    setEditName(item.name);
    setEditPrice(String(catalogPrice(item)));
    setError("");
  }

  async function saveEdit(item: ServicePriceItem) {
    if (!centerId) return;
    const name = editName.trim();
    const price = Number(editPrice.trim());
    if (!name) { setError("Enter a service name"); return; }
    if (!editPrice.trim() || !Number.isFinite(price) || price < 0) {
      setError("Enter a valid price"); return;
    }
    const clash = items.some(
      (i) => i.id !== item.id
        && (i.vehicleType ?? "") === activeType
        && i.name.toLowerCase() === name.toLowerCase(),
    );
    if (clash) { setError(`“${name}” is already priced for ${vehicleTypeLabel(activeType)}`); return; }
    setError("");
    setBusyId(item.id);
    try {
      await safeUpdateDoc(
        doc(db, "servicecenters", centerId, "servicePrices", item.id),
        { name, defaultPrice: price, price },
      );
      setEditId(null);
    } catch {
      setError("Could not save. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeItem(item: ServicePriceItem) {
    if (!centerId) return;
    setBusyId(item.id);
    try {
      await safeDeleteDoc(doc(db, "servicecenters", centerId, "servicePrices", item.id));
      setDeleting(null);
    } finally {
      setBusyId(null);
    }
  }

  async function addVehicleType() {
    if (!centerId) return;
    const type = newType.trim().toLowerCase();
    if (!type) { setTypeError("Enter a vehicle type"); return; }
    if (vehicleTypes.some((t) => t.toLowerCase() === type)) {
      setTypeError("That vehicle type already exists"); return;
    }
    setTypeError("");
    try {
      // Stored on the center so the vehicle form offers it too.
      await safeSetDoc(
        doc(db, "servicecenters", centerId),
        { customVehicleTypes: arrayUnion(type), hiddenVehicleTypes: arrayRemove(type) },
        { merge: true },
      );
      setCustomTypes((prev) => [...prev, type]);
      setHiddenTypes((prev) => prev.filter((t) => t.trim().toLowerCase() !== type));
      setShowAddType(false);
      setNewType("");
      switchType(type);
    } catch {
      setTypeError("Could not add the vehicle type. Try again.");
    }
  }

  // Removing a type also removes what was priced under it: those documents
  // are keyed by (service, vehicle type), so leaving them behind would keep
  // the tab alive and keep offering the services on job cards. Jobs and
  // invoices already raised keep their own copies of name and amount.
  async function removeVehicleType(type: string) {
    if (!centerId || !isRemovable(type)) return;
    setTypeDeleteError("");
    setTypeBusy(true);
    try {
      const priced = items.filter((i) => (i.vehicleType ?? "") === type);
      await Promise.all(
        priced.map((i) => safeDeleteDoc(doc(db, "servicecenters", centerId, "servicePrices", i.id))),
      );
      // Dropped from the center's own list and hidden, so a built-in type
      // stays gone too rather than returning from the shared defaults.
      await safeSetDoc(
        doc(db, "servicecenters", centerId),
        { customVehicleTypes: arrayRemove(type), hiddenVehicleTypes: arrayUnion(type) },
        { merge: true },
      );
      setCustomTypes((prev) => prev.filter((t) => t !== type));
      setHiddenTypes((prev) => Array.from(new Set([...prev, type])));
      setDeletingType(null);
      if (activeType === type) switchType("");
    } catch {
      setTypeDeleteError("Could not remove the vehicle type. Check your connection and try again.");
    } finally {
      setTypeBusy(false);
    }
  }

  const typeLabel = vehicleTypeLabel(activeType);

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<Tag className="w-5 h-5" />}
        title="Service Catalog"
        actions={
          <button
            onClick={() => navigate("/services")}
            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white px-3 py-2 rounded-lg text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Jobs</span>
          </button>
        }
        below={
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => switchType("")}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5 ${
                  activeType === ""
                    ? "bg-orange-500 border-orange-500 text-white"
                    : "bg-white/5 border-white/10 text-gray-300 hover:border-white/30"
                }`}
              >
                All vehicle types
                {countFor("") > 0 && (
                  <span className={`text-[10px] px-1.5 rounded-full ${activeType === "" ? "bg-white/25" : "bg-white/10"}`}>
                    {countFor("")}
                  </span>
                )}
              </button>
              {vehicleTypes.map((vt) => {
                const active = activeType === vt;
                const removable = canDelete && isRemovable(vt);
                return (
                  <span
                    key={vt}
                    className={`text-xs rounded-full border transition-colors flex items-center ${
                      active
                        ? "bg-orange-500 border-orange-500 text-white"
                        : "bg-white/5 border-white/10 text-gray-300 hover:border-white/30"
                    }`}
                  >
                    <button
                      onClick={() => switchType(vt)}
                      className={`px-3 py-1.5 capitalize flex items-center gap-1.5 ${removable ? "pr-1.5" : ""}`}
                    >
                      {vt}
                      {countFor(vt) > 0 && (
                        <span className={`text-[10px] px-1.5 rounded-full ${active ? "bg-white/25" : "bg-white/10"}`}>
                          {countFor(vt)}
                        </span>
                      )}
                    </button>
                    {removable && (
                      <button
                        onClick={() => { setDeletingType(vt); setTypeDeleteError(""); }}
                        title={`Remove ${vt}`}
                        aria-label={`Remove vehicle type ${vt}`}
                        className={`pl-1 pr-2.5 py-1.5 rounded-r-full transition-colors ${
                          active ? "text-white/70 hover:text-white" : "text-gray-500 hover:text-red-400"
                        }`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                );
              })}
              {canCreate && (
                <button
                  onClick={() => { setShowAddType(true); setTypeError(""); }}
                  className="text-xs px-3 py-1.5 rounded-full border border-dashed border-white/20 text-gray-400 hover:text-orange-300 hover:border-orange-500/50 transition-colors flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  Vehicle type
                </button>
              )}
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                placeholder={`Search services for ${typeLabel.toLowerCase()}…`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-white/5 border border-white/10 text-white rounded-lg text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>
        }
      />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm text-gray-400">
            Services for <span className="text-white font-medium capitalize">{typeLabel}</span>
          </h2>
          <span className="text-xs text-gray-500">
            {rows.length} {rows.length === 1 ? "service" : "services"}
          </span>
        </div>

        {/* Add: service name + price. Nothing else. */}
        {canCreate && (
          <div className="bg-[#162032] border border-white/10 rounded-xl p-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                placeholder="Service name — e.g. Oil Change"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addService(); }}
                className="flex-1 bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
              />
              <div className="flex gap-2">
                <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg pl-3 focus-within:border-orange-500 flex-1 sm:flex-none">
                  <span className="text-[11px] text-gray-500">LKR</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Price"
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addService(); }}
                    className="no-spinner w-24 bg-transparent text-white px-2 py-2 text-sm text-right focus:outline-none"
                  />
                </div>
                <button
                  onClick={addService}
                  disabled={adding}
                  className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 whitespace-nowrap flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  {adding ? "Adding…" : "Add"}
                </button>
              </div>
            </div>
            {error
              ? <p className="text-xs text-red-400 mt-2">{error}</p>
              : (
                <p className="text-[11px] text-gray-500 mt-2">
                  {activeType
                    ? `Priced for ${activeType} — switch tabs to price the same service for another vehicle type, no retyping.`
                    : "Offered for every vehicle, unless that vehicle type has its own price."}
                </p>
              )}
          </div>
        )}

        {loading ? (
          <LoadingBlock className="py-16" />
        ) : rows.length === 0 && unpricedHere.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <Tag className="w-10 h-10 text-gray-600 mb-3" />
            <p className="text-gray-400 font-medium">
              {search ? "No services match your search" : `No services priced for ${typeLabel.toLowerCase()} yet`}
            </p>
            <p className="text-gray-600 text-sm mt-1 max-w-sm">
              {search
                ? "Try a different search term."
                : "Add a service name and its price above. It will show up on job cards for this vehicle type."}
            </p>
          </div>
        ) : rows.length === 0 ? null : (
          <div className="bg-[#162032] border border-white/10 rounded-xl divide-y divide-white/5 overflow-hidden">
            {rows.map((item) => {
              const busy = busyId === item.id;
              if (editId === item.id) {
                return (
                  <div key={item.id} className="flex flex-col sm:flex-row gap-2 p-3 bg-orange-500/[0.06]">
                    <input
                      type="text"
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveEdit(item); if (e.key === "Escape") setEditId(null); }}
                      className="flex-1 bg-[#0B1120] border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                    />
                    <div className="flex gap-2">
                      <div className="flex items-center gap-1 bg-[#0B1120] border border-white/10 rounded-lg pl-3 focus-within:border-orange-500 flex-1 sm:flex-none">
                        <span className="text-[11px] text-gray-500">LKR</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(item); if (e.key === "Escape") setEditId(null); }}
                          className="no-spinner w-24 bg-transparent text-white px-2 py-2 text-sm text-right focus:outline-none"
                        />
                      </div>
                      <button
                        onClick={() => saveEdit(item)}
                        disabled={busy}
                        className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-1"
                      >
                        <Check className="w-4 h-4" />
                        {busy ? "…" : "Save"}
                      </button>
                      <button
                        onClick={() => setEditId(null)}
                        className="text-gray-400 hover:text-white px-2 py-2 rounded-lg hover:bg-white/5"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors">
                  <span className="flex-1 text-sm text-white truncate">{item.name}</span>
                  <span className="text-sm font-semibold text-white whitespace-nowrap">
                    <span className="text-[10px] text-gray-500 mr-1">LKR</span>
                    {formatMoney(catalogPrice(item))}
                  </span>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    {canEdit && (
                      <button
                        onClick={() => startEdit(item)}
                        title="Edit"
                        className="text-gray-500 hover:text-orange-400 p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        onClick={() => setDeleting(item)}
                        title="Delete"
                        className="text-gray-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Services the catalog already knows, waiting on a price for this
            type. One field, one click — no retyping the name per vehicle. */}
        {!loading && canCreate && unpricedHere.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2 mt-6">
              <Copy className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
              <h3 className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                Already in your catalog
              </h3>
              <span className="text-[11px] text-gray-600">
                — set a price to offer {activeType ? `it for ${activeType}` : "it for every vehicle"}
              </span>
            </div>
            <div className="bg-[#162032]/60 border border-dashed border-white/10 rounded-xl divide-y divide-white/5 overflow-hidden">
              {unpricedHere.map((name) => {
                const draft = reuseDrafts[name] ?? "";
                const busy = reuseBusy === name;
                return (
                  <div key={name} className="flex items-center gap-2 px-4 py-2.5">
                    <span className="flex-1 text-sm text-gray-400 truncate">{name}</span>
                    <div className="flex items-center gap-1 bg-[#0B1120] border border-white/10 rounded-lg pl-2.5 focus-within:border-orange-500">
                      <span className="text-[11px] text-gray-500">LKR</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Price"
                        value={draft}
                        onChange={(e) => setReuseDrafts((prev) => ({ ...prev, [name]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") priceExisting(name); }}
                        className="no-spinner w-24 bg-transparent text-white px-2 py-1.5 text-sm text-right focus:outline-none"
                      />
                    </div>
                    <button
                      onClick={() => priceExisting(name)}
                      disabled={busy || draft.trim() === ""}
                      className="bg-white/5 hover:bg-orange-500 border border-white/10 hover:border-orange-500 text-gray-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 disabled:hover:bg-white/5 disabled:hover:text-gray-300 disabled:hover:border-white/10 transition-colors flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {busy ? "…" : "Add"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Add vehicle type */}
      {showAddType && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 max-w-sm w-full space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center flex-shrink-0">
                <Car className="w-5 h-5 text-orange-400" />
              </div>
              <div>
                <h3 className="font-bold text-white leading-tight">Add Vehicle Type</h3>
                <p className="text-xs text-gray-400 mt-0.5">Also offered when registering a vehicle.</p>
              </div>
            </div>
            <input
              type="text"
              autoFocus
              placeholder="e.g. three wheeler"
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addVehicleType(); }}
              className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
            />
            {typeError && <p className="text-xs text-red-400">{typeError}</p>}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowAddType(false); setNewType(""); setTypeError(""); }}
                className="px-4 py-2 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={addVehicleType}
                className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove vehicle type */}
      {deletingType && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 max-w-sm w-full space-y-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0" />
              <h3 className="font-semibold text-white">
                Remove “<span className="capitalize">{deletingType}</span>”?
              </h3>
            </div>
            <p className="text-sm text-gray-300">
              {countFor(deletingType) > 0
                ? `Its ${countFor(deletingType)} priced ${countFor(deletingType) === 1 ? "service" : "services"} will be deleted too, and it will no longer be offered when registering a vehicle.`
                : "It will no longer be offered when registering a vehicle."}
              {" "}Vehicles already registered as this type keep it, and jobs and invoices keep the amounts they were billed at. You can add the type back later.
            </p>
            {typeDeleteError && <p className="text-xs text-red-400">{typeDeleteError}</p>}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setDeletingType(null); setTypeDeleteError(""); }}
                disabled={typeBusy}
                className="px-4 py-2 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-white/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => removeVehicleType(deletingType)}
                disabled={typeBusy}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500 hover:bg-red-600 text-white disabled:opacity-50"
              >
                {typeBusy ? "Removing…" : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleting && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 max-w-sm w-full space-y-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0" />
              <h3 className="font-semibold text-white">Delete “{deleting.name}”?</h3>
            </div>
            <p className="text-sm text-gray-300">
              It will no longer be offered for <span className="capitalize">{vehicleTypeLabel(deleting.vehicleType).toLowerCase()}</span>.
              Jobs and invoices already created keep the amounts they were billed at.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleting(null)}
                disabled={busyId === deleting.id}
                className="px-4 py-2 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-white/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => removeItem(deleting)}
                disabled={busyId === deleting.id}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500 hover:bg-red-600 text-white disabled:opacity-50"
              >
                {busyId === deleting.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
