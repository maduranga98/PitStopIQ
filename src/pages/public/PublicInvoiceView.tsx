import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { doc, Timestamp } from "firebase/firestore";
import { AlertCircle, ArrowLeft, Printer, RefreshCw } from "lucide-react";
import { db } from "../../config/firebase";
import type { Invoice, ServiceCenter } from "../../types/auth";
import { LoadingScreen } from "../../components/LoadingProgress";
import {
  PAYMENT_METHOD_LABEL, clearanceLabel, customerVisiblePayments, isConfirmed,
} from "../../lib/invoicePayments";
import { getDocWithRetry } from "../../lib/firestoreRetry";
import { buildInvoicePrintCss, PRINT_CLASS } from "../../lib/printPaper";
import { useInvoicePrintPaper } from "../../hooks/useInvoicePrintPaper";
import PrintPaperPicker from "../../components/invoices/PrintPaperPicker";
import InvoicePrintRoot from "../../components/invoices/InvoicePrintRoot";
import { usePaperOverride } from "../../hooks/usePaperOverride";
import { usePrintDocument } from "../../hooks/usePrintDocument";

// Only the fields the public page needs — including the paper the center
// prints invoices on, so a shared invoice prints the same shape in-shop.
type PublicCenter = Pick<ServiceCenter, "name" | "address" | "phone" | "logoUrl" | "invoicePaper">;

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
  // Distinct from notFound: a transient read failure (e.g. the offline
  // persistence layer aborting an in-flight request while reclaiming the
  // primary lease from a stale tab) is retryable, not a genuine 404 — see
  // the matching fix in PublicCustomerView.tsx.
  const [loadError, setLoadError] = useState(false);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [center, setCenter] = useState<PublicCenter | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  // Paper the service center prints invoices on, unless the customer picked
  // another size for this download; the hook also owns the @page rule.
  const [paperOverride, setPaperOverride] = usePaperOverride();
  const paper = useInvoicePrintPaper(center, "invoice-print", paperOverride);
  // Names the print after the invoice (so the browser's own header and the
  // "Save as PDF" filename read the invoice number, not "PitstopIQ") and shows
  // the one-time steps for turning the browser's header and footer off.
  const { print, showSetup, setupDialog } = usePrintDocument(invoice?.invoiceNumber, paper.label);

  useEffect(() => {
    if (!centerId || !customerId || !invoiceId) return;
    let active = true;
    (async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const [invSnap, centerSnap] = await Promise.all([
          getDocWithRetry(doc(db, "servicecenters", centerId, "invoices", invoiceId)),
          getDocWithRetry(doc(db, "servicecenters", centerId)),
        ]);
        if (!active) return;
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
          setCenter({ name: d.name, address: d.address, phone: d.phone, logoUrl: d.logoUrl, invoicePaper: d.invoicePaper });
        }
      } catch {
        if (active) setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [centerId, customerId, invoiceId, loadAttempt]);

  if (loading) {
    return (
      <LoadingScreen />
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#0B1120] text-white flex flex-col items-center justify-center gap-3 p-6">
        <AlertCircle className="w-10 h-10 text-gray-500" />
        <p className="text-gray-400 text-center">Couldn't load this invoice. Check your connection and try again.</p>
        <button
          onClick={() => setLoadAttempt((n) => n + 1)}
          className="flex items-center gap-1.5 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2 rounded-lg text-sm transition"
        >
          <RefreshCw className="w-4 h-4" /> Try again
        </button>
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
      {/* Laid out for the paper the service center configured in Settings → Invoice Printing */}
      <style>{buildInvoicePrintCss(paper)}</style>

      {/* On-screen */}
      <div className="min-h-screen bg-[#0B1120] text-white print:hidden no-print">
        <div className="border-b border-white/10 bg-[#162032]">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
            <Link to={`/c/${centerId}/${customerId}`} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm">
              <ArrowLeft className="w-4 h-4" /> Back
            </Link>
            <div className="flex items-start gap-2">
              <PrintPaperPicker
                center={center}
                value={paperOverride}
                onChange={setPaperOverride}
                paper={paper}
                onSetupHelp={showSetup}
              />
              <button
                onClick={print}
                className="flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white px-4 py-2 rounded-lg text-sm font-semibold"
              >
                <Printer className="w-4 h-4" />
                Download / Print
              </button>
            </div>
          </div>
        </div>

        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
          <div className="bg-white text-black rounded-2xl p-6 sm:p-10 shadow-2xl">
            <InvoiceBody invoice={invoice} center={center} />
          </div>
          <p className="text-center text-xs text-gray-500 mt-6">
            Powered by <span className="text-[#F97316] font-bold tracking-wide">PitStop IQ</span>
          </p>
        </div>
      </div>

      {/* Print-only layout — portalled to <body> so it can break across pages */}
      <InvoicePrintRoot>
        <InvoiceBody invoice={invoice} center={center} />
      </InvoicePrintRoot>

      {setupDialog}
    </>
  );
}

function InvoiceBody({ invoice, center }: {
  invoice: Invoice;
  center: PublicCenter | null;
}) {
  return (
    <>
      <div className={`${PRINT_CLASS.header} flex justify-between items-start mb-8 pb-6 border-b-2 border-gray-200 flex-wrap gap-4`}>
        <div className="flex items-start gap-4">
          {center?.logoUrl && (
            <img src={center.logoUrl} alt="" style={{ width: 64, height: 64, objectFit: "contain", borderRadius: 8, border: "1px solid #e5e7eb" }} />
          )}
          <div>
            <div className="text-2xl font-extrabold text-gray-900">{center?.name ?? ""}</div>
            {center?.address && <div className="text-sm text-gray-500 mt-1">{center.address}</div>}
            {center?.phone && <div className="text-sm text-gray-500">{center.phone}</div>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold text-gray-800">INVOICE</div>
          <div className="font-mono text-gray-600 mt-1">{invoice.invoiceNumber}</div>
          <div className="text-sm text-gray-500 mt-1">{fmtDate(invoice.serviceDate)}</div>
        </div>
      </div>

      <div className={`${PRINT_CLASS.parties} grid grid-cols-2 gap-8 mb-8`}>
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

      <div className={PRINT_CLASS.totals} style={{ maxWidth: 280, marginLeft: "auto" }}>
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

      <SettlementBlock invoice={invoice} />

      <div style={{ marginTop: 48, textAlign: "center", borderTop: "1px solid #e5e7eb", paddingTop: 20, fontSize: 13, color: "#9ca3af" }}>
        Thank you for your business! · {center?.name} · {center?.phone}
      </div>
      <div style={{ marginTop: 12, textAlign: "center", fontSize: 11, color: "#cbd5e1", letterSpacing: "0.05em" }}>
        Powered by <span style={{ color: "#F97316", fontWeight: 700 }}>PitStop IQ</span>
      </div>
    </>
  );
}

/**
 * Cheques and credit, spelled out for the customer: which cheque, on which
 * bank, and whether it has cleared — or how much of the bill is still on their
 * tab. A bill settled in cash says nothing here; the totals above already do.
 */
function SettlementBlock({ invoice }: { invoice: Invoice }) {
  const entries = customerVisiblePayments(invoice.payments);
  if (entries.length === 0) return null;

  return (
    <div style={{ marginTop: 32, borderTop: "1px solid #e5e7eb", paddingTop: 16 }}>
      <div style={{ fontSize: 12, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
        Payment Details
      </div>
      {entries.map((p) => {
        const settled = isConfirmed(p);
        return (
          <div
            key={p.id}
            style={{
              display: "flex", justifyContent: "space-between", gap: 16,
              padding: "6px 0", fontSize: 13, color: "#374151",
            }}
          >
            <span>
              {PAYMENT_METHOD_LABEL[p.method]} · {fmtDate(p.date)}
              {p.method === "cheque" && (
                <> — No. {p.chequeNumber}, {p.bank}
                  {p.branch ? `, ${p.branch}` : ""}
                  {p.chequeDate ? `, dated ${fmtDate(p.chequeDate)}` : ""}</>
              )}
              <span style={{ color: settled ? "#16a34a" : "#b45309", fontWeight: 600 }}>
                {" "}· {clearanceLabel(p)}
              </span>
            </span>
            <span style={{ whiteSpace: "nowrap" }}>{fmtLKR(p.amount)}</span>
          </div>
        );
      })}
      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 8 }}>
        A cheque shows as cleared, and credit as settled, once the service center confirms it.
      </div>
    </div>
  );
}

function Row({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 14, color: color ?? "#6b7280", fontWeight: bold ? 600 : 400 }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}
