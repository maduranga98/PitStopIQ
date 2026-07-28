import { Printer, X } from "lucide-react";
import {
  PAYMENT_LABEL, billedLines, clearanceLabel, formatDate, formatLKR,
  invoiceNumberFor, isReturned,
  type PortalCenter, type PortalOrder,
} from "../../lib/distributorPortal";

// A released order, rendered as the bill the distributor can keep: the service
// center's own header on top, the lines that were actually handed over, and
// what has been paid against it. Printing is how it downloads — every browser
// offers "Save as PDF" from the print dialog, which keeps this page free of a
// PDF library it would otherwise have to ship to an unauthenticated visitor.

const PRINT_STYLES = `
  @media print {
    body * { visibility: hidden !important; }
    #distributor-invoice-print, #distributor-invoice-print * { visibility: visible !important; }
    #distributor-invoice-print {
      position: fixed; inset: 0; margin: 0; padding: 32px;
      background: white; color: black;
      max-height: none; overflow: visible;
      box-shadow: none; border-radius: 0; border: none;
    }
    .no-print { display: none !important; }
  }
`;

export function DistributorInvoiceModal({
  order, center, distributor, onClose,
}: {
  order: PortalOrder;
  center: PortalCenter;
  distributor: { name: string; contactPerson: string | null; phone: string | null };
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center overflow-y-auto py-6">
      <style>{PRINT_STYLES}</style>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm no-print" onClick={onClose} />

      <div className="relative w-full sm:max-w-3xl px-3 sm:px-0">
        <div className="flex items-center justify-between gap-3 mb-3 no-print">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white transition"
          >
            <X className="h-4 w-4" /> Close
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white px-4 py-2 rounded-lg text-sm font-semibold transition"
          >
            <Printer className="h-4 w-4" />
            Download / Print
          </button>
        </div>

        <div
          id="distributor-invoice-print"
          className="bg-white text-black rounded-2xl p-6 sm:p-10 shadow-2xl"
        >
          <DistributorInvoiceBody order={order} center={center} distributor={distributor} />
        </div>
      </div>
    </div>
  );
}

