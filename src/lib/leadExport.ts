import { downloadCSV } from "./csvExport";
import { OUTCOME_LABEL, STAGE_META, TAG_META, type Lead, type LeadCall } from "../types/leads";
import { FEATURE_STATUS_META, FEATURE_TYPE_META, type FeatureRequest } from "../types/devTracker";

function when(ts?: { toDate: () => Date } | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** Everything the export needs, gathered once by the caller. */
export interface LeadExportBundle {
  lead: Lead;
  calls: LeadCall[];
  featureRequests: FeatureRequest[];
}

export function exportLeadCSV(bundle: LeadExportBundle): void {
  const { lead, calls, featureRequests } = bundle;
  const rows: string[][] = [
    ["Section", "Field", "Value"],
    ["Service center", "Business name", lead.businessName ?? ""],
    ["Service center", "Contact", lead.contactName ?? ""],
    ["Service center", "Phone", lead.phone ?? ""],
    ["Service center", "Email", lead.email ?? ""],
    ["Service center", "Location", lead.location ?? ""],
    ["Service center", "Status", STAGE_META[lead.stage].label],
    ["Service center", "Calls made", String(lead.callCount ?? 0)],
    ["Service center", "Closed amount (Rs)", lead.closedAmount ? String(lead.closedAmount) : ""],
    ["Service center", "Notes", lead.notes ?? ""],
    ...calls.map((c) => [
      "Call log",
      `Call #${c.callNumber} — ${OUTCOME_LABEL[c.outcome] ?? c.outcome} — ${when(c.createdAt)}`,
      c.note ?? "",
    ]),
    ...featureRequests.map((f) => [
      `${FEATURE_TYPE_META[f.type].label} request`,
      `${f.title} (${FEATURE_STATUS_META[f.status].label})`,
      f.featurePath ? `How to test: ${f.featurePath}` : f.description,
    ]),
  ];
  downloadCSV(`${(lead.businessName || "customer").replace(/\s+/g, "-").toLowerCase()}-details.csv`, rows[0], rows.slice(1));
}

export async function exportLeadPDF(bundle: LeadExportBundle): Promise<void> {
  const { lead, calls, featureRequests } = bundle;
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 40;
  let y = 50;

  function ensureSpace(lines = 1) {
    if (y > doc.internal.pageSize.getHeight() - 60 * lines) {
      doc.addPage();
      y = 50;
    }
  }

  function heading(text: string) {
    ensureSpace(2);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(text, marginX, y);
    y += 18;
    doc.setDrawColor(200);
    doc.line(marginX, y - 8, pageWidth - marginX, y - 8);
  }

  function line(label: string, value: string) {
    if (!value) return;
    ensureSpace();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(label, marginX, y);
    doc.setFont("helvetica", "normal");
    const wrapped = doc.splitTextToSize(value, pageWidth - marginX * 2 - 120);
    doc.text(wrapped, marginX + 120, y);
    y += Math.max(14, wrapped.length * 12);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(lead.businessName || "Customer details", marginX, y);
  y += 26;

  heading("Service center details");
  line("Contact", lead.contactName ?? "");
  line("Phone", lead.phone ?? "");
  line("Email", lead.email ?? "");
  line("Location", [lead.location, lead.district].filter(Boolean).join(", "));
  line("Status", STAGE_META[lead.stage].label);
  line("Calls made", String(lead.callCount ?? 0));
  if (lead.closedAmount) line("Closed amount", `Rs ${lead.closedAmount.toLocaleString("en-LK")}`);
  line("Notes", lead.notes ?? "");
  y += 8;

  heading(`Call log (${calls.length})`);
  if (calls.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.text("Nothing logged yet.", marginX, y);
    y += 16;
  }
  for (const c of calls) {
    ensureSpace(2);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(
      `${c.callNumber > 0 ? `Call #${c.callNumber}` : "Note"} — ${OUTCOME_LABEL[c.outcome] ?? c.outcome} — ${when(c.createdAt)}`,
      marginX, y,
    );
    y += 12;
    if (c.note) {
      doc.setFont("helvetica", "normal");
      const wrapped = doc.splitTextToSize(c.note, pageWidth - marginX * 2);
      doc.text(wrapped, marginX, y);
      y += wrapped.length * 12 + 4;
    }
    if (c.tags?.length) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.text(`Tags: ${c.tags.map((t) => TAG_META[t].label).join(", ")}`, marginX, y);
      y += 12;
    }
    y += 4;
  }

  heading(`Feature requests & bugs (${featureRequests.length})`);
  if (featureRequests.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.text("None raised.", marginX, y);
    y += 16;
  }
  for (const f of featureRequests) {
    ensureSpace(2);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(
      `[${FEATURE_TYPE_META[f.type].label}] ${f.title} — ${FEATURE_STATUS_META[f.status].label}`,
      marginX, y,
    );
    y += 12;
    doc.setFont("helvetica", "normal");
    const desc = f.description || "";
    if (desc) {
      const wrapped = doc.splitTextToSize(desc, pageWidth - marginX * 2);
      doc.text(wrapped, marginX, y);
      y += wrapped.length * 12 + 2;
    }
    if (f.featurePath) {
      ensureSpace();
      doc.setFontSize(8);
      const wrappedPath = doc.splitTextToSize(`How to test: ${f.featurePath}`, pageWidth - marginX * 2);
      doc.text(wrappedPath, marginX, y);
      y += wrappedPath.length * 10 + 2;
    }
    y += 6;
  }

  doc.save(`${(lead.businessName || "customer").replace(/\s+/g, "-").toLowerCase()}-details.pdf`);
}
