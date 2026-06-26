import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, query, where, getDocs, addDoc,
  doc, orderBy, serverTimestamp, runTransaction, Timestamp,
} from "firebase/firestore";
import {
  ArrowLeft, Plus, X, Search, BookOpen,
} from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { Customer, Vehicle, ServicePriceItem, InvoiceLineItem, DiscountType } from "../../types/auth";

function formatLKR(n: number) {
  return `LKR ${n.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function calcTotals(items: InvoiceLineItem[], discount: number, discountType: DiscountType, tax: number) {
  const subtotal = items.reduce((s, l) => s + l.lineTotal, 0);
  const discountAmount = discountType === "percent"
    ? Math.round((subtotal * discount) / 100 * 100) / 100
    : discount;
  const grandTotal = Math.max(0, subtotal - discountAmount + tax);
  return { subtotal, discountAmount, grandTotal };
}

export default function NewInvoicePage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  // Customer & vehicle selection
  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
  const [allVehicles, setAllVehicles] = useState<{ customerId: string; plateNumber: string }[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerDropOpen, setCustomerDropOpen] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);

  // Service library
  const [catalog, setCatalog] = useState<ServicePriceItem[]>([]);
  const [showCatalog, setShowCatalog] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");

  // Line items
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([
    { description: "", qty: 1, unitPrice: 0, lineTotal: 0 },
  ]);

  // Totals
  const [discount, setDiscount] = useState(0);
  const [discountType, setDiscountType] = useState<DiscountType>("amount");
  const [tax, setTax] = useState(0);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Load customers
  useEffect(() => {
    if (!currentUser?.centerId) return;
    getDocs(query(
      collection(db, "servicecenters", currentUser.centerId, "customers"),
      where("isDeleted", "==", false),
      orderBy("name"),
    )).then((snap) => {
      setAllCustomers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
    });
    getDocs(query(
      collection(db, "servicecenters", currentUser.centerId, "vehicles"),
      where("isDeleted", "==", false),
    )).then((snap) => {
      setAllVehicles(snap.docs.map((d) => ({ customerId: d.data().customerId, plateNumber: d.data().plateNumber })));
    });
  }, [currentUser?.centerId]);

  // Load service catalog
  useEffect(() => {
    if (!currentUser?.centerId) return;
    getDocs(query(
      collection(db, "servicecenters", currentUser.centerId, "servicePrices"),
      orderBy("name"),
    )).then((snap) => {
      setCatalog(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ServicePriceItem)));
    });
  }, [currentUser?.centerId]);

  // Load vehicles when customer selected
  useEffect(() => {
    if (!selectedCustomer || !currentUser?.centerId) { setVehicles([]); setSelectedVehicle(null); return; }
    getDocs(query(
      collection(db, "servicecenters", currentUser.centerId, "vehicles"),
      where("customerId", "==", selectedCustomer.id),
      where("isDeleted", "==", false),
    )).then((snap) => {
      setVehicles(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Vehicle)));
    });
    setSelectedVehicle(null);
  }, [selectedCustomer, currentUser?.centerId]);

  function selectCustomer(c: Customer) {
    setSelectedCustomer(c);
    setCustomerSearch(c.name);
    setCustomerDropOpen(false);
  }

  function updateItem(idx: number, field: keyof InvoiceLineItem, value: string) {
    setLineItems((prev) => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [field]: field === "description" ? value : parseFloat(value) || 0 };
      updated.lineTotal = Math.round(updated.qty * updated.unitPrice * 100) / 100;
      return updated;
    }));
  }

  function addRow() {
    setLineItems((prev) => [...prev, { description: "", qty: 1, unitPrice: 0, lineTotal: 0 }]);
  }

  function deleteRow(idx: number) {
    setLineItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function addFromCatalog(item: ServicePriceItem) {
    const price = item.defaultPrice ?? item.price ?? 0;
    setLineItems((prev) => {
      // If there's only one empty row, replace it
      if (prev.length === 1 && !prev[0].description && prev[0].unitPrice === 0) {
        return [{ description: item.name, qty: 1, unitPrice: price, lineTotal: price }];
      }
      return [...prev, { description: item.name, qty: 1, unitPrice: price, lineTotal: price }];
    });
    setShowCatalog(false);
    setCatalogSearch("");
  }

  const { subtotal, discountAmount, grandTotal } = calcTotals(lineItems, discount, discountType, tax);

  async function handleCreate() {
    if (!currentUser?.centerId) return;
    if (!selectedCustomer) { setError("Please select a customer."); return; }
    if (!selectedVehicle) { setError("Please select a vehicle."); return; }
    if (lineItems.every((l) => !l.description)) { setError("Add at least one line item."); return; }

    setSaving(true);
    setError("");
    try {
      const centerId = currentUser.centerId;
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const key = `${year}_${month}`;

      const counterRef = doc(db, "servicecenters", centerId, "counters", "invoices");
      let seq = 1;
      await runTransaction(db, async (t) => {
        const snap = await t.get(counterRef);
        if (snap.exists()) {
          seq = ((snap.data()[key] as number) ?? 0) + 1;
          t.update(counterRef, { [key]: seq });
        } else {
          t.set(counterRef, { [key]: seq });
        }
      });
      const invoiceNumber = `INV-${year}-${month}-${String(seq).padStart(4, "0")}`;

      const validItems = lineItems.filter((l) => l.description.trim());
      const invRef = await addDoc(collection(db, "servicecenters", centerId, "invoices"), {
        invoiceNumber,
        serviceId: "",
        customerId: selectedCustomer.id,
        customerName: selectedCustomer.name,
        customerPhone: selectedCustomer.phone,
        vehicleId: selectedVehicle.id,
        plateNumber: selectedVehicle.plateNumber,
        serviceDate: Timestamp.now(),
        lineItems: validItems,
        subtotal,
        discount,
        discountType,
        tax,
        grandTotal,
        status: "pending",
        paidAmount: 0,
        balanceDue: grandTotal,
        centerId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      navigate(`/invoices/${invRef.id}`);
    } catch {
      setError("Failed to create invoice. Please try again.");
    }
    setSaving(false);
  }

  const filteredCatalog = catalog.filter((c) =>
    !catalogSearch || c.name.toLowerCase().includes(catalogSearch.toLowerCase())
  );

  const filteredCustomers = allCustomers.filter((c) => {
    if (!customerSearch) return true;
    const q = customerSearch.toLowerCase();
    if (c.name.toLowerCase().includes(q)) return true;
    if (c.phone.includes(customerSearch)) return true;
    return allVehicles.some((v) => v.customerId === c.id && v.plateNumber.toLowerCase().includes(q));
  });

  return (
    <div className="min-h-screen bg-[#0B1120]">
      {/* Header */}
      <div className="border-b border-white/10 bg-[#0B1120]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => navigate("/invoices")} className="text-gray-400 hover:text-white">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider">Invoices</div>
            <div className="text-lg font-bold text-white">New Invoice</div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

        {/* Customer selector */}
        <div className="bg-[#162032] border border-white/10 rounded-xl p-4 space-y-3">
          <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Customer</div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search by name, phone or plate…"
              value={customerSearch}
              onFocus={() => setCustomerDropOpen(true)}
              onChange={(e) => { setCustomerSearch(e.target.value); setCustomerDropOpen(true); setSelectedCustomer(null); }}
              className="w-full pl-9 pr-3 py-2 bg-white/5 border border-white/10 text-white rounded-lg text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
            />
            {customerDropOpen && filteredCustomers.length > 0 && (
              <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-[#1e2d42] border border-white/10 rounded-lg shadow-xl max-h-56 overflow-y-auto">
                {filteredCustomers.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => selectCustomer(c)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-white/10 text-gray-200"
                  >
                    <div className="text-white">{c.name}</div>
                    <div className="text-xs text-gray-400">{c.phone}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {selectedCustomer && (
            <div className="text-sm text-green-400">✓ {selectedCustomer.name} — {selectedCustomer.phone}</div>
          )}
        </div>

        {/* Vehicle selector */}
        {selectedCustomer && (
          <div className="bg-[#162032] border border-white/10 rounded-xl p-4 space-y-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Vehicle</div>
            {vehicles.length === 0 ? (
              <p className="text-sm text-gray-500">No vehicles found for this customer.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {vehicles.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVehicle(v)}
                    className={`text-left rounded-lg border p-3 transition-colors ${
                      selectedVehicle?.id === v.id
                        ? "border-orange-500 bg-orange-500/10"
                        : "border-white/10 bg-white/5 hover:border-white/30"
                    }`}
                  >
                    <div className="font-bold text-white font-mono text-sm">{v.plateNumber}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{[v.make, v.model].filter(Boolean).join(" ") || "—"}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Line items */}
        <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Services & Items</div>
            <button
              onClick={() => setShowCatalog(true)}
              className="flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300 bg-orange-500/10 px-2.5 py-1 rounded-lg"
            >
              <BookOpen className="w-3.5 h-3.5" />
              Add from Library
            </button>
          </div>

          {/* Table header */}
          <div className="hidden sm:grid grid-cols-12 gap-2 text-xs text-gray-500 uppercase tracking-wider mb-2 px-1">
            <div className="col-span-5">Description</div>
            <div className="col-span-2 text-right">Qty</div>
            <div className="col-span-3 text-right">Unit Price</div>
            <div className="col-span-2 text-right">Total</div>
          </div>

          <div className="space-y-2">
            {lineItems.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-12 sm:col-span-5">
                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) => updateItem(idx, "description", e.target.value)}
                    placeholder="Description"
                    className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <input
                    type="number"
                    value={item.qty}
                    min="0"
                    step="0.01"
                    onChange={(e) => updateItem(idx, "qty", e.target.value)}
                    className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div className="col-span-4 sm:col-span-3">
                  <input
                    type="number"
                    value={item.unitPrice}
                    min="0"
                    step="0.01"
                    onChange={(e) => updateItem(idx, "unitPrice", e.target.value)}
                    className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div className="col-span-4 sm:col-span-2 flex items-center justify-end gap-2">
                  <span className="text-sm text-white text-right whitespace-nowrap">{formatLKR(item.lineTotal)}</span>
                  {lineItems.length > 1 && (
                    <button onClick={() => deleteRow(idx)} className="text-gray-600 hover:text-red-400 flex-shrink-0">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={addRow}
            className="mt-3 flex items-center gap-1.5 text-sm text-orange-400 hover:text-orange-300"
          >
            <Plus className="w-4 h-4" />
            Add Row
          </button>
        </div>

        {/* Totals */}
        <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-4">Totals</div>
          <div className="space-y-3 max-w-sm ml-auto">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Subtotal</span>
              <span className="text-white">{formatLKR(subtotal)}</span>
            </div>

            <div className="flex items-center justify-between text-sm gap-3">
              <div className="flex items-center gap-2 text-gray-400">
                <span>Discount</span>
                <button
                  onClick={() => setDiscountType((t) => (t === "amount" ? "percent" : "amount"))}
                  className="text-xs bg-white/10 hover:bg-white/20 px-2 py-0.5 rounded text-gray-300"
                >
                  {discountType === "amount" ? "LKR" : "%"}
                </button>
              </div>
              <input
                type="number"
                value={discount}
                min="0"
                step="0.01"
                onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
                className="w-28 bg-white/5 border border-white/10 text-white rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:border-orange-500"
              />
            </div>

            <div className="flex items-center justify-between text-sm gap-3">
              <span className="text-gray-400">Tax (LKR)</span>
              <input
                type="number"
                value={tax}
                min="0"
                step="0.01"
                onChange={(e) => setTax(parseFloat(e.target.value) || 0)}
                className="w-28 bg-white/5 border border-white/10 text-white rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:border-orange-500"
              />
            </div>

            <div className="border-t border-white/10 pt-3 flex justify-between text-base font-bold">
              <span className="text-white">Grand Total</span>
              <span className="text-white">{formatLKR(grandTotal)}</span>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleCreate}
          disabled={saving}
          className="w-full bg-[#F97316] hover:bg-orange-600 text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create Invoice"}
        </button>
      </div>

      {/* Service library modal */}
      {showCatalog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#162032] border border-white/10 rounded-xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <h3 className="font-semibold text-white">Service Library</h3>
              <button onClick={() => { setShowCatalog(false); setCatalogSearch(""); }} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 border-b border-white/10">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search services…"
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  autoFocus
                  className="w-full pl-9 pr-3 py-2 bg-white/5 border border-white/10 text-white rounded-lg text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {filteredCatalog.length === 0 ? (
                <div className="text-center text-gray-500 text-sm py-8">
                  {catalog.length === 0 ? "No services in library. Add services in Settings → Service Library." : "No matches found."}
                </div>
              ) : (
                filteredCatalog.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => addFromCatalog(item)}
                    className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-white/10 transition-colors flex items-center justify-between group"
                  >
                    <div>
                      <div className="text-white text-sm">{item.name}</div>
                      {item.category && <div className="text-xs text-gray-500">{item.category}</div>}
                    </div>
                    <div className="text-orange-400 text-sm font-medium">
                      {formatLKR(item.defaultPrice ?? item.price ?? 0)}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
