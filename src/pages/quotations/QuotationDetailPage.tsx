import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { doc, onSnapshot, getDoc, serverTimestamp } from "firebase/firestore";
import { safeUpdateDoc } from "../../lib/firestoreWrite";
import {
  ArrowLeft, Plus, X, Printer, MessageCircle, Lock,
} from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import type {
  Quotation, QuotationStatus, InvoiceLineItem, DiscountType, ServiceCenter,
} from "../../types/auth";
import { LoadingScreen } from "../../components/LoadingProgress";
import { usePrintDocument } from "../../hooks/usePrintDocument";

function formatDate(ts: { toDate: () => Date } | undefined): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatLKR(n: number): string {
  return `LKR ${n.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_CHIP: Record<QuotationStatus, string> = {
  draft:    "bg-gray-500/20 text-gray-300 border border-gray-500/30",
  sent:     "bg-blue-500/20 text-blue-300 border border-blue-500/30",
  accepted: "bg-green-500/20 text-green-300 border border-green-500/30",
  rejected: "bg-red-500/20 text-red-300 border border-red-500/30",
  expired:  "bg-amber-500/20 text-amber-300 border border-amber-500/30",
};
const STATUS_LABEL: Record<QuotationStatus, string> = {
  draft: "Draft", sent: "Sent", accepted: "Accepted", rejected: "Rejected", expired: "Expired",
};

function calcTotals(items: InvoiceLineItem[], discount: number, discountType: DiscountType, tax: number) {
  const subtotal = items.reduce((s, l) => s + l.lineTotal, 0);
  const discountAmount = discountType === "percent"
    ? Math.round((subtotal * discount) / 100 * 100) / 100
    : discount;
  const grandTotal = Math.max(0, subtotal - discountAmount + tax);
  return { subtotal, discountAmount, grandTotal };
}

export default function QuotationDetailPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const { quotationId } = useParams<{ quotationId: string }>();

  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [loading, setLoading] = useState(true);
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [discountType, setDiscountType] = useState<DiscountType>("amount");
  const [tax, setTax] = useState(0);
  const [notes, setNotes] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");

  const [centerName, setCenterName] = useState("");
  const [centerAddress, setCenterAddress] = useState("");
  const [centerPhone, setCenterPhone] = useState("");
  const [centerLogoUrl, setCenterLogoUrl] = useState("");

  const canViewDetail = usePermission("quotations.viewDetail");
  const canEditQuotation = usePermission("quotations.edit");
  const canDownloadPdf = usePermission("quotations.downloadPdf");
  const canShareWhatsapp = usePermission("quotations.shareWhatsapp");

  // Prints under the quotation number instead of the app name — that string
  // is what the browser puts in its print header and in the "Save as PDF"
  // filename — and offers the one-time header/footer setup steps.
  const { print: handlePrint, setupDialog } = usePrintDocument(quotation?.quotationNumber);

  useEffect(() => {
    if (!quotationId || !currentUser?.centerId) return;
    return onSnapshot(
      doc(db, "servicecenters", currentUser.centerId, "quotations", quotationId),
      (snap) => {
        if (!snap.exists()) { navigate("/quotations"); return; }
        const q = { id: snap.id, ...snap.data() } as Quotation;
        setQuotation(q);
        setLineItems(q.lineItems ?? []);
        setDiscount(q.discount ?? 0);
        setDiscountType(q.discountType ?? "amount");
        setTax(q.tax ?? 0);
        setNotes(q.notes ?? "");
        setDirty(false);
        setLoading(false);
      },
    );
  }, [quotationId, currentUser?.centerId, navigate]);

  useEffect(() => {
    if (!currentUser?.centerId) return;
    getDoc(doc(db, "servicecenters", currentUser.centerId)).then((snap) => {
      if (snap.exists()) {
        const d = snap.data() as ServiceCenter;
        setCenterName(d.name ?? "");
        setCenterAddress(d.address ?? "");
        setCenterPhone(d.phone ?? "");
        setCenterLogoUrl(d.logoUrl ?? "");
      }
    });
  }, [currentUser?.centerId]);

  if (!loading && !canViewDetail) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <Lock className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to view Quotations.</p>
        </div>
      </div>
    );
  }

  if (loading) return <LoadingScreen />;
  if (!quotation) return null;

  const isTerminal = quotation.status === "accepted" || quotation.status === "rejected" || quotation.status === "expired";
  const isEditable = !isTerminal && canEditQuotation;

  const { subtotal, discountAmount, grandTotal } = calcTotals(lineItems, discount, discountType, tax);

  function updateItem(idx: number, field: keyof InvoiceLineItem, value: string) {
    setLineItems((prev) => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [field]: field === "description" ? value : parseFloat(value) || 0 };
      updated.lineTotal = Math.round(updated.qty * updated.unitPrice * 100) / 100;
      return updated;
    }));
    setDirty(true);
  }

  function addRow() {
    setLineItems((prev) => [...prev, { description: "", qty: 1, unitPrice: 0, lineTotal: 0 }]);
    setDirty(true);
  }

  function deleteRow(idx: number) {
    setLineItems((prev) => prev.filter((_, i) => i !== idx));
    setDirty(true);
  }

  async function handleSave() {
    if (!quotation || !currentUser?.centerId) return;
    setSaving(true);
    setActionError("");
    try {
      await safeUpdateDoc(doc(db, "servicecenters", currentUser.centerId, "quotations", quotation.id), {
        lineItems,
        subtotal,
        discount,
        discountType,
        tax,
        grandTotal,
        notes,
        updatedAt: serverTimestamp(),
      });
      setDirty(false);
    } catch {
      setActionError("Failed to save changes.");
    }
    setSaving(false);
  }

  async function setStatus(status: QuotationStatus) {
    if (!quotation || !currentUser?.centerId) return;
    setSaving(true);
    setActionError("");
    try {
      await safeUpdateDoc(doc(db, "servicecenters", currentUser.centerId, "quotations", quotation.id), {
        status,
        updatedAt: serverTimestamp(),
      });
    } catch {
      setActionError("Failed to update status.");
    }
    setSaving(false);
  }


  const handleWhatsApp = () => {
    if (!quotation) return;
    const phone = quotation.customerPhone.replace(/[^0-9]/g, "");
    const number = phone.startsWith("0") ? `94${phone.slice(1)}` : phone;
    const validText = quotation.validUntil ? ` Valid until ${formatDate(quotation.validUntil)}.` : "";
    const msg = encodeURIComponent(
      `Dear ${quotation.customerName}, here is your quotation ${quotation.quotationNumber} for vehicle ${quotation.plateNumber}. Total: ${formatLKR(quotation.grandTotal)}.${validText} — ${centerName}, ${centerPhone}`,
    );
    window.open(`https://wa.me/${number}?text=${msg}`, "_blank");
  };

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #quotation-print, #quotation-print * { visibility: visible !important; }
          #quotation-print {
            position: fixed; inset: 0;
            background: white; color: black;
            padding: 32px; font-family: sans-serif;
          }
        }
      `}</style>

      <div className="min-h-screen bg-[#0B1120] text-white print:hidden">
        {/* Page header */}
        <div className="border-b border-white/10 bg-[#0B1120]/80 backdrop-blur sticky top-0 z-10">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate("/quotations")} className="text-gray-400 hover:text-white">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wider">Quotation</div>
                <div className="text-lg font-bold font-mono">{quotation.quotationNumber}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canDownloadPdf && (
                <button
                  onClick={handlePrint}
                  className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg text-sm"
                >
                  <Printer className="w-4 h-4" />
                  <span className="hidden sm:inline">Print / PDF</span>
                </button>
              )}
              {canShareWhatsapp && (
                <button
                  onClick={handleWhatsApp}
                  className="flex items-center gap-2 bg-green-600/20 hover:bg-green-600/30 text-green-400 px-3 py-1.5 rounded-lg text-sm"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span className="hidden sm:inline">WhatsApp</span>
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
          {/* Status + actions */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <span className={`text-sm font-semibold px-3 py-1 rounded-full ${STATUS_CHIP[quotation.status]}`}>
                {STATUS_LABEL[quotation.status]}
              </span>
              {isTerminal && (
                <span className="flex items-center gap-1.5 text-xs text-gray-500">
                  <Lock className="w-3.5 h-3.5" />
                  Quotation closed
                </span>
              )}
              {quotation.validUntil && (
                <span className="text-xs text-gray-500">Valid until {formatDate(quotation.validUntil)}</span>
              )}
            </div>
            {canEditQuotation && (
              <div className="flex items-center gap-2">
                {quotation.status === "draft" && (
                  <button onClick={() => setStatus("sent")} disabled={saving} className="text-xs font-medium bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border border-blue-500/20 px-3 py-1.5 rounded-lg transition disabled:opacity-50">
                    Mark as Sent
                  </button>
                )}
                {quotation.status === "sent" && (
                  <>
                    <button onClick={() => setStatus("accepted")} disabled={saving} className="text-xs font-medium bg-green-500/15 hover:bg-green-500/25 text-green-300 border border-green-500/20 px-3 py-1.5 rounded-lg transition disabled:opacity-50">
                      Mark Accepted
                    </button>
                    <button onClick={() => setStatus("rejected")} disabled={saving} className="text-xs font-medium bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/20 px-3 py-1.5 rounded-lg transition disabled:opacity-50">
                      Mark Rejected
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {actionError && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-3 py-2 text-sm">
              {actionError}
            </div>
          )}

          {/* Customer + Vehicle */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">Customer</div>
              <div className="font-semibold text-white text-lg">{quotation.customerName}</div>
              <div className="text-sm text-gray-400">{quotation.customerPhone}</div>
              <Link to={`/customers/${quotation.customerId}`} className="text-xs text-orange-400 hover:text-orange-300 mt-1 inline-block">
                View Customer →
              </Link>
            </div>
            <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">Vehicle</div>
              <div className="font-bold text-white text-xl font-mono">{quotation.plateNumber}</div>
              <div className="text-sm text-gray-400 mt-0.5">Quote date: {formatDate(quotation.quoteDate)}</div>
            </div>
          </div>

          {/* Line Items */}
          <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-4">Line Items</div>

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
                      disabled={!isEditable}
                      placeholder="Description"
                      className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <input
                      type="number"
                      value={item.qty}
                      min="0"
                      step="0.01"
                      onChange={(e) => updateItem(idx, "qty", e.target.value)}
                      disabled={!isEditable}
                      className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:border-orange-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-3">
                    <input
                      type="number"
                      value={item.unitPrice}
                      min="0"
                      step="0.01"
                      onChange={(e) => updateItem(idx, "unitPrice", e.target.value)}
                      disabled={!isEditable}
                      className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:border-orange-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div className="col-span-3 sm:col-span-2 flex items-center justify-end gap-2">
                    <span className="text-sm text-white text-right whitespace-nowrap">{formatLKR(item.lineTotal)}</span>
                    {isEditable && lineItems.length > 1 && (
                      <button onClick={() => deleteRow(idx)} className="text-gray-600 hover:text-red-400 flex-shrink-0">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {isEditable && (
              <button onClick={addRow} className="mt-3 flex items-center gap-1.5 text-sm text-orange-400 hover:text-orange-300">
                <Plus className="w-4 h-4" />
                Add Row
              </button>
            )}
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
                  {isEditable && (
                    <button
                      onClick={() => { setDiscountType((t) => (t === "amount" ? "percent" : "amount")); setDirty(true); }}
                      className="text-xs bg-white/10 hover:bg-white/20 px-2 py-0.5 rounded text-gray-300"
                    >
                      {discountType === "amount" ? "LKR" : "%"}
                    </button>
                  )}
                </div>
                <input
                  type="number"
                  value={discount}
                  min="0"
                  step="0.01"
                  disabled={!isEditable}
                  onChange={(e) => { setDiscount(parseFloat(e.target.value) || 0); setDirty(true); }}
                  className="w-28 bg-white/5 border border-white/10 text-white rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:border-orange-500 disabled:opacity-60"
                />
              </div>
              <div className="flex items-center justify-between text-sm gap-3">
                <span className="text-gray-400">Tax (LKR)</span>
                <input
                  type="number"
                  value={tax}
                  min="0"
                  step="0.01"
                  disabled={!isEditable}
                  onChange={(e) => { setTax(parseFloat(e.target.value) || 0); setDirty(true); }}
                  className="w-28 bg-white/5 border border-white/10 text-white rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:border-orange-500 disabled:opacity-60"
                />
              </div>
              <div className="border-t border-white/10 pt-3 flex justify-between text-base font-bold">
                <span className="text-white">Grand Total</span>
                <span className="text-white">{formatLKR(grandTotal)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="bg-[#162032] border border-white/10 rounded-xl p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Notes</div>
            <textarea
              value={notes}
              disabled={!isEditable}
              onChange={(e) => { setNotes(e.target.value); setDirty(true); }}
              rows={2}
              placeholder="Notes for the customer…"
              className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500 disabled:opacity-60 resize-none"
            />
          </div>

          {isEditable && dirty && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-[#F97316] hover:bg-orange-600 text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
          )}
        </div>
      </div>

      {/* ── Print layout ─────────────────────────────────────────────────────── */}
      <div id="quotation-print" className="hidden print:block bg-white text-black">
        <div className="flex justify-between items-start mb-8 pb-6 border-b-2 border-gray-200">
          <div className="flex items-start gap-4">
            {centerLogoUrl && (
              <img src={centerLogoUrl} alt="" style={{ width: 64, height: 64, objectFit: "contain", borderRadius: 8, border: "1px solid #e5e7eb" }} />
            )}
            <div>
              <div className="text-2xl font-extrabold text-gray-900">{centerName}</div>
              <div className="text-sm text-gray-500 mt-1">{centerAddress}</div>
              {centerPhone && <div className="text-sm text-gray-500">{centerPhone}</div>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xl font-bold text-gray-800">QUOTATION</div>
            <div className="font-mono text-gray-600 mt-1">{quotation.quotationNumber}</div>
            <div className="text-sm text-gray-500 mt-1">{formatDate(quotation.quoteDate)}</div>
            {quotation.validUntil && (
              <div className="text-sm text-gray-500 mt-0.5">Valid until {formatDate(quotation.validUntil)}</div>
            )}
            <div className={`mt-2 inline-block text-xs font-bold px-3 py-1 rounded-full ${
              quotation.status === "accepted" ? "bg-green-100 text-green-700" :
              quotation.status === "rejected" ? "bg-red-100 text-red-700" :
              quotation.status === "sent" ? "bg-blue-100 text-blue-700" :
              "bg-gray-100 text-gray-700"
            }`}>
              {STATUS_LABEL[quotation.status]}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 mb-8">
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Quoted To</div>
            <div className="font-semibold text-gray-900">{quotation.customerName}</div>
            <div className="text-sm text-gray-600">{quotation.customerPhone}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Vehicle</div>
            <div className="font-bold text-gray-900">{quotation.plateNumber}</div>
          </div>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "24px" }}>
          <thead>
            <tr style={{ backgroundColor: "#f3f4f6", borderBottom: "2px solid #e5e7eb" }}>
              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: "12px", color: "#6b7280", textTransform: "uppercase" }}>Description</th>
              <th style={{ textAlign: "right", padding: "10px 12px", fontSize: "12px", color: "#6b7280", textTransform: "uppercase" }}>Qty</th>
              <th style={{ textAlign: "right", padding: "10px 12px", fontSize: "12px", color: "#6b7280", textTransform: "uppercase" }}>Unit Price</th>
              <th style={{ textAlign: "right", padding: "10px 12px", fontSize: "12px", color: "#6b7280", textTransform: "uppercase" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((item, idx) => (
              <tr key={idx} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "10px 12px", fontSize: "14px" }}>{item.description}</td>
                <td style={{ padding: "10px 12px", fontSize: "14px", textAlign: "right" }}>{item.qty}</td>
                <td style={{ padding: "10px 12px", fontSize: "14px", textAlign: "right" }}>{formatLKR(item.unitPrice)}</td>
                <td style={{ padding: "10px 12px", fontSize: "14px", textAlign: "right", fontWeight: "600" }}>{formatLKR(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ maxWidth: "280px", marginLeft: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "14px", color: "#6b7280" }}>
            <span>Subtotal</span><span>{formatLKR(subtotal)}</span>
          </div>
          {discountAmount > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "14px", color: "#6b7280" }}>
              <span>Discount</span><span>- {formatLKR(discountAmount)}</span>
            </div>
          )}
          {tax > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "14px", color: "#6b7280" }}>
              <span>Tax</span><span>{formatLKR(tax)}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: "18px", fontWeight: "bold", borderTop: "2px solid #e5e7eb", marginTop: "4px" }}>
            <span>Grand Total</span><span>{formatLKR(grandTotal)}</span>
          </div>
        </div>

        {notes && (
          <div style={{ marginTop: "24px" }}>
            <div style={{ fontSize: "12px", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
              Notes
            </div>
            <div style={{ fontSize: "13px", color: "#374151" }}>{notes}</div>
          </div>
        )}

        <div style={{ marginTop: "48px", textAlign: "center", borderTop: "1px solid #e5e7eb", paddingTop: "20px", fontSize: "13px", color: "#9ca3af" }}>
          Thank you for considering us! · {centerName} · {centerPhone}
        </div>
        <div style={{ marginTop: "12px", textAlign: "center", fontSize: "11px", color: "#cbd5e1", letterSpacing: "0.05em" }}>
          Powered by <span style={{ color: "#F97316", fontWeight: 700 }}>PitStop IQ</span>
          {" "}· A product of <span style={{ fontWeight: 500 }}>Lumora Ventures PVT LTD</span>
        </div>
      </div>

      {setupDialog}
    </>
  );
}
