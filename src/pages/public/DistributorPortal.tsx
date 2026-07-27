import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { httpsCallable, type FunctionsError } from "firebase/functions";
import {
  Package, Search, Plus, Minus, ShoppingCart, X, Check, AlertCircle,
  Truck, Clock, Phone, Banknote, FileText, PackagePlus,
} from "lucide-react";
import { functions } from "../../config/firebase";
import { LoadingScreen } from "../../components/LoadingProgress";

// The distributor has no account. Everything on this page comes from two
// unauthenticated callables that re-check the link's token on every request —
// Firestore rules keep the inventory collection itself staff-only.

interface CatalogItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  /** @deprecated Superseded by availableQty; still sent for cached older clients. */
  inStock: boolean;
  /** What is actually on the shelf — the ceiling for any order line. */
  availableQty: number;
  /** What this distributor pays. */
  unitPrice: number;
  /** The MRP printed on the item; 0 when the center hasn't recorded one. */
  markedPrice: number;
}

type StockRequestStatus = "pending" | "acknowledged" | "fulfilled" | "declined";

interface PortalStockRequest {
  id: string;
  itemId: string;
  itemName: string;
  unit: string;
  requestedQty: number;
  status: StockRequestStatus;
  note: string | null;
  reviewNote: string | null;
  createdAt: number | null;
}

interface PortalOrderLine {
  itemName: string;
  unit: string;
  requestedQty: number;
  approvedQty: number;
  unitPrice: number;
  lineTotal: number;
}

interface PortalPayment {
  id: string;
  method: "cash" | "cheque" | "credit";
  amount: number;
  date: number | null;
  note: string | null;
  chequeNumber: string | null;
  bank: string | null;
  branch: string | null;
  chequeDate: number | null;
}

interface PortalOrder {
  id: string;
  orderNumber: string;
  status: "submitted" | "finalized" | "rejected" | "cancelled";
  total: number;
  note: string | null;
  reviewNote: string | null;
  createdVia: "portal" | "staff";
  createdAt: number | null;
  finalizedAt: number | null;
  items: PortalOrderLine[];
  receivedTotal: number;
  creditTotal: number;
  balanceDue: number;
  paymentStatus: "unpaid" | "partial" | "paid";
  payments: PortalPayment[];
}

interface PortalData {
  center: { name: string; phone: string | null; address: string | null; logoUrl: string | null };
  distributor: { name: string; contactPerson: string | null };
  catalog: CatalogItem[];
  orders: PortalOrder[];
  stockRequests: PortalStockRequest[];
}

const STATUS_CHIP: Record<PortalOrder["status"], string> = {
  submitted: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  finalized: "bg-green-500/15 text-green-400 border-green-500/30",
  rejected:  "bg-red-500/15 text-red-400 border-red-500/30",
  cancelled: "bg-gray-500/15 text-gray-400 border-gray-500/30",
};

const STATUS_LABEL: Record<PortalOrder["status"], string> = {
  submitted: "Awaiting confirmation",
  finalized: "Ready / released",
  rejected:  "Declined",
  cancelled: "Cancelled",
};

const STOCK_REQUEST_CHIP: Record<StockRequestStatus, string> = {
  pending:      "bg-amber-500/15 text-amber-400 border-amber-500/30",
  acknowledged: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  fulfilled:    "bg-green-500/15 text-green-400 border-green-500/30",
  declined:     "bg-red-500/15 text-red-400 border-red-500/30",
};

const STOCK_REQUEST_LABEL: Record<StockRequestStatus, string> = {
  pending:      "Requested",
  acknowledged: "More on the way",
  fulfilled:    "Back in stock",
  declined:     "Not available",
};

