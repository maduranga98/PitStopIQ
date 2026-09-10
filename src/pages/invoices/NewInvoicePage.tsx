import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, query, where, getDocs,
  orderBy, serverTimestamp, limit,
} from "firebase/firestore";
import { safeAddDoc } from "../../lib/firestoreWrite";
import {
  ArrowLeft, Plus, X, Search, BookOpen, Car, Package, CalendarDays,
  UserPlus, Users,
} from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { Customer, Vehicle, ServicePriceItem, InvoiceLineItem, DiscountType } from "../../types/auth";
import { phoneMatches } from "../../lib/utils";
import {
  fetchCustomers, fetchVehicles, fetchVehiclesForCustomer, fetchServicePrices,
} from "../../lib/refData";
import { usePermission } from "../../contexts/PermissionsContext";
import InventoryPicker from "../../components/invoices/InventoryPicker";
import ServicePicker from "../../components/invoices/ServicePicker";
import AmountInput from "../../components/common/AmountInput";
import { deductInvoiceParts, partLineFromItem } from "../../lib/invoiceParts";
import { dateInputToTimestampAt, todayInputValue } from "../../lib/invoicePayments";

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

  // How this bill identifies who it is for. A workshop sees plenty of
  // one-off vehicles — a tourist, a passing breakdown — and registering a
  // customer for each one only fills the book with names nobody will search
  // again. A walk-in bill carries the plate alone, and no SMS is offered for
  // it because there is no number to send one to.
  const [billingMode, setBillingMode] = useState<"customer" | "walkin">("customer");
  const [walkInPlate, setWalkInPlate] = useState("");
  const [walkInName, setWalkInName] = useState("");

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

  // Inventory (parts billed straight onto the bill, no job card involved)
  const [showInventory, setShowInventory] = useState(false);
  // Stock only exists on Pro, same gate the job card uses for its parts picker.
  const canPickParts = usePermission("inventory.view") && currentUser?.centerPlan === "pro";

  // The date the bill is dated. A workshop often writes up yesterday's work
  // the morning after, so it defaults to today but can be set to any day —
  // the invoice number, the service date and the ledger all follow it.
  const [invoiceDate, setInvoiceDate] = useState(todayInputValue());

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

  // Load customers and vehicles for the pickers, both from the reference cache
  // (see lib/refData.ts) so re-opening this page costs no reads.
  useEffect(() => {
    const centerId = currentUser?.centerId;
    if (!centerId) return;
    let active = true;
    fetchCustomers(centerId).then((list) => {
      if (active) setAllCustomers(list);
    });
    fetchVehicles(centerId).then((list) => {
      if (active) {
        setAllVehicles(list.map((v) => ({ customerId: v.customerId, plateNumber: v.plateNumber })));
      }
    });
    return () => { active = false; };
  }, [currentUser?.centerId]);

  // Load service catalog
  useEffect(() => {
    const centerId = currentUser?.centerId;
    if (!centerId) return;
    let active = true;
    fetchServicePrices(centerId).then((list) => {
      if (active) setCatalog(list);
    });
    return () => { active = false; };
  }, [currentUser?.centerId]);

  // Load vehicles when customer selected — filtered out of the cached full
  // vehicle list above, so picking a customer costs no extra read.
  useEffect(() => {
    const centerId = currentUser?.centerId;
    if (!selectedCustomer || !centerId) { setVehicles([]); setSelectedVehicle(null); return; }
    let active = true;
    fetchVehiclesForCustomer(centerId, selectedCustomer.id).then((list) => {
      if (active) setVehicles(list);
    });
    setSelectedVehicle(null);
    return () => { active = false; };
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
    setLineItems((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      // Any line can be taken off, including a part added by mistake. The form
      // falls back to one blank row rather than an empty table.
      return next.length > 0 ? next : [{ description: "", qty: 1, unitPrice: 0, lineTotal: 0 }];
    });
  }

  function addFromCatalog(name: string, price: number) {
    setLineItems((prev) => {
      // If there's only one empty row, replace it
      if (prev.length === 1 && !prev[0].description && prev[0].unitPrice === 0) {
        return [{ description: name, qty: 1, unitPrice: price, lineTotal: price }];
      }
      return [...prev, { description: name, qty: 1, unitPrice: price, lineTotal: price }];
    });
    setShowCatalog(false);
  }

  function addFromInventory(item: Parameters<typeof partLineFromItem>[0], qty: number) {
    const line = partLineFromItem(item, qty);
    setLineItems((prev) => {
      // The blank starter row is replaced rather than left above the part.
      const base = prev.length === 1 && !prev[0].description && prev[0].unitPrice === 0 ? [] : prev;
      const idx = base.findIndex((l) => l.itemId === line.itemId);
      if (idx >= 0) {
        return base.map((l, i) => {
          if (i !== idx) return l;
          const nextQty = l.qty + qty;
          return { ...l, qty: nextQty, lineTotal: Math.round(nextQty * l.unitPrice * 100) / 100 };
        });
      }
      return [...base, line];
    });
  }

  const { subtotal, grandTotal } = calcTotals(lineItems, discount, discountType, tax);

  async function handleCreate() {
    if (!currentUser?.centerId) return;
    const plate = walkInPlate.trim().toUpperCase();
    if (isWalkIn) {
      if (!plate) { setError("Enter the vehicle number."); return; }
    } else {
      if (!selectedCustomer) { setError("Please select a customer."); return; }
      if (!selectedVehicle) { setError("Please select a vehicle."); return; }
    }
    if (lineItems.every((l) => !l.description)) { setError("Add at least one line item."); return; }

    setSaving(true);
    setError("");
    try {
      const centerId = currentUser.centerId;
      // The bill is numbered, dated and reported under the date on the form,
      // so a backdated invoice lands in the month it belongs to rather than
      // the month it was typed in.
      const issued = dateInputToTimestampAt(invoiceDate);
      const issuedDate = issued.toDate();
      const year = issuedDate.getFullYear();
      const month = String(issuedDate.getMonth() + 1).padStart(2, "0");
      const prefix = `INV-${year}-${month}-`;

      const lastSnap = await getDocs(
        query(
          collection(db, "servicecenters", centerId, "invoices"),
          where("invoiceNumber", ">=", prefix),
          where("invoiceNumber", "<=", prefix + ""),
          orderBy("invoiceNumber", "desc"),
          limit(1),
        ),
      );

      let seq = 1;
      if (!lastSnap.empty) {
        const lastNum = lastSnap.docs[0].data().invoiceNumber as string;
        const n = parseInt(lastNum.slice(prefix.length), 10);
        if (!isNaN(n)) seq = n + 1;
      }
      const invoiceNumber = `${prefix}${String(seq).padStart(4, "0")}`;

      const validItems = lineItems.filter((l) => l.description.trim());
      const invRef = await safeAddDoc(collection(db, "servicecenters", centerId, "invoices"), {
        invoiceNumber,
        serviceId: "",
        // A walk-in has no customer or vehicle record behind it: the plate is
        // the whole identity, and `walkIn` is what tells the invoice card not
        // to offer an SMS or a customer link for it.
        walkIn: isWalkIn,
        customerId: isWalkIn ? "" : selectedCustomer!.id,
        customerName: isWalkIn ? (walkInName.trim() || "Walk-in Customer") : selectedCustomer!.name,
        customerPhone: isWalkIn ? "" : selectedCustomer!.phone,
        vehicleId: isWalkIn ? "" : selectedVehicle!.id,
        plateNumber: isWalkIn ? plate : selectedVehicle!.plateNumber,
        serviceDate: issued,
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
        isDeleted: false,
        createdAt: issued,
        updatedAt: serverTimestamp(),
      });

      // Parts picked off the shelf here never pass through a job card, so
      // this is the moment they leave stock.
      const failed = await deductInvoiceParts(
        centerId,
        validItems,
        { id: invRef.id, label: `Invoice ${invoiceNumber}` },
        { uid: currentUser.uid, name: currentUser.displayName ?? currentUser.email ?? "Staff" },
      );
      if (failed.length > 0) {
        setError(`Invoice created, but stock could not be updated for: ${failed.join(", ")}.`);
      }

      navigate(`/invoices/${invRef.id}`);
    } catch {
      setError("Failed to create invoice. Please try again.");
    }
    setSaving(false);
  }

  const isWalkIn = billingMode === "walkin";

  const filteredCustomers = allCustomers.filter((c) => {
    if (!customerSearch) return true;
    const q = customerSearch.toLowerCase();
    if (c.name.toLowerCase().includes(q)) return true;
    if (phoneMatches(c.phone, customerSearch)) return true;
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

        {/* Invoice date */}
        <div className="bg-[#162032] border border-white/10 rounded-xl p-4 space-y-3">
          <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Invoice Date</div>
          <div className="relative max-w-xs">
            <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value || todayInputValue())}
              className="w-full pl-9 pr-3 py-2 bg-white/5 border border-white/10 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
            />
          </div>
          <p className="text-xs text-gray-500">
            Defaults to today. Set it back to bill work done on an earlier day — the invoice
            number and the reports follow this date.
          </p>
        </div>

        {/* Who the bill is for: a registered customer, or just a plate */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setBillingMode("customer")}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${
              !isWalkIn
                ? "border-orange-500 bg-orange-500/10"
                : "border-white/10 bg-[#162032] hover:border-white/30"
            }`}
          >
            <Users className={`w-4 h-4 flex-shrink-0 ${!isWalkIn ? "text-orange-400" : "text-gray-500"}`} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-white">Registered Customer</span>
              <span className="block text-[11px] text-gray-500">SMS can be sent</span>
            </span>
          </button>
          <button
            onClick={() => setBillingMode("walkin")}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${
              isWalkIn
                ? "border-orange-500 bg-orange-500/10"
                : "border-white/10 bg-[#162032] hover:border-white/30"
            }`}
          >
            <UserPlus className={`w-4 h-4 flex-shrink-0 ${isWalkIn ? "text-orange-400" : "text-gray-500"}`} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-white">Walk-in</span>
              <span className="block text-[11px] text-gray-500">Vehicle number only</span>
            </span>
          </button>
        </div>

        {/* Walk-in: the plate is the whole record — nothing is registered */}
        {isWalkIn && (
          <div className="bg-[#162032] border border-white/10 rounded-xl p-4 space-y-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Vehicle Number</div>
            <div className="relative">
              <Car className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
              <input
                type="text"
                placeholder="e.g. CAB-1234"
                value={walkInPlate}
                onChange={(e) => setWalkInPlate(e.target.value.toUpperCase())}
                className="w-full pl-9 pr-3 py-2 bg-white/5 border border-white/10 text-white rounded-lg text-sm font-mono uppercase placeholder-gray-500 focus:outline-none focus:border-orange-500"
              />
            </div>
            <input
              type="text"
              placeholder="Customer name (optional — printed on the bill)"
              value={walkInName}
              onChange={(e) => setWalkInName(e.target.value)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 text-white rounded-lg text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
            />
            <p className="text-xs text-gray-500">
              Nothing is registered — no customer record is created and no SMS is sent.
              Use a registered customer for anyone who will come back.
            </p>
          </div>
        )}

        {/* Customer selector */}
        {!isWalkIn && (
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
        )}

        {/* Vehicle selector */}
        {!isWalkIn && selectedCustomer && (
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
                    {v.vehicleType && (
                      <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] text-gray-300 bg-white/10 px-1.5 py-0.5 rounded-full capitalize">
                        <Car className="w-2.5 h-2.5" /> {v.vehicleType}
                      </span>
                    )}
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
            <div className="flex items-center gap-2">
              {canPickParts && (
                <button
                  onClick={() => setShowInventory(true)}
                  className="flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300 bg-orange-500/10 px-2.5 py-1 rounded-lg"
                >
                  <Package className="w-3.5 h-3.5" />
                  Add from Inventory
                </button>
              )}
              <button
                onClick={() => setShowCatalog(true)}
                className="flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300 bg-orange-500/10 px-2.5 py-1 rounded-lg"
              >
                <BookOpen className="w-3.5 h-3.5" />
                Add from Library
              </button>
            </div>
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
                  {item.type === "part" && (
                    <div className="text-[10px] text-gray-500 mt-1 flex items-center gap-1">
                      <Package className="w-2.5 h-2.5" />
                      From inventory{item.partNumber ? ` · ${item.partNumber}` : ""}
                    </div>
                  )}
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <AmountInput
                    value={item.qty}
                    onChange={(v) => updateItem(idx, "qty", v)}
                    className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div className="col-span-4 sm:col-span-3">
                  <AmountInput
                    value={item.unitPrice}
                    onChange={(v) => updateItem(idx, "unitPrice", v)}
                    className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div className="col-span-4 sm:col-span-2 flex items-center justify-end gap-2">
                  <span className="text-sm text-white text-right whitespace-nowrap">{formatLKR(item.lineTotal)}</span>
                  <button
                    onClick={() => deleteRow(idx)}
                    title="Remove this line"
                    className="text-gray-600 hover:text-red-400 flex-shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
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
              <AmountInput
                value={discount}
                onChange={(v) => setDiscount(parseFloat(v) || 0)}
                className="w-28 bg-white/5 border border-white/10 text-white rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:border-orange-500"
              />
            </div>

            <div className="flex items-center justify-between text-sm gap-3">
              <span className="text-gray-400">Tax (LKR)</span>
              <AmountInput
                value={tax}
                onChange={(v) => setTax(parseFloat(v) || 0)}
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

      {/* Inventory picker — parts billed straight onto this invoice */}
      <InventoryPicker
        centerId={currentUser?.centerId ?? ""}
        open={showInventory}
        onClose={() => setShowInventory(false)}
        onPick={addFromInventory}
        note="Stock is deducted when the invoice is created."
      />

      {/* Service library — pick a priced service instead of typing it */}
      <ServicePicker
        open={showCatalog}
        onClose={() => setShowCatalog(false)}
        catalog={catalog}
        defaultVehicleType={selectedVehicle?.vehicleType ?? ""}
        onPick={addFromCatalog}
      />
    </div>
  );
}
