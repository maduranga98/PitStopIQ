import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { doc, getDoc, Timestamp } from "firebase/firestore";
import { AlertCircle, ArrowLeft, Printer } from "lucide-react";
import { db } from "../../config/firebase";
import type { Invoice, ServiceCenter } from "../../types/auth";

function fmtDate(ts?: Timestamp) {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtLKR(n?: number) {
  return `LKR ${(n ?? 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PublicInvoiceView() {
  const { centerId, customerId, invoiceId } = useParams<{
    centerId: string; customerId: string; invoiceId: string;
  }>();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [center, setCenter] = useState<Pick<ServiceCenter, "name" | "address" | "phone" | "logoUrl"> | null>(null);

  useEffect(() => {
    if (!centerId || !customerId || !invoiceId) return;
    (async () => {
      try {
        const [invSnap, centerSnap] = await Promise.all([
          getDoc(doc(db, "servicecenters", centerId, "invoices", invoiceId)),
          getDoc(doc(db, "servicecenters", centerId)),
        ]);
        if (!invSnap.exists()) { setNotFound(true); setLoading(false); return; }
        const inv = { id: invSnap.id, ...invSnap.data() } as Invoice;
        // Authorize: invoice must belong to the customer in the URL.
        if (inv.customerId !== customerId) { setNotFound(true); setLoading(false); return; }
        // Only finalized invoices are public.
        if (!inv.finalized && !inv.smsSent && inv.status === "pending") {
          setNotFound(true); setLoading(false); return;
        }
        setInvoice(inv);
        if (centerSnap.exists()) {
          const d = centerSnap.data() as ServiceCenter;
          setCenter({ name: d.name, address: d.address, phone: d.phone, logoUrl: d.logoUrl });
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [centerId, customerId, invoiceId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#F97316] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !invoice) {
    return (
      <div className="min-h-screen bg-[#0B1120] text-white flex flex-col items-center justify-center gap-3 p-6">
        <AlertCircle className="w-10 h-10 text-gray-500" />
        <p className="text-gray-400 text-center">Invoice not found or not yet released.</p>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #invoice-print, #invoice-print * { visibility: visible !important; }
          #invoice-print { position: fixed; inset: 0; background: white; color: black; padding: 32px; }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* On-screen */}
      <div className="min-h-screen bg-[#0B1120] text-white print:hidden no-print">
        <div className="border-b border-white/10 bg-[#162032]">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
            <Link to={`/c/${centerId}/${customerId}`} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm">
              <ArrowLeft className="w-4 h-4" /> Back
            </Link>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white px-4 py-2 rounded-lg text-sm font-semibold"
            >
              <Printer className="w-4 h-4" />
              Download / Print
            </button>
          </div>
        </div>

        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
          <div className="bg-white text-black rounded-2xl p-6 sm:p-10 shadow-2xl">
            <InvoiceBody invoice={invoice} center={center} />
          </div>
        </div>
      </div>

      {/* Print-only layout */}
      <div id="invoice-print" className="hidden print:block bg-white text-black">
        <InvoiceBody invoice={invoice} center={center} />
      </div>
    </>
  );
}

function InvoiceBody({ invoice, center }: {
  invoice: Invoice;
  center: Pick<ServiceCenter, "name" | "address" | "phone" | "logoUrl"> | null;
}) {
  return (
    <>
      <div className="flex justify-between items-start mb-8 pb-6 border-b-2 border-gray-200 flex-wrap gap-4">
        <div>
          <div className="text-2xl font-extrabold text-gray-900">{center?.name ?? ""}</div>
          {center?.address && <div className="text-sm text-gray-500 mt-1">{center.address}</div>}
          {center?.phone && <div className="text-sm text-gray-500">{center.phone}</div>}
        </div>
        <div className="text-right">
          <div className="text-xl font-bold text-gray-800">INVOICE</div>
          <div className="font-mono text-gray-600 mt-1">{invoice.invoiceNumber}</div>
          <div className="text-sm text-gray-500 mt-1">{fmtDate(invoice.serviceDate)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-8 mb-8">
        <div>
          <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Bill To</div>
          <div className="font-semibold text-gray-900">{invoice.customerName}</div>
          <div className="text-sm text-gray-600">{invoice.customerPhone}</div>
        </div>
        <div>
          <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Vehicle</div>
          <div className="font-bold text-gray-900">{invoice.plateNumber}</div>
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
          {invoice.lineItems?.map((it, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
              <td style={{ padding: "10px 12px", fontSize: "14px" }}>{it.description}</td>
              <td style={{ padding: "10px 12px", fontSize: "14px", textAlign: "right" }}>{it.qty}</td>
              <td style={{ padding: "10px 12px", fontSize: "14px", textAlign: "right" }}>{fmtLKR(it.unitPrice)}</td>
              <td style={{ padding: "10px 12px", fontSize: "14px", textAlign: "right", fontWeight: 600 }}>{fmtLKR(it.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ maxWidth: 280, marginLeft: "auto" }}>
        <Row label="Subtotal" value={fmtLKR(invoice.subtotal)} />
        {(invoice.discount ?? 0) > 0 && (
          <Row label="Discount" value={`- ${fmtLKR(invoice.discountType === "percent" ? (invoice.subtotal * invoice.discount) / 100 : invoice.discount)}`} />
        )}
        {(invoice.tax ?? 0) > 0 && <Row label="Tax" value={fmtLKR(invoice.tax)} />}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 18, fontWeight: "bold", borderTop: "2px solid #e5e7eb", marginTop: 4 }}>
          <span>Grand Total</span><span>{fmtLKR(invoice.grandTotal)}</span>
        </div>
        <Row label="Amount Paid" value={fmtLKR(invoice.paidAmount)} color="#16a34a" />
        <Row label="Balance Due" value={fmtLKR(invoice.status === "paid" ? 0 : invoice.balanceDue)} color={invoice.status === "paid" ? "#16a34a" : "#dc2626"} bold />
      </div>

      <div style={{ marginTop: 48, textAlign: "center", borderTop: "1px solid #e5e7eb", paddingTop: 20, fontSize: 13, color: "#9ca3af" }}>
        Thank you for your business! · {center?.name} · {center?.phone}
      </div>
    </>
  );
}

function Row({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 14, color: color ?? "#6b7280", fontWeight: bold ? 600 : 400 }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}