function formatLKR(n: number): string {
  return `LKR ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const PAYMENT_LABEL: Record<PortalPayment["method"], string> = {
  cash: "Cash", cheque: "Cheque", credit: "Credit",
};

const PAYMENT_ICON: Record<PortalPayment["method"], typeof Banknote> = {
  cash: Banknote, cheque: FileText, credit: Clock,
};

const PAYMENT_TONE: Record<PortalPayment["method"], string> = {
  cash: "text-green-400", cheque: "text-blue-400", credit: "text-amber-400",
};

// ── Request more stock ────────────────────────────────────────────────────────
// A distributor can only order what's on the shelf. This is the release valve:
// it reserves nothing and moves no stock, it just tells the workshop what to
// buy in.

function StockRequestModal({
  item, centerName, link, onDone, onClose,
}: {
  item: CatalogItem;
  centerName: string;
  link: { centerId: string; distributorId: string; token: string };
  onDone: () => void;
  onClose: () => void;
}) {
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    const parsed = parseFloat(qty);
    if (!qty || isNaN(parsed) || parsed <= 0) {
      setError("Enter how much you need.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const fn = httpsCallable<
        { centerId: string; distributorId: string; token: string; itemId: string; quantity: number; note: string },
        { success: boolean; requestId: string }
      >(functions, "requestDistributorStock");
      await fn({ ...link, itemId: item.id, quantity: parsed, note: note.trim() });
      onDone();
    } catch (err) {
      const message = (err as FunctionsError)?.message;
      setError(message || "Could not send the request. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Request Stock</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="bg-[#0B1120] border border-white/5 rounded-xl p-4 mb-5">
          <p className="text-sm font-semibold text-white">{item.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {item.category} · {formatLKR(item.unitPrice)} per {item.unit.toLowerCase().replace(/s$/, "")}
            {item.markedPrice > 0 && ` · MRP ${formatLKR(item.markedPrice)}`}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {item.availableQty > 0
              ? `${item.availableQty} ${item.unit} on the shelf right now`
              : "Out of stock right now"}
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Quantity you need <span className="text-red-400">*</span>
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              autoFocus
              value={qty}
              onChange={e => { setQty(e.target.value); setError(""); }}
              placeholder={`e.g. 20 ${item.unit}`}
              className="w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Note <span className="text-gray-600 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={300}
              placeholder="e.g. Needed by Friday for a bulk order"
              className="w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition"
            />
          </div>
          {error && (
            <p className="text-sm text-red-400 flex items-start gap-1.5">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" /> {error}
            </p>
          )}
        </div>

        <button
          onClick={send}
          disabled={sending}
          className="w-full mt-5 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold py-3 px-4 rounded-xl transition text-sm flex items-center justify-center gap-2"
        >
          <PackagePlus className="h-4 w-4" />
          {sending ? "Sending…" : "Send Request"}
        </button>
        <p className="text-xs text-gray-600 mt-3 text-center">
          This is a request, not an order — nothing is reserved. {centerName} will let you know when more is in.
        </p>
      </div>
    </div>
  );
}

export default function DistributorPortal() {
  const { centerId, distributorId, token } = useParams<{
    centerId: string; distributorId: string; token: string;
  }>();

  // A link missing any of its three parts can't be loaded at all, so that
  // verdict is settled before the first render rather than in an effect.
  const linkComplete = Boolean(centerId && distributorId && token);

  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(linkComplete);
  const [loadError, setLoadError] = useState(
    linkComplete ? "" : "This link is incomplete. Ask your service center for a new one.",
  );

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [confirmation, setConfirmation] = useState<{ orderNumber: string; total: number } | null>(null);
  const [tab, setTab] = useState<"catalog" | "orders" | "requests">("catalog");
  // Bumped after an order is sent so the catalog and order list refetch.
  const [reloadKey, setReloadKey] = useState(0);
  // "Ask for more of this than they have" — the item being asked about.
  const [stockRequestFor, setStockRequestFor] = useState<CatalogItem | null>(null);

  useEffect(() => {
    if (!centerId || !distributorId || !token) return;
    let active = true;
    (async () => {
      try {
        const fn = httpsCallable<
          { centerId: string; distributorId: string; token: string },
          PortalData
        >(functions, "getDistributorPortal");
        const res = await fn({ centerId, distributorId, token });
        if (!active) return;
        setData(res.data);
        setLoadError("");
      } catch (err) {
        if (!active) return;
        const message = (err as FunctionsError)?.message;
        setLoadError(message || "This link is no longer valid. Please contact your service center.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [centerId, distributorId, token, reloadKey]);

  const categories = useMemo(() => {
    if (!data) return ["All"];
    return ["All", ...Array.from(new Set(data.catalog.map(i => i.category))).sort((a, b) => a.localeCompare(b))];
  }, [data]);

  const displayed = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.catalog
      .filter(i => category === "All" || i.category === category)
      .filter(i => !q || i.name.toLowerCase().includes(q));
  }, [data, search, category]);

  const cartLines = useMemo(() => {
    if (!data) return [];
    return Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([itemId, qty]) => {
        const item = data.catalog.find(i => i.id === itemId);
        return item ? { item, qty } : null;
      })
      .filter((l): l is { item: CatalogItem; qty: number } => l !== null);
  }, [cart, data]);

  const cartTotal = useMemo(
    () => cartLines.reduce((sum, l) => sum + l.qty * l.item.unitPrice, 0),
    [cartLines],
  );

  // Rejected and cancelled orders were never owed, so they stay out of the
  // running account.
  const account = useMemo(() => {
    const settleable = (data?.orders ?? []).filter(
      o => o.status === "submitted" || o.status === "finalized",
    );
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      billed:  round(settleable.reduce((sum, o) => sum + o.total, 0)),
      paid:    round(settleable.reduce((sum, o) => sum + o.receivedTotal, 0)),
      balance: round(settleable.reduce((sum, o) => sum + o.balanceDue, 0)),
    };
  }, [data]);
  const cartCount = cartLines.length;

  // Nothing can be ordered that isn't on the shelf, so the quantity is clamped
  // here as well as re-checked server-side. Wanting more than this is what the
  // "Request more stock" button is for.
  function setQty(itemId: string, qty: number) {
    const available = data?.catalog.find(i => i.id === itemId)?.availableQty ?? 0;
    setCart(prev => {
      const next = { ...prev };
      const capped = Math.min(Math.round(qty * 100) / 100, available);
      if (capped <= 0) delete next[itemId];
      else next[itemId] = capped;
      return next;
    });
    setSubmitError("");
  }

  async function submitOrder() {
    if (cartLines.length === 0) {
      setSubmitError("Add at least one item to your order.");
      return;
    }
    // Stock can move between loading the catalog and sending the order, so the
    // lines are re-checked here against the latest numbers the page holds. The
    // server checks again — this only saves a round trip and gives a clearer
    // message than a rejection would.
    const short = cartLines.find(l => l.qty > l.item.availableQty);
    if (short) {
      setSubmitError(
        short.item.availableQty > 0
          ? `Only ${short.item.availableQty} ${short.item.unit} of ${short.item.name} available. ` +
            "Lower the quantity, or request more stock from the catalog."
          : `${short.item.name} is out of stock. Remove it, or request more stock from the catalog.`,
      );
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    try {
      const fn = httpsCallable<
        {
          centerId: string; distributorId: string; token: string;
          items: { itemId: string; quantity: number }[]; note: string;
        },
        { success: boolean; orderId: string; orderNumber: string; total: number }
      >(functions, "submitDistributorOrder");
      const res = await fn({
        centerId: centerId!,
        distributorId: distributorId!,
        token: token!,
        items: cartLines.map(l => ({ itemId: l.item.id, quantity: l.qty })),
        note: note.trim(),
      });
      setConfirmation({ orderNumber: res.data.orderNumber, total: res.data.total });
      setCart({});
      setNote("");
      setCartOpen(false);
      setReloadKey(k => k + 1);
    } catch (err) {
      const message = (err as FunctionsError)?.message;
      setSubmitError(message || "Could not send your order. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingScreen />;

  if (loadError || !data) {
    return (
      <div className="min-h-screen bg-[#0B1120] text-white flex flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="w-10 h-10 text-gray-500" />
        <p className="text-gray-300 font-medium">Catalog unavailable</p>
        <p className="text-sm text-gray-500 max-w-sm">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white pb-28">
      {/* Header */}
      <div className="border-b border-white/10 bg-[#162032] sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-4">
          {data.center.logoUrl
            ? <img src={data.center.logoUrl} alt="" className="w-10 h-10 rounded-lg object-contain bg-white/5" />
            : <div className="w-10 h-10 rounded-lg bg-[#F97316]/20 flex items-center justify-center flex-shrink-0">
                <Truck className="w-5 h-5 text-[#F97316]" />
              </div>
          }
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-400 truncate">{data.center.name}</p>
            <h1 className="text-base font-bold truncate">{data.distributor.name}</h1>
          </div>
          {data.center.phone && (
            <a
              href={`tel:${data.center.phone}`}
              className="flex-shrink-0 p-2 rounded-lg bg-white/5 hover:bg-white/10 text-[#F97316] transition"
              title={data.center.phone}
            >
              <Phone className="w-4 h-4" />
            </a>
          )}
        </div>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pb-3">
          <div className="flex bg-white/5 rounded-lg p-0.5 gap-0.5 w-fit">
            {([
              ["catalog", "Catalog"],
              ["orders", `My Orders (${data.orders.length})`],
              ["requests", `Stock Requests (${data.stockRequests.length})`],
            ] as const).map(([key, label]) => (
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
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {confirmation && (
          <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-4 flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
              <Check className="w-4 h-4 text-green-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-green-300">Order {confirmation.orderNumber} sent</p>
              <p className="text-xs text-green-400/80 mt-0.5">
                {formatLKR(confirmation.total)} · {data.center.name} will confirm what they can release, then hand
                the stock over.
              </p>
            </div>
            <button onClick={() => setConfirmation(null)} className="text-green-400/60 hover:text-green-300 flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {tab === "catalog" ? (
          <>
            {/* Filters */}
            <div className="bg-[#162032] border border-white/10 rounded-2xl p-4 space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search the catalog…"
                  className="w-full pl-9 pr-4 py-2.5 bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-xl text-sm text-white placeholder-gray-600 transition"
                />
              </div>
              {categories.length > 2 && (
                <div className="flex flex-wrap gap-2">
                  {categories.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setCategory(cat)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
                        category === cat
                          ? "bg-[#F97316]/20 text-[#F97316] border-[#F97316]/40"
                          : "bg-[#0B1120] text-gray-400 border-white/10 hover:border-white/20"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Catalog */}
            {displayed.length === 0 ? (
              <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3 text-center">
                <Package className="h-12 w-12 text-gray-700" />
                <p className="text-gray-400 font-medium">
                  {data.catalog.length === 0 ? "Nothing on offer right now" : "No items match your search"}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {displayed.map(item => {
                  const qty = cart[item.id] ?? 0;
                  return (
                    <div
                      key={item.id}
                      className={`bg-[#162032] border rounded-2xl p-4 ${qty > 0 ? "border-[#F97316]/40" : "border-white/10"}`}
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-white">{item.name}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {item.category} · per {item.unit.toLowerCase().replace(/s$/, "")}
                          </p>
                          <p className="text-sm mt-1.5">
                            <span className="text-white font-semibold">{formatLKR(item.unitPrice)}</span>
                            {item.markedPrice > 0 && (
                              <span className="text-xs text-gray-500 ml-2">MRP {formatLKR(item.markedPrice)}</span>
                            )}
                          </p>
                          <p className="text-xs mt-1">
                            {item.availableQty > 0
                              ? <span className="text-green-400">{item.availableQty} {item.unit} available</span>
                              : <span className="text-red-400">Out of stock</span>}
                            {qty > 0 && qty >= item.availableQty && (
                              <span className="text-amber-400 ml-2">· that's everything they have</span>
                            )}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          {qty > 0 ? (
                            <>
                              <button
                                onClick={() => setQty(item.id, qty - 1)}
                                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200 transition"
                                aria-label={`Remove one ${item.name}`}
                              >
                                <Minus className="h-4 w-4" />
                              </button>
                              <input
                                type="number"
                                min="0"
                                max={item.availableQty}
                                step="0.01"
                                value={qty}
                                onChange={e => setQty(item.id, parseFloat(e.target.value) || 0)}
                                className="w-20 bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-2.5 py-1.5 text-white text-sm text-center transition"
                                aria-label={`Quantity of ${item.name}`}
                              />
                              <button
                                onClick={() => setQty(item.id, qty + 1)}
                                disabled={qty >= item.availableQty}
                                title={qty >= item.availableQty ? "That's all they have — request more instead" : undefined}
                                className="p-2 rounded-lg bg-[#F97316] hover:bg-[#ea6c0f] text-white transition disabled:opacity-40"
                                aria-label={`Add one ${item.name}`}
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setQty(item.id, 1)}
                              disabled={item.availableQty <= 0}
                              className="flex items-center gap-1.5 text-xs font-medium bg-[#F97316]/10 hover:bg-[#F97316]/20 text-[#F97316] border border-[#F97316]/20 px-3 py-2 rounded-lg transition disabled:opacity-40"
                            >
                              <Plus className="h-3.5 w-3.5" /> Add
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Needing more than the shelf holds is normal — this is
                          how the workshop hears about it. */}
                      <button
                        onClick={() => setStockRequestFor(item)}
                        className="mt-3 flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-[#F97316] transition"
                      >
                        <PackagePlus className="h-3.5 w-3.5" />
                        {item.availableQty > 0 ? "Need more than that? Request stock" : "Request this item"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : tab === "requests" ? (
          /* Stock requests */
          data.stockRequests.length === 0 ? (
            <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3 text-center">
              <PackagePlus className="h-12 w-12 text-gray-700" />
              <p className="text-gray-400 font-medium">No stock requests</p>
              <p className="text-sm text-gray-500 max-w-sm">
                When you need more of an item than {data.center.name} has on the shelf, ask for it from the
                catalog and it will show up here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.stockRequests.map(req => (
                <div key={req.id} className="bg-[#162032] border border-white/10 rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="font-medium text-white truncate">
                        {req.itemName}
                        <span className="text-gray-400 font-normal"> · {req.requestedQty} {req.unit}</span>
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">{formatDate(req.createdAt)}</p>
                      {req.note && <p className="text-xs text-gray-400 mt-1.5">Your note: {req.note}</p>}
                      {req.reviewNote && (
                        <p className="text-xs text-gray-400 mt-1.5">
                          {data.center.name}: {req.reviewNote}
                        </p>
                      )}
                    </div>
                    <span className={`flex-shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STOCK_REQUEST_CHIP[req.status]}`}>
                      {STOCK_REQUEST_LABEL[req.status]}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          /* Orders */
          data.orders.length === 0 ? (
            <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3 text-center">
              <Clock className="h-12 w-12 text-gray-700" />
              <p className="text-gray-400 font-medium">No orders yet</p>
              <p className="text-sm text-gray-500 max-w-sm">
                Build an order from the catalog and it will show up here with its status.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Running account across every order that's still settleable. */}
              <div className="grid grid-cols-3 gap-2">
                {([
                  ["Billed", account.billed, "text-white"],
                  ["Paid", account.paid, "text-green-400"],
                  ["Outstanding", account.balance, account.balance > 0 ? "text-amber-400" : "text-green-400"],
                ] as const).map(([label, value, tone]) => (
                  <div key={label} className="bg-[#162032] border border-white/10 rounded-2xl px-3 py-2.5">
                    <p className="text-xs text-gray-500">{label}</p>
                    <p className={`text-sm font-semibold mt-0.5 ${tone}`}>{formatLKR(value)}</p>
                  </div>
                ))}
              </div>

              {data.orders.map(order => (
                <div key={order.id} className="bg-[#162032] border border-white/10 rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-semibold text-white">{order.orderNumber}</span>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_CHIP[order.status]}`}>
                          {STATUS_LABEL[order.status]}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{formatDate(order.createdAt)}</p>
                    </div>
                    <p className="text-sm font-semibold text-white">{formatLKR(order.total)}</p>
                  </div>

                  {/* Lines — quantity, unit price and line value, so the order
                      reads as an invoice rather than a bare list. */}
                  <div className="mt-3 space-y-1.5">
                    {order.items.map((line, idx) => {
                      const qty = order.status === "finalized" ? line.approvedQty : line.requestedQty;
                      const trimmed = order.status === "finalized" && line.approvedQty !== line.requestedQty;
                      return (
                        <div key={idx} className="bg-[#0B1120] border border-white/5 rounded-lg px-3 py-2 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs text-gray-200 truncate">{line.itemName}</p>
                            <p className="text-[11px] text-gray-500 mt-0.5">
                              {qty} {line.unit} × {formatLKR(line.unitPrice)}
                              {trimmed && (
                                <span className="text-amber-400"> · {line.requestedQty} {line.unit} requested</span>
                              )}
                            </p>
                          </div>
                          <p className="text-xs font-medium text-white flex-shrink-0">{formatLKR(line.lineTotal)}</p>
                        </div>
                      );
                    })}
                  </div>

                  {/* Account for this order */}
                  {order.status !== "rejected" && order.status !== "cancelled" && (
                    <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        {([
                          ["Paid", order.receivedTotal, "text-green-400"],
                          ["Credit", order.creditTotal, "text-amber-400"],
                          ["Balance", order.balanceDue, order.balanceDue > 0 ? "text-amber-400" : "text-green-400"],
                        ] as const).map(([label, value, tone]) => (
                          <div key={label} className="bg-[#0B1120] border border-white/5 rounded-lg px-2.5 py-2">
                            <p className="text-[11px] text-gray-500">{label}</p>
                            <p className={`text-xs font-semibold mt-0.5 ${tone}`}>{formatLKR(value)}</p>
                          </div>
                        ))}
                      </div>

                      {order.payments.length > 0 && (
                        <div className="space-y-1">
                          {order.payments.map(p => {
                            const Icon = PAYMENT_ICON[p.method];
                            return (
                              <div key={p.id} className="flex items-start justify-between gap-3 text-[11px]">
                                <span className="flex items-start gap-1.5 min-w-0 text-gray-400">
                                  <Icon className={`h-3.5 w-3.5 flex-shrink-0 mt-px ${PAYMENT_TONE[p.method]}`} />
                                  <span className="min-w-0">
                                    {PAYMENT_LABEL[p.method]} · {formatDate(p.date)}
                                    {p.method === "cheque" && (
                                      <span className="block text-gray-500">
                                        No. {p.chequeNumber} · {p.bank}
                                        {p.branch ? `, ${p.branch}` : ""}
                                        {p.chequeDate ? ` · dated ${formatDate(p.chequeDate)}` : ""}
                                      </span>
                                    )}
                                  </span>
                                </span>
                                <span className="text-gray-300 flex-shrink-0">{formatLKR(p.amount)}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {order.note && <p className="text-xs text-gray-500 mt-3">Your note: {order.note}</p>}
                  {order.reviewNote && (
                    <p className="text-xs text-gray-400 mt-1.5">
                      {data.center.name}: {order.reviewNote}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )
        )}

        <div className="flex flex-col items-center gap-1.5 mt-8 pt-6 border-t border-white/5">
          <div className="flex items-center gap-2 text-gray-400">
            <div className="w-7 h-7 rounded-lg bg-[#F97316]/20 flex items-center justify-center">
              <Truck className="w-4 h-4 text-[#F97316]" />
            </div>
            <span className="text-sm">
              Powered by <span className="text-[#F97316] font-bold tracking-wide">PitStop IQ</span>
            </span>
          </div>
          <p className="text-[11px] text-gray-600">
            Prices and availability are confirmed by {data.center.name} when they process your order.
          </p>
        </div>
      </div>

      {/* Cart bar */}
      {cartCount > 0 && tab === "catalog" && !cartOpen && (
        <div className="fixed bottom-0 inset-x-0 z-30 border-t border-white/10 bg-[#162032]/95 backdrop-blur">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">
                {cartCount === 1 ? "1 item" : `${cartCount} items`}
              </p>
              <p className="text-xs text-gray-400">{formatLKR(cartTotal)}</p>
            </div>
            <button
              onClick={() => setCartOpen(true)}
              className="flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-5 py-2.5 rounded-xl transition text-sm"
            >
              <ShoppingCart className="h-4 w-4" />
              Review Order
            </button>
          </div>
        </div>
      )}

      {/* Ask for more stock */}
      {stockRequestFor && centerId && distributorId && token && (
        <StockRequestModal
          item={stockRequestFor}
          centerName={data.center.name}
          link={{ centerId, distributorId, token }}
          onDone={() => { setStockRequestFor(null); setReloadKey(k => k + 1); }}
          onClose={() => setStockRequestFor(null)}
        />
      )}

      {/* Cart sheet */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setCartOpen(false)} />
          <div className="relative bg-[#162032] border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md p-6 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Your Order</h3>
              <button onClick={() => setCartOpen(false)} className="text-gray-500 hover:text-gray-300 transition">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-2 mb-4">
              {cartLines.map(({ item, qty }) => (
                <div key={item.id} className="bg-[#0B1120] border border-white/5 rounded-lg px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-white truncate">{item.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {qty} {item.unit} × {formatLKR(item.unitPrice)}
                      </p>
                      {qty > item.availableQty && (
                        <p className="text-xs text-amber-400 mt-0.5">
                          Only {item.availableQty} {item.unit} available now
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <p className="text-sm font-medium text-white">{formatLKR(qty * item.unitPrice)}</p>
                      <button
                        onClick={() => setQty(item.id, 0)}
                        className="p-1 text-gray-600 hover:text-red-400 transition"
                        aria-label={`Remove ${item.name}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between border-t border-white/10 pt-3 mb-4">
              <span className="text-sm text-gray-400">Order total</span>
              <span className="text-base font-semibold text-white">{formatLKR(cartTotal)}</span>
            </div>

            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={300}
              placeholder="Note for the service center (optional)"
              className="w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition mb-3"
            />

            {submitError && (
              <p className="text-sm text-red-400 flex items-start gap-1.5 mb-3">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" /> {submitError}
              </p>
            )}

            <button
              onClick={submitOrder}
              disabled={submitting}
              className="w-full bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold py-3 px-4 rounded-xl transition text-sm flex items-center justify-center gap-2"
            >
              <ShoppingCart className="h-4 w-4" />
              {submitting ? "Sending…" : "Send Order"}
            </button>
            <p className="text-xs text-gray-600 mt-3 text-center">
              Nothing is reserved until {data.center.name} confirms the order.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
