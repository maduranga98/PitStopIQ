// Standalone service catalog manager.
//
// The service catalog used to be editable only from inside the New Service
// wizard, which meant an owner had to start a job card just to correct a
// price. This page is the same catalog on its own route: add a service,
// rename it, re-price it per vehicle type, or delete it outright — with no
// job involved.
//
// Storage shape (unchanged): one `servicePrices` document per (service,
// vehicle type) pair. Documents that share a `name` are the same service;
// the one with no `vehicleType` is the general "All vehicle types" fallback.
// Descriptive fields (description / category / unit) belong to the service as
// a whole, so a save mirrors them onto every document of that name.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, query, orderBy, onSnapshot, doc, getDoc, Timestamp, deleteField,
} from "firebase/firestore";
import {
  ArrowLeft, Plus, Tag, Search, Pencil, Trash2, X, AlertTriangle, Layers,
} from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import PageHeader from "../../components/layout/PageHeader";
import { LoadingBlock } from "../../components/LoadingProgress";
import { safeAddDoc, safeUpdateDoc, safeDeleteDoc } from "../../lib/firestoreWrite";
import { DEFAULT_VEHICLE_TYPES } from "../../lib/vehicleOptions";
import { catalogPrice, vehicleTypeLabel } from "../../lib/servicePricing";
import type {
  ServicePriceItem, ServiceLibraryCategory, ServiceLibraryUnit,
} from "../../types/auth";

const CATEGORIES: ServiceLibraryCategory[] = [
  "Engine", "Brakes", "Tyres", "Suspension", "Electrical", "Body", "AC", "General", "Other",
];

const UNITS: ServiceLibraryUnit[] = ["per service", "per litre", "per item", "per hour"];

/** Colour per category so a long catalog stays scannable at a glance. */
const CATEGORY_CHIP: Record<ServiceLibraryCategory, string> = {
  Engine:     "bg-orange-500/15 text-orange-300 border-orange-500/30",
  Brakes:     "bg-red-500/15 text-red-300 border-red-500/30",
  Tyres:      "bg-slate-500/20 text-slate-300 border-slate-500/30",
  Suspension: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  Electrical: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Body:       "bg-blue-500/15 text-blue-300 border-blue-500/30",
  AC:         "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  General:    "bg-green-500/15 text-green-300 border-green-500/30",
  Other:      "bg-white/10 text-gray-300 border-white/20",
};

/** One service — its descriptive fields plus every price row that shares the name. */
type CatalogService = {
  name: string;
  description?: string;
  category?: ServiceLibraryCategory;
  unit?: ServiceLibraryUnit;
  entries: ServicePriceItem[];
};

/** "" is the key for the general (no vehicle type) price. */
type PriceDrafts = Record<string, string>;