export function DistributorInvoiceBody({
  order, center, distributor,
}: {
  order: PortalOrder;
  center: PortalCenter;
  distributor: { name: string; contactPerson: string | null; phone: string | null };
}) {
  const lines = billedLines(order);
  const payments = order.payments ?? [];
  const settled = order.balanceDue <= 0;

  return (
    <>
      {/* Service center header */}
      <div className="flex justify-between items-start mb-8 pb-6 border-b-2 border-gray-200 flex-wrap gap-4">
        <div className="flex items-start gap-4">
          {center.logoUrl && (
            <img
              src={center.logoUrl}
              alt=""
              style={{ width: 64, height: 64, objectFit: "contain", borderRadius: 8, border: "1px solid #e5e7eb" }}
            />
          )}
          <div>
            <div className="text-2xl font-extrabold text-gray-900">{center.name}</div>
            {center.address && (
              <div className="text-sm text-gray-500 mt-1">
                {center.address}{center.district ? `, ${center.district}` : ""}
              </div>
            )}
            {center.phone && <div className="text-sm text-gray-500">{center.phone}</div>}
            {center.email && <div className="text-sm text-gray-500">{center.email}</div>}
            {center.businessRegistrationNumber && (
              <div className="text-xs text-gray-400 mt-1">Reg. No. {center.businessRegistrationNumber}</div>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold text-gray-800">INVOICE</div>
          <div className="font-mono text-gray-600 mt-1">{invoiceNumberFor(order)}</div>
          <div className="text-sm text-gray-500 mt-1">{formatDate(order.finalizedAt ?? order.createdAt)}</div>
          <div className="text-xs text-gray-400 mt-1 font-mono">Order {order.orderNumber}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-8 mb-8">
        <div>
          <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Billed To</div>
          <div className="font-semibold text-gray-900">{distributor.name}</div>
          {distributor.contactPerson && (
            <div className="text-sm text-gray-600">{distributor.contactPerson}</div>
          )}
          {distributor.phone && <div className="text-sm text-gray-600">{distributor.phone}</div>}
        </div>
        <div>
          <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Status</div>
          <div className={`font-bold ${settled ? "text-green-700" : "text-red-700"}`}>
            {settled ? "Settled" : `${formatLKR(order.balanceDue)} outstanding`}
          </div>
          <div className="text-sm text-gray-600">Ordered {formatDate(order.createdAt)}</div>
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "24px" }}>
        <thead>
          <tr style={{ backgroundColor: "#f3f4f6", borderBottom: "2px solid #e5e7eb" }}>
            <th style={TH}>Item</th>
            <th style={{ ...TH, textAlign: "right" }}>Qty</th>
            <th style={{ ...TH, textAlign: "right" }}>Unit Price</th>
            <th style={{ ...TH, textAlign: "right" }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
              <td style={TD}>
                {line.itemName}
                {line.approvedQty !== line.requestedQty && (
                  <span style={{ color: "#b45309", fontSize: 12 }}>
                    {" "}({line.requestedQty} {line.unit} requested)
                  </span>
                )}
              </td>
              <td style={{ ...TD, textAlign: "right" }}>{line.approvedQty} {line.unit}</td>
              <td style={{ ...TD, textAlign: "right" }}>{formatLKR(line.unitPrice)}</td>
              <td style={{ ...TD, textAlign: "right", fontWeight: 600 }}>{formatLKR(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ maxWidth: 300, marginLeft: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 18, fontWeight: "bold", borderTop: "2px solid #e5e7eb" }}>
          <span>Grand Total</span><span>{formatLKR(order.total)}</span>
        </div>
        <Row label="Amount Paid" value={formatLKR(order.receivedTotal)} color="#16a34a" />
        {order.creditTotal > 0 && (
          <Row label="On Credit" value={formatLKR(order.creditTotal)} color="#b45309" />
        )}
        <Row
          label="Balance Due"
          value={formatLKR(order.balanceDue)}
          color={settled ? "#16a34a" : "#dc2626"}
          bold
        />
      </div>

      {/* What was paid, and how — cash, cheques and credit each spelled out. */}
      {payments.length > 0 && (
        <div style={{ marginTop: 32, borderTop: "1px solid #e5e7eb", paddingTop: 16 }}>
          <div style={{ fontSize: 12, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
            Payment Details
          </div>
          {payments.map(p => (
            <div
              key={p.id}
              style={{
                display: "flex", justifyContent: "space-between", gap: 16,
                padding: "6px 0", fontSize: 13, color: "#374151",
              }}
            >
              <span>
                {PAYMENT_LABEL[p.method]} · {formatDate(p.date)}
                {p.method === "cheque" && p.chequeNumber && (
                  <> — No. {p.chequeNumber}{p.bank ? `, ${p.bank}` : ""}
                    {p.branch ? `, ${p.branch}` : ""}
                    {p.chequeDate ? `, dated ${formatDate(p.chequeDate)}` : ""}</>
                )}
                <span
                  style={{
                    color: isReturned(p) ? "#dc2626" : p.clearance === "cleared" || p.method === "cash" ? "#16a34a" : "#b45309",
                    fontWeight: 600,
                  }}
                >
                  {" "}· {clearanceLabel(p)}
                </span>
              </span>
              <span style={{ whiteSpace: "nowrap", textDecoration: isReturned(p) ? "line-through" : "none" }}>
                {formatLKR(p.amount)}
              </span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 8 }}>
            A cheque shows as cleared, and credit as settled, once {center.name} confirms it.
          </div>
        </div>
      )}

      {order.reviewNote && (
        <div style={{ marginTop: 24, fontSize: 13, color: "#6b7280" }}>
          <span style={{ fontWeight: 600 }}>Note from {center.name}:</span> {order.reviewNote}
        </div>
      )}

      <div style={{ marginTop: 48, textAlign: "center", borderTop: "1px solid #e5e7eb", paddingTop: 20, fontSize: 13, color: "#9ca3af" }}>
        Thank you for your business! · {center.name}{center.phone ? ` · ${center.phone}` : ""}
      </div>
      <div style={{ marginTop: 12, textAlign: "center", fontSize: 11, color: "#cbd5e1", letterSpacing: "0.05em" }}>
        Powered by <span style={{ color: "#F97316", fontWeight: 700 }}>PitStop IQ</span>
      </div>
    </>
  );
}

const TH: React.CSSProperties = {
  textAlign: "left", padding: "10px 12px", fontSize: "12px",
  color: "#6b7280", textTransform: "uppercase",
};

const TD: React.CSSProperties = { padding: "10px 12px", fontSize: "14px" };

function Row({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 14, color: color ?? "#6b7280", fontWeight: bold ? 600 : 400 }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}
