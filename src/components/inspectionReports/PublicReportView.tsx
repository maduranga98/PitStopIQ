import { Download, FileText, ImageOff, Phone, MessageCircle } from "lucide-react";
import { displayItems, resultCounts } from "../../lib/inspectionReports/reportView";
import { whatsAppNumber } from "../../lib/inspectionReports/shareText";
import type { PublicCenterInfo, PublicInspectionMedia, PublicInspectionReport } from "../../types/inspectionReports";

const fmtDate = (ms: number | null) =>
  ms ? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

const STATUS = {
  needs_repair: { label: "Needs repair", chip: "bg-red-500/15 text-red-300 border-red-500/30", row: "bg-red-500/[0.06] border-red-500/20" },
  meets: { label: "Meets", chip: "bg-green-500/10 text-green-300 border-green-500/25", row: "border-white/5" },
  na: { label: "N/A", chip: "bg-white/5 text-gray-400 border-white/10", row: "border-white/5" },
} as const;

function Thumb({ m }: { m: PublicInspectionMedia }) {
  if (m.mediaDeleted || !m.url) {
    return (
      <div className="h-20 w-20 rounded-lg bg-[#0B1120] border border-white/10 flex flex-col items-center justify-center gap-0.5 text-[9px] text-gray-500">
        <ImageOff className="w-4 h-4" /> Photo expired
      </div>
    );
  }
  return (
    <a href={m.url} target="_blank" rel="noreferrer" className="block">
      <img src={m.url} alt={m.name} loading="lazy" className="h-20 w-20 rounded-lg object-cover border border-white/10" />
    </a>
  );
}

/**
 * Read-only report for a customer: summary, results by section with needs-repair
 * first and colour-coded, remarks, photos, observations, recommendations,
 * attachments and the PDF. Shared by the public /i/:token page and the customer
 * portal's detail view.
 */