function formatMoney(n: number): string {
  return n.toLocaleString("en-LK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Collapse the flat price documents into one row per service name. */
function groupCatalog(items: ServicePriceItem[]): CatalogService[] {
  const byName = new Map<string, CatalogService>();
  for (const item of items) {
    let svc = byName.get(item.name);
    if (!svc) {
      svc = { name: item.name, entries: [] };
      byName.set(item.name, svc);
    }
    svc.entries.push(item);
    // Descriptive fields are mirrored across a service's documents, but an
    // entry written by the older job-flow editor carries none — so take the
    // first value that is actually set rather than whichever sorted first.
    svc.description ??= item.description;
    svc.category ??= item.category;
    svc.unit ??= item.unit;
  }
  const services = Array.from(byName.values());
  for (const svc of services) {
    svc.entries.sort((a, b) => (a.vehicleType ?? "").localeCompare(b.vehicleType ?? ""));
  }
  return services.sort((a, b) => a.name.localeCompare(b.name));
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
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | ServiceLibraryCategory>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | string>("all");
  const [vehicleTypes, setVehicleTypes] = useState<string[]>(DEFAULT_VEHICLE_TYPES);

  // Editor: null = closed, { name: null } = adding a new service.
  const [editing, setEditing] = useState<CatalogService | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<CatalogService | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Live catalog — small collection, and an edit here should show up
  // immediately without a manual refresh.
  useEffect(() => {
    if (!centerId) return;
    const q = query(
      collection(db, "servicecenters", centerId, "servicePrices"),
      orderBy("name"),
    );
    return onSnapshot(q, (snap) => {
      setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ServicePriceItem)));
      setLoading(false);
    }, () => setLoading(false));
  }, [centerId]);

  // Vehicle types offered in the editor: the built-in list, the center's own
  // custom types, and any type the catalog is already priced for. Deliberately
  // does NOT scan the vehicles collection — that read is expensive and the
  // catalog only needs the types an owner can actually pick.
  useEffect(() => {
    if (!centerId) return;
    let active = true;
    getDoc(doc(db, "servicecenters", centerId)).then((snap) => {
      if (!active) return;
      const custom = (snap.data() as { customVehicleTypes?: string[] } | undefined)?.customVehicleTypes ?? [];
      setVehicleTypes((prev) => Array.from(new Set([...prev, ...custom])).sort());
    }).catch(() => { /* non-fatal — the defaults still work */ });
    return () => { active = false; };
  }, [centerId]);

  const services = useMemo(() => groupCatalog(items), [items]);

  // Types the editor offers = configured types + anything already priced.
  const editorTypes = useMemo(() => {
    const set = new Set<string>(vehicleTypes);
    items.forEach((i) => { if (i.vehicleType) set.add(i.vehicleType); });
    return Array.from(set).sort();
  }, [vehicleTypes, items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return services.filter((s) => {
      if (categoryFilter !== "all" && s.category !== categoryFilter) return false;
      if (typeFilter !== "all" && !s.entries.some((e) => (e.vehicleType ?? "") === typeFilter)) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q) ||
        (s.category ?? "").toLowerCase().includes(q)
      );
    });
  }, [services, search, categoryFilter, typeFilter]);

  // Categories that actually appear, so the filter bar never offers a dead end.
  const usedCategories = useMemo(() => {
    const set = new Set<ServiceLibraryCategory>();
    services.forEach((s) => { if (s.category) set.add(s.category); });
    return CATEGORIES.filter((c) => set.has(c));
  }, [services]);

  const priceCount = items.length;

  const closeEditor = useCallback(() => { setEditing(null); setAdding(false); }, []);

  async function deleteService(svc: CatalogService) {
    if (!centerId) return;
    setDeleteBusy(true);
    try {
      await Promise.all(svc.entries.map((e) =>
        safeDeleteDoc(doc(db, "servicecenters", centerId, "servicePrices", e.id)),
      ));
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<Tag className="w-5 h-5" />}
        title="Service Catalog"
        actions={
          <>
            <button
              onClick={() => navigate("/services")}
              className="hidden sm:flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white px-3 py-2 rounded-lg text-sm transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Jobs
            </button>
            {canCreate && (
              <button
                onClick={() => { setEditing(null); setAdding(true); }}
                className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Service
              </button>
            )}
          </>
        }
        below={
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-3 flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                placeholder="Search services…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-3 py-1.5 bg-white/5 border border-white/10 text-white rounded-lg text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500 w-56"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as "all" | ServiceLibraryCategory)}
              className="bg-white/5 border border-white/10 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-orange-500"
            >
              <option value="all" className="bg-[#0B1120]">All categories</option>
              {usedCategories.map((c) => (
                <option key={c} value={c} className="bg-[#0B1120]">{c}</option>
              ))}
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="bg-white/5 border border-white/10 text-white rounded-lg px-3 py-1.5 text-sm capitalize focus:outline-none focus:border-orange-500"
            >
              <option value="all" className="bg-[#0B1120]">All vehicle types</option>
              <option value="" className="bg-[#0B1120]">General price only</option>
              {editorTypes.map((vt) => (
                <option key={vt} value={vt} className="bg-[#0B1120]">{vt}</option>
              ))}
            </select>
            <span className="text-xs text-gray-500 ml-auto">
              {services.length} {services.length === 1 ? "service" : "services"} · {priceCount} {priceCount === 1 ? "price" : "prices"}
            </span>
          </div>
        }
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {loading ? (
          <LoadingBlock className="py-20" />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <Layers className="w-12 h-12 text-gray-600 mb-4" />
            <p className="text-gray-400 font-medium">
              {services.length === 0 ? "No services in the catalog yet" : "No services match your filters"}
            </p>
            <p className="text-gray-600 text-sm mt-1 max-w-sm">
              {services.length === 0
                ? "Add a service and price it per vehicle type — job cards and invoices pick the price up automatically."
                : "Try a different search term or clear the filters."}
            </p>
            {services.length === 0 && canCreate && (
              <button
                onClick={() => setAdding(true)}
                className="mt-5 flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                Add Service
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((svc) => (
              <div
                key={svc.name}
                className="bg-[#162032] border border-white/10 rounded-xl p-4 flex flex-col gap-3 hover:border-orange-500/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-white truncate">{svc.name}</h3>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {svc.category && (
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${CATEGORY_CHIP[svc.category]}`}>
                          {svc.category}
                        </span>
                      )}
                      {svc.unit && (
                        <span className="text-[10px] text-gray-500">{svc.unit}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {canEdit && (
                      <button
                        onClick={() => { setAdding(false); setEditing(svc); }}
                        title="Edit service"
                        className="text-gray-400 hover:text-orange-400 p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        onClick={() => setDeleting(svc)}
                        title="Delete service"
                        className="text-gray-400 hover:text-red-400 p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {svc.description && (
                  <p className="text-xs text-gray-400 line-clamp-2">{svc.description}</p>
                )}

                <div className="mt-auto space-y-1.5">
                  {svc.entries.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center justify-between gap-2 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5"
                    >
                      <span className="text-xs text-gray-300 capitalize truncate">
                        {vehicleTypeLabel(e.vehicleType)}
                      </span>
                      <span className="text-sm font-semibold text-white whitespace-nowrap">
                        <span className="text-[10px] text-gray-500 mr-1">LKR</span>
                        {formatMoney(catalogPrice(e))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {(adding || editing) && centerId && (
        <ServiceEditorModal
          centerId={centerId}
          service={editing}
          existingNames={services.map((s) => s.name)}
          vehicleTypes={editorTypes}
          onClose={closeEditor}
        />
      )}

      {deleting && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 max-w-sm w-full space-y-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0" />
              <h3 className="font-semibold text-white">Delete “{deleting.name}”?</h3>
            </div>
            <p className="text-sm text-gray-300">
              This removes {deleting.entries.length} {deleting.entries.length === 1 ? "price" : "prices"} for
              this service. Jobs and invoices already created keep the amounts they were billed at.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleting(null)}
                disabled={deleteBusy}
                className="px-4 py-2 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-white/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteService(deleting)}
                disabled={deleteBusy}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500 hover:bg-red-600 text-white disabled:opacity-50"
              >
                {deleteBusy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Add / edit modal ─────────────────────────────────────────────────────────
// One form for both cases. `service` is null when adding. Saving diffs the
// price drafts against the service's existing documents: a filled field that
// has no document creates one, a changed field updates, and a cleared field
// deletes that vehicle type's price.
function ServiceEditorModal({
  centerId, service, existingNames, vehicleTypes, onClose,
}: {
  centerId: string;
  service: CatalogService | null;
  existingNames: string[];
  vehicleTypes: string[];
  onClose: () => void;
}) {
  const isNew = service == null;

  const [name, setName] = useState(service?.name ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [category, setCategory] = useState<ServiceLibraryCategory | "">(service?.category ?? "");
  const [unit, setUnit] = useState<ServiceLibraryUnit | "">(service?.unit ?? "");
  const [drafts, setDrafts] = useState<PriceDrafts>(() => {
    const seed: PriceDrafts = {};
    service?.entries.forEach((e) => { seed[e.vehicleType ?? ""] = String(catalogPrice(e)); });
    return seed;
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Every type the form shows a field for: the general price, the configured
  // types, and any type this service is already priced for.
  const rows = useMemo(() => {
    const set = new Set<string>(["", ...vehicleTypes]);
    service?.entries.forEach((e) => set.add(e.vehicleType ?? ""));
    return Array.from(set).sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
  }, [vehicleTypes, service]);

  const entryFor = useCallback(
    (type: string) => service?.entries.find((e) => (e.vehicleType ?? "") === type),
    [service],
  );

  const filledCount = rows.filter((t) => (drafts[t] ?? "").trim() !== "").length;

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) { setError("Service name is required"); return; }
    const clash = existingNames.some(
      (n) => n.toLowerCase() === trimmed.toLowerCase() && n !== service?.name,
    );
    if (clash) { setError("Another service already uses that name"); return; }

    // Validate every filled price before touching Firestore, so a typo can't
    // leave the service half-written.
    const parsed = new Map<string, number>();
    for (const type of rows) {
      const raw = (drafts[type] ?? "").trim();
      if (raw === "") continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) {
        setError(`Enter a valid price for ${vehicleTypeLabel(type)}`);
        return;
      }
      parsed.set(type, value);
    }
    if (parsed.size === 0) {
      setError("Set a price for at least one vehicle type");
      return;
    }

    setError("");
    setSaving(true);
    try {
      // Descriptive fields belong to the service, not to one price row, so
      // every document of this name carries the same values. Clearing one has
      // to remove the field outright — Firestore rejects `undefined`, and
      // leaving the old value behind would resurrect it on the next read.
      const metaForAdd = {
        name: trimmed,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(category ? { category } : {}),
        ...(unit ? { unit } : {}),
      };
      const metaForUpdate = {
        name: trimmed,
        description: description.trim() || deleteField(),
        category: category || deleteField(),
        unit: unit || deleteField(),
      };
      const writes: Promise<unknown>[] = [];
      for (const type of rows) {
        const existing = entryFor(type);
        const value = parsed.get(type);
        if (value === undefined) {
          // Cleared — drop this vehicle type's price if it had one.
          if (existing) {
            writes.push(safeDeleteDoc(doc(db, "servicecenters", centerId, "servicePrices", existing.id)));
          }
          continue;
        }
        if (existing) {
          // Mirror both price fields so readers on either the current
          // `defaultPrice` or the legacy `price` stay consistent.
          writes.push(safeUpdateDoc(
            doc(db, "servicecenters", centerId, "servicePrices", existing.id),
            { ...metaForUpdate, defaultPrice: value, price: value },
          ));
        } else {
          writes.push(safeAddDoc(collection(db, "servicecenters", centerId, "servicePrices"), {
            ...metaForAdd,
            defaultPrice: value,
            price: value,
            centerId,
            createdAt: Timestamp.now(),
            ...(type ? { vehicleType: type } : {}),
          }));
        }
      }
      await Promise.all(writes);
      onClose();
    } catch {
      setError("Could not save the service. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#162032] border border-white/10 rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col shadow-2xl">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center flex-shrink-0">
              <Tag className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <h3 className="font-bold text-white leading-tight">
                {isNew ? "Add Service" : "Edit Service"}
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Price it per vehicle type — a bike and a lorry can differ.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 -mr-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className="block text-[11px] text-gray-500 uppercase tracking-wider font-semibold mb-1.5">
              Service Name
            </label>
            <input
              type="text"
              autoFocus
              placeholder="e.g. Oil Change"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
            />
            {!isNew && name.trim() !== service?.name && name.trim() !== "" && (
              <p className="text-[11px] text-amber-400/90 mt-1">
                Renaming updates all {service?.entries.length} prices for this service.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider font-semibold mb-1.5">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ServiceLibraryCategory | "")}
                className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
              >
                <option value="" className="bg-[#0B1120]">None</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c} className="bg-[#0B1120]">{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider font-semibold mb-1.5">
                Unit
              </label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value as ServiceLibraryUnit | "")}
                className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
              >
                <option value="" className="bg-[#0B1120]">None</option>
                {UNITS.map((u) => (
                  <option key={u} value={u} className="bg-[#0B1120]">{u}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-gray-500 uppercase tracking-wider font-semibold mb-1.5">
              Description <span className="normal-case tracking-normal text-gray-600">(optional)</span>
            </label>
            <textarea
              rows={2}
              placeholder="What the job includes…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm placeholder-gray-500 resize-none focus:outline-none focus:border-orange-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold">Prices</span>
              <span className="text-[11px] text-gray-500">
                {filledCount} {filledCount === 1 ? "type" : "types"} priced
              </span>
            </div>
            <div className="space-y-2">
              {rows.map((type) => {
                const existing = entryFor(type);
                const value = drafts[type] ?? "";
                return (
                  <div
                    key={type || "__general"}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 border transition-colors ${
                      value.trim() !== ""
                        ? "bg-orange-500/[0.07] border-orange-500/30"
                        : "bg-white/5 border-white/10"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white capitalize truncate">
                        {vehicleTypeLabel(type)}
                      </div>
                      {type === "" && (
                        <div className="text-[10px] text-gray-500">
                          Fallback when a vehicle's type has no price
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 bg-[#0B1120] border border-white/10 rounded-lg pl-2 focus-within:border-orange-500">
                      <span className="text-[11px] text-gray-500">LKR</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="—"
                        value={value}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [type]: e.target.value }))}
                        className="w-24 bg-transparent text-white rounded px-1.5 py-1.5 text-sm text-right focus:outline-none"
                      />
                    </div>
                    <button
                      onClick={() => setDrafts((prev) => ({ ...prev, [type]: "" }))}
                      disabled={value.trim() === ""}
                      title={existing ? "Remove this price on save" : "Clear"}
                      className="text-gray-500 hover:text-red-400 p-1.5 disabled:opacity-25 disabled:hover:text-gray-500"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-gray-500 mt-2">
              Leave a field empty to remove that vehicle type's price.
            </p>
          </div>
        </div>

        <div className="border-t border-white/10 p-5 space-y-2">
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-white/5 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="bg-orange-500 hover:bg-orange-600 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {saving ? "Saving…" : isNew ? "Add Service" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
