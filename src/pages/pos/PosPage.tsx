import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import {
  ShoppingCart, Search, Plus, Minus, Trash2, AlertTriangle, Check, History, Store,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import type { InventoryItem, Outlet, PosPaymentMethod } from "../../types/auth";
import { LoadingBlock } from "../../components/LoadingProgress";
import { formatLKR, outletPriceOf } from "../../lib/inventoryPricing";
import { recordPosSale, round2, type PosCartLine } from "../../lib/posSales";

const PAYMENT_METHODS: { key: PosPaymentMethod; label: string }[] = [
  { key: "cash", label: "Cash" },
  { key: "card", label: "Card" },
  { key: "bank_transfer", label: "Bank Transfer" },
];

interface CartEntry {
  item: InventoryItem;
  quantity: number;
  unitPrice: number;
}

export default function PosPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const centerId = currentUser?.centerId ?? "";
  const uid = currentUser?.uid ?? "";
  const userName = currentUser?.displayName ?? currentUser?.email ?? "Staff";

  const canView = usePermission("pos.view");
  const canSell = usePermission("pos.sell");
  const canViewSales = usePermission("pos.viewSales");

  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [outletId, setOutletId] = useState("");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [discount, setDiscount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>("cash");
  const [amountTendered, setAmountTendered] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{ saleNumber: string; total: number } | null>(null);

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(collection(db, "servicecenters", centerId, "outlets"), snap => {
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Outlet))
        .filter(o => o.isActive)
        .sort((a, b) => a.name.localeCompare(b.name));
      setOutlets(list);
      setOutletId(prev => prev || (list.length ? list[0].id : ""));
    }, () => setOutlets([]));
  }, [centerId]);

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(
      query(collection(db, "servicecenters", centerId, "inventory"), orderBy("name")),
      snap => {
        setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryItem)).filter(i => !i.isArchived));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [centerId]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return items.filter(i => i.name.toLowerCase().includes(q) && i.currentQty > 0).slice(0, 8);
  }, [items, search]);

  function addToCart(item: InventoryItem) {
    setCart(prev => {
      const existing = prev.find(l => l.item.id === item.id);
      if (existing) {
        return prev.map(l => l.item.id === item.id ? { ...l, quantity: l.quantity + 1 } : l);
      }
      return [...prev, { item, quantity: 1, unitPrice: outletPriceOf(item) }];
    });
    setSearch("");
  }

  function updateQty(itemId: string, quantity: number) {
    setCart(prev => prev.map(l => l.item.id === itemId ? { ...l, quantity: Math.max(0, quantity) } : l).filter(l => l.quantity > 0));
  }

  function updatePrice(itemId: string, unitPrice: number) {
    setCart(prev => prev.map(l => l.item.id === itemId ? { ...l, unitPrice: Math.max(0, unitPrice) } : l));
  }

  function removeLine(itemId: string) {
    setCart(prev => prev.filter(l => l.item.id !== itemId));
  }

  const subtotal = round2(cart.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0));
  const discountValue = round2(parseFloat(discount) || 0);
  const total = round2(Math.max(0, subtotal - discountValue));
  const tendered = parseFloat(amountTendered) || 0;
  const changeDue = paymentMethod === "cash" && amountTendered ? round2(Math.max(0, tendered - total)) : null;

  async function handleCheckout() {
    if (!outletId) { setError("Pick an outlet first."); return; }
    if (cart.length === 0) { setError("Add at least one item to the cart."); return; }
    if (paymentMethod === "cash" && amountTendered && tendered < total) {
      setError("Amount tendered is less than the total.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const outlet = outlets.find(o => o.id === outletId)!;
      const lines: PosCartLine[] = cart.map(l => ({ item: l.item, quantity: l.quantity, unitPrice: l.unitPrice }));
      const result = await recordPosSale({
        outletId,
        outletName: outlet.name,
        lines,
        discount: discountValue,
        paymentMethod,
        amountTendered: paymentMethod === "cash" && amountTendered ? tendered : undefined,
        actor: { centerId, uid, userName },
      });
      setReceipt(result);
      setCart([]);
      setDiscount("");
      setAmountTendered("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete the sale. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!canView) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <ShoppingCart className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to view the POS.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<ShoppingCart className="w-5 h-5" />}
        title="Outlet POS"
        actions={
          canViewSales ? (
            <button
              onClick={() => navigate("/pos/sales")}
              className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium px-4 py-2.5 rounded-xl transition text-sm"
            >
              <History className="h-4 w-4" /> Sales History
            </button>
          ) : undefined
        }
      />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {outlets.length === 0 ? (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3">
            <Store className="h-12 w-12 text-gray-700" />
            <p className="text-gray-400 font-medium">No active outlets</p>
            <p className="text-sm text-gray-500 max-w-sm text-center">
              Set up an outlet before ringing up sales.
            </p>
            <button
              onClick={() => navigate("/outlets")}
              className="mt-2 flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2 rounded-xl transition text-sm"
            >
              Manage Outlets
            </button>
          </div>
        ) : !canSell ? (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3">
            <ShoppingCart className="h-12 w-12 text-gray-700" />
            <p className="text-gray-400 font-medium">You can't ring up sales.</p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-5">
            {/* Item search */}
            <div className="lg:col-span-3 space-y-4">
              <div className="bg-[#162032] border border-white/10 rounded-2xl p-4">
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Outlet</label>
                <select
                  value={outletId}
                  onChange={e => setOutletId(e.target.value)}
                  className="w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white text-sm transition appearance-none"
                >
                  {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>

              <div className="bg-[#162032] border border-white/10 rounded-2xl p-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search inventory to add to the sale…"
                    className="w-full pl-9 pr-4 py-2.5 bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-xl text-sm text-white placeholder-gray-600 transition"
                  />
                </div>
                {loading ? (
                  <LoadingBlock className="py-8" />
                ) : matches.length > 0 && (
                  <div className="mt-2 max-h-64 overflow-y-auto space-y-1">
                    {matches.map(item => (
                      <button
                        key={item.id}
                        onClick={() => addToCart(item)}
                        className="w-full text-left bg-[#0B1120] hover:bg-white/5 border border-white/5 rounded-lg px-3 py-2 transition flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <p className="text-sm text-white truncate">{item.name}</p>
                          <p className="text-xs text-gray-500">{item.currentQty} {item.unit} in stock</p>
                        </div>
                        <span className="text-xs text-[#F97316] font-medium flex-shrink-0">
                          {formatLKR(outletPriceOf(item))}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Cart */}
              <div className="bg-[#162032] border border-white/10 rounded-2xl p-4">
                <h3 className="text-sm font-semibold text-white mb-3">Cart</h3>
                {cart.length === 0 ? (
                  <p className="text-sm text-gray-500 py-4 text-center">No items added yet.</p>
                ) : (
                  <div className="space-y-2">
                    {cart.map(line => (
                      <div key={line.item.id} className="flex items-center gap-2 bg-[#0B1120] border border-white/5 rounded-lg px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-white truncate">{line.item.name}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.unitPrice}
                              onChange={e => updatePrice(line.item.id, parseFloat(e.target.value) || 0)}
                              className="w-24 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white"
                            />
                            <span className="text-xs text-gray-500">per {line.item.unit}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button onClick={() => updateQty(line.item.id, line.quantity - 1)} className="p-1 rounded bg-white/5 hover:bg-white/10 text-gray-300">
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-8 text-center text-sm text-white">{line.quantity}</span>
                          <button
                            onClick={() => updateQty(line.item.id, line.quantity + 1)}
                            disabled={line.quantity >= line.item.currentQty}
                            className="p-1 rounded bg-white/5 hover:bg-white/10 text-gray-300 disabled:opacity-30"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <p className="text-sm text-white font-medium w-20 text-right flex-shrink-0">
                          {formatLKR(round2(line.quantity * line.unitPrice))}
                        </p>
                        <button onClick={() => removeLine(line.item.id)} className="p-1 text-gray-500 hover:text-red-400 flex-shrink-0">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Checkout panel */}
            <div className="lg:col-span-2">
              <div className="bg-[#162032] border border-white/10 rounded-2xl p-4 sticky top-24 space-y-4">
                <h3 className="text-sm font-semibold text-white">Checkout</h3>

                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between text-gray-400">
                    <span>Subtotal</span><span className="text-white">{formatLKR(subtotal)}</span>
                  </div>
                  <div className="flex justify-between items-center text-gray-400">
                    <span>Discount</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={discount}
                      onChange={e => setDiscount(e.target.value)}
                      placeholder="0.00"
                      className="w-28 bg-[#0B1120] border border-white/10 rounded px-2 py-1 text-xs text-white text-right"
                    />
                  </div>
                  <div className="flex justify-between text-white font-semibold text-base pt-1.5 border-t border-white/10">
                    <span>Total</span><span>{formatLKR(total)}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Payment Method</label>
                  <div className="flex gap-1.5">
                    {PAYMENT_METHODS.map(m => (
                      <button
                        key={m.key}
                        onClick={() => setPaymentMethod(m.key)}
                        className={`flex-1 px-2 py-2 rounded-lg text-xs font-medium border transition ${
                          paymentMethod === m.key
                            ? "bg-[#F97316]/20 text-[#F97316] border-[#F97316]/40"
                            : "bg-[#0B1120] text-gray-400 border-white/10 hover:border-white/20"
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {paymentMethod === "cash" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">
                      Amount Tendered <span className="text-gray-600 font-normal">(optional)</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={amountTendered}
                      onChange={e => setAmountTendered(e.target.value)}
                      placeholder={`e.g. ${total}`}
                      className="w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition"
                    />
                    {changeDue != null && (
                      <p className="text-xs text-gray-500 mt-1">Change due: <span className="text-white">{formatLKR(changeDue)}</span></p>
                    )}
                  </div>
                )}

                {error && (
                  <p className="text-sm text-red-400 flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
                  </p>
                )}

                <button
                  onClick={handleCheckout}
                  disabled={saving || cart.length === 0}
                  className="w-full bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition text-sm"
                >
                  {saving ? "Processing…" : `Charge ${formatLKR(total)}`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {receipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setReceipt(null)} />
          <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center mx-auto mb-3">
              <Check className="h-6 w-6 text-green-400" />
            </div>
            <p className="text-sm text-white font-medium">Sale completed</p>
            <p className="text-xs text-gray-500 mt-1">{receipt.saleNumber} · {formatLKR(receipt.total)}</p>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setReceipt(null)}
                className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm"
              >
                New Sale
              </button>
              {canViewSales && (
                <button
                  onClick={() => navigate("/pos/sales")}
                  className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm"
                >
                  View Sales
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