export default function PublicReportView({ report, center }: { report: PublicInspectionReport; center: PublicCenterInfo }) {
  const sections = report.templateSnapshot.filter((s) => displayItems(s, report.reportOnlyItems, report.results).length > 0);
  const counts = resultCounts(sections, report.reportOnlyItems, report.results);
  const attachments = report.attachmentIds.map((id) => report.media[id]).filter(Boolean);
  const vehicleName = [report.vehicle.make, report.vehicle.model].filter(Boolean).join(" ") || report.vehicle.vehicleType || "—";

  return (
    <div className="min-h-screen bg-[#0B1120] text-white pb-16">
      <div className="border-b border-white/10 bg-[#162032]">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 flex items-center gap-4">
          {center.logoUrl
            ? <img src={center.logoUrl} alt="" className="w-10 h-10 rounded-lg object-contain bg-white/5" />
            : <div className="w-10 h-10 rounded-lg bg-[#F97316]/20 flex items-center justify-center text-[#F97316] font-bold">{center.name.charAt(0)}</div>}
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-400 truncate">{center.name}</p>
            <h1 className="text-lg font-bold">{report.type === "diagnostic" ? "Diagnostic Report" : "Vehicle Inspection Report"}</h1>
          </div>
          {report.pdfUrl && (
            <a href={report.pdfUrl} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 bg-[#F97316] hover:bg-[#ea6c0f] text-white text-xs font-semibold px-3 py-2 rounded-lg">
              <Download className="w-3.5 h-3.5" /> PDF
            </a>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono font-bold text-lg">{report.vehicle.plateNumber}</p>
              <p className="text-xs text-gray-400">{vehicleName}</p>
            </div>
            <span className="text-xs px-2.5 py-1 rounded-full bg-[#F97316]/10 text-[#F97316] border border-[#F97316]/20">{report.reportNumber}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-4 text-xs text-gray-400">
            <div>Customer: <span className="text-white">{report.customerName}</span></div>
            <div>Date: <span className="text-white">{fmtDate(report.reportDateMillis)}</span></div>
            <div>Mileage: <span className="text-white">{report.mileage != null ? `${report.mileage.toLocaleString("en-US")} km` : "—"}</span></div>
            <div>Inspector: <span className="text-white">{report.inspectorName || "—"}</span></div>
          </div>
          {sections.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              <span className={`text-[11px] px-2.5 py-1 rounded-full border ${counts.needs_repair ? STATUS.needs_repair.chip : STATUS.na.chip}`}>{counts.needs_repair} need repair</span>
              <span className={`text-[11px] px-2.5 py-1 rounded-full border ${STATUS.meets.chip}`}>{counts.meets} meet requirements</span>
              <span className={`text-[11px] px-2.5 py-1 rounded-full border ${STATUS.na.chip}`}>{counts.na} N/A</span>
            </div>
          )}
        </div>

        {report.type === "diagnostic" && (report.title || report.findings) && (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-5 space-y-2">
            {report.title && <h2 className="font-semibold">{report.title}</h2>}
            {report.findings && <p className="text-sm text-gray-300 whitespace-pre-wrap">{report.findings}</p>}
          </div>
        )}

        {sections.map((section) => (
          <div key={section.id} className="bg-[#162032] border border-white/10 rounded-2xl overflow-hidden">
            <h2 className="px-5 py-3 text-sm font-semibold border-b border-white/5">{section.title}</h2>
            <div>
              {displayItems(section, report.reportOnlyItems, report.results).map((item) => {
                const st = item.status ? STATUS[item.status] : null;
                const photos = item.photoIds.map((id) => report.media[id]).filter(Boolean);
                return (
                  <div key={item.id} className={`px-5 py-3 border-t first:border-t-0 ${st?.row ?? "border-white/5"}`}>
                    <div className="flex items-start gap-3">
                      <p className="flex-1 text-sm text-gray-200 leading-snug">{item.label}</p>
                      {st && <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${st.chip}`}>{st.label}</span>}
                    </div>
                    {item.remark && <p className="text-xs text-gray-400 mt-1.5 italic whitespace-pre-wrap">{item.remark}</p>}
                    {photos.length > 0 && <div className="flex flex-wrap gap-2 mt-2.5">{photos.map((m) => <Thumb key={m.id} m={m} />)}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {report.observations.trim() && (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-5">
            <h2 className="text-sm font-semibold mb-2">Observations</h2>
            <p className="text-sm text-gray-300 whitespace-pre-wrap">{report.observations}</p>
          </div>
        )}
        {report.recommendations.trim() && (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-5">
            <h2 className="text-sm font-semibold mb-2">Recommendations</h2>
            <p className="text-sm text-gray-300 whitespace-pre-wrap">{report.recommendations}</p>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-5 space-y-3">
            <h2 className="text-sm font-semibold">Attachments</h2>
            {attachments.map((a) => (
              <div key={a.id}>
                {a.mimeType === "application/pdf" ? (
                  a.url ? (
                    <a href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-[#F97316] hover:text-orange-300">
                      <FileText className="w-4 h-4" /> {a.name}
                    </a>
                  ) : <p className="text-xs text-gray-500">{a.name} is no longer available.</p>
                ) : a.mediaDeleted || !a.url ? (
                  <p className="flex items-center gap-1.5 text-xs text-gray-500"><ImageOff className="w-4 h-4" /> {a.name} — photo expired</p>
                ) : (
                  <a href={a.url} target="_blank" rel="noreferrer" className="block">
                    <img src={a.url} alt={a.name} loading="lazy" className="w-full rounded-lg border border-white/10" />
                    <span className="text-[11px] text-gray-500">{a.name}</span>
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="bg-[#162032] border border-white/10 rounded-2xl p-5 space-y-3">
          {report.signatureName && <p className="text-sm">Signed by <span className="font-semibold">{report.signatureName}</span>{report.finalizedAtMillis ? ` · ${fmtDate(report.finalizedAtMillis)}` : ""}</p>}
          {report.disclaimer && <p className="text-[11px] text-gray-500 leading-relaxed">{report.disclaimer}</p>}
        </div>

        {center.phone && (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-5 flex items-center justify-between flex-wrap gap-3">
            <a href={`tel:${center.phone}`} className="flex items-center gap-2 text-sm text-gray-300 hover:text-white"><Phone className="w-4 h-4" /> {center.phone}</a>
            <a href={`https://wa.me/${whatsAppNumber(center.phone)}`} target="_blank" rel="noreferrer"
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm px-4 py-2 rounded-lg">
              <MessageCircle className="w-4 h-4" /> WhatsApp Us
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
