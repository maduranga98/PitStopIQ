import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Timestamp, arrayRemove, arrayUnion, deleteField } from "firebase/firestore";
import { ArrowLeft, Cloud, CloudOff, Loader2, Trash2 } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { useReportDraft } from "../../hooks/useReportDraft";
import { usePhotoUploadQueue } from "../../hooks/usePhotoUploadQueue";
import { useCachedRefList } from "../../hooks/useCachedRefList";
import { useNetworkStore } from "../../store/networkSlice";
import { fetchTechnicians, invalidateRefData } from "../../lib/refData";
import { staffDisplayName } from "../../lib/jobTechnicians";
import { LoadingBlock } from "../../components/LoadingProgress";
import ChecklistSectionCard from "../../components/inspectionReports/ChecklistSectionCard";
import AttachmentsCard from "../../components/inspectionReports/AttachmentsCard";
import PhotoCaptureModal from "../../components/inspectionReports/PhotoCaptureModal";
import { StatusBadge, TypeBadge } from "../../components/inspectionReports/ReportBadges";
import { processPhoto } from "../../lib/inspectionReports/media";
import { validateAttachment, validatePhoto } from "../../lib/inspectionReports/mediaRules";
import { storeMedia } from "../../lib/inspectionReports/mediaUpload";
import { deleteReportWithMedia, mediaKey, resultKey } from "../../lib/inspectionReports/reports";
import { fetchTemplate, saveTemplateSections } from "../../lib/inspectionReports/templates";
import { addItem } from "../../lib/inspectionReports/templateOps";
import type {
  InspectionItemResult, InspectionMediaItem, InspectionReport, InspectionReportOnlyItem,
  InspectionResultStatus,
} from "../../types/inspectionReports";

const field = "w-full bg-[#0B1120] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#F97316]/60 read-only:opacity-70";
const label = "block text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-1.5";

const EMPTY_RESULT: InspectionItemResult = { status: null, remark: "", photoIds: [] };

const toDateInput = (ts: Timestamp | undefined) => {
  const d = ts?.toDate?.() ?? new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#162032] border border-white/10 rounded-xl p-4 space-y-3">
      {title && <h2 className="text-sm font-semibold text-gray-100">{title}</h2>}
      {children}
    </div>
  );
}

export default function InspectionReportEditorPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const centerId = currentUser?.centerId;
  const role = currentUser?.role;
  const isManager = role === "Owner" || role === "Manager";

  const { report, load, save, edit, editNow } = useReportDraft(centerId, reportId);
  const { enqueuePhoto } = usePhotoUploadQueue();
  const online = useNetworkStore((s) => s.status) !== "offline";
  const { data: technicians } = useCachedRefList(
    isManager ? centerId : undefined, fetchTechnicians, (id) => invalidateRefData(id, "staff"),
  );

  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [photoQueue, setPhotoQueue] = useState<{ itemId: string; file: File }[]>([]);
  const [attachError, setAttachError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const attachCount = useRef(0);
  const previewsRef = useRef(previews);
  useEffect(() => { previewsRef.current = previews; });
  useEffect(() => () => { Object.values(previewsRef.current).forEach((u) => URL.revokeObjectURL(u)); }, []);
  useEffect(() => { attachCount.current = report?.attachmentIds.length ?? 0; }, [report?.attachmentIds.length]);

  // A technician may edit only their own assigned draft; Cashier/Receptionist
  // only view. The rules enforce the same; this just keeps the screen honest.
  const mayEdit = !!report && report.status === "draft" &&
    (isManager || (role === "Technician" && report.assignedToUid === currentUser?.uid));
  const readOnly = !mayEdit;

  const setText = useCallback(
    (key: keyof InspectionReport, value: string) =>
      edit((r) => ({ ...r, [key]: value }), { [key]: value }),
    [edit],
  );

  // ── Results ────────────────────────────────────────────────────────────────
  const setResult = (r: InspectionReport, itemId: string, part: Partial<InspectionItemResult>): InspectionReport =>
    ({ ...r, results: { ...r.results, [itemId]: { ...EMPTY_RESULT, ...r.results[itemId], ...part } } });

  const onStatus = (itemId: string, status: InspectionResultStatus | null) =>
    edit((r) => setResult(r, itemId, { status }), { [resultKey(itemId, "status")]: status });

  const onRemark = (itemId: string, text: string) =>
    edit((r) => setResult(r, itemId, { remark: text }), { [resultKey(itemId, "remark")]: text });

  // ── Photos ─────────────────────────────────────────────────────────────────
  const onAddPhotos = (itemId: string, files: File[]) => {
    const ok = files.filter((f) => validatePhoto(f).ok);
    if (ok.length < files.length) setNotice("Some files weren't images and were skipped.");
    setPhotoQueue((q) => [...q, ...ok.map((file) => ({ itemId, file }))]);
  };

  async function confirmPhoto(blob: Blob) {
    const head = photoQueue[0];
    if (!head || !centerId || !reportId) return;
    const item = await storeMedia({
      centerId, reportId, blob, mimeType: "image/jpeg", kind: "photo",
      name: `photo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.jpg`,
      enqueue: enqueuePhoto,
    });
    setPreviews((p) => ({ ...p, [item.id]: URL.createObjectURL(blob) }));
    editNow(
      (r) => setResult({ ...r, media: { ...r.media, [item.id]: item } }, head.itemId,
        { photoIds: [...(r.results[head.itemId]?.photoIds ?? []), item.id] }),
      { [mediaKey(item.id)]: item, [resultKey(head.itemId, "photoIds")]: arrayUnion(item.id) },
    );
    setPhotoQueue((q) => q.slice(1));
  }

  function onRemovePhoto(itemId: string, mediaId: string) {
    editNow(
      (r) => {
        const { [mediaId]: _gone, ...media } = r.media; // eslint-disable-line @typescript-eslint/no-unused-vars
        return setResult({ ...r, media }, itemId, { photoIds: (r.results[itemId]?.photoIds ?? []).filter((id) => id !== mediaId) });
      },
      { [mediaKey(mediaId)]: deleteField(), [resultKey(itemId, "photoIds")]: arrayRemove(mediaId) },
    );
  }

  // ── Attachments ────────────────────────────────────────────────────────────
  async function onAddAttachments(files: File[]) {
    if (!centerId || !reportId) return;
    setAttachError("");
    for (const file of files) {
      const check = validateAttachment(file, attachCount.current);
      if (!check.ok) { setAttachError(check.reason); break; }
      try {
        const isPdf = file.type === "application/pdf";
        const blob = isPdf ? file : await processPhoto(file);
        const item: InspectionMediaItem = await storeMedia({
          centerId, reportId, blob, kind: "attachment", enqueue: enqueuePhoto,
          mimeType: isPdf ? "application/pdf" : "image/jpeg",
          name: isPdf ? file.name : file.name.replace(/\.\w+$/, "") + ".jpg",
        });
        attachCount.current += 1;
        if (!isPdf) setPreviews((p) => ({ ...p, [item.id]: URL.createObjectURL(blob) }));
        editNow(
          (r) => ({ ...r, media: { ...r.media, [item.id]: item }, attachmentIds: [...r.attachmentIds, item.id] }),
          { [mediaKey(item.id)]: item, attachmentIds: arrayUnion(item.id) },
        );
      } catch {
        setAttachError(`Couldn't add ${file.name}.`);
        break;
      }
    }
  }

  const onRemoveAttachment = (mediaId: string) =>
    editNow(
      (r) => {
        const { [mediaId]: _gone, ...media } = r.media; // eslint-disable-line @typescript-eslint/no-unused-vars
        return { ...r, media, attachmentIds: r.attachmentIds.filter((id) => id !== mediaId) };
      },
      { [mediaKey(mediaId)]: deleteField(), attachmentIds: arrayRemove(mediaId) },
    );

  // ── Report-only items ──────────────────────────────────────────────────────
  async function onAddReportOnlyItem(sectionId: string, text: string, saveToChecklist: boolean) {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean || !centerId) return;
    const item: InspectionReportOnlyItem = {
      id: `r_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`, sectionId, label: clean, order: Date.now(),
    };
    editNow((r) => ({ ...r, reportOnlyItems: [...r.reportOnlyItems, item] }), { reportOnlyItems: arrayUnion(item) });
    if (saveToChecklist && isManager) {
      try {
        const tpl = await fetchTemplate(centerId);
        if (!tpl) throw new Error("no template");
        // Only if the section still exists in the center's template.
        if (!tpl.sections.some((s) => s.id === sectionId)) throw new Error("section gone");
        await saveTemplateSections(centerId, addItem(tpl.sections, sectionId, clean).sections);
        setNotice("Added to your checklist for future reports.");
      } catch {
        setNotice("Added to this report, but couldn't save it to your checklist.");
      }
    }
  }

  async function onDelete() {
    if (!report || !centerId || !reportId) return;
    await deleteReportWithMedia(centerId, reportId, report.media);
    navigate("/inspection-reports", { replace: true });
  }

  const needsRepair = useMemo(
    () => (report ? Object.values(report.results).filter((r) => r.status === "needs_repair").length : 0),
    [report],
  );

  if (!centerId || load === "loading") return <LoadingBlock />;
  if (load === "missing" || load === "error" || !report) {
    return (
      <div className="min-h-screen bg-[#0B1120] text-white flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-gray-400">{load === "missing" ? "This report doesn't exist or you don't have access to it." : "Couldn't load this report."}</p>
        <Link to="/inspection-reports" className="text-sm text-[#F97316]">Back to reports</Link>
      </div>
    );
  }

  const isDiagnostic = report.type === "diagnostic";
  const checklist = report.templateSnapshot.map((section, i) => (
    <ChecklistSectionCard
      key={section.id}
      section={section}
      extraItems={report.reportOnlyItems}
      results={report.results}
      media={report.media}
      previews={previews}
      readOnly={readOnly}
      defaultOpen={i === 0}
      canSaveToChecklist={isManager}
      onStatus={onStatus}
      onRemark={onRemark}
      onAddPhotos={onAddPhotos}
      onRemovePhoto={onRemovePhoto}
      onAddReportOnlyItem={readOnly ? undefined : onAddReportOnlyItem}
    />
  ));

  const attachments = (
    <AttachmentsCard
      attachmentIds={report.attachmentIds}
      media={report.media}
      previews={previews}
      readOnly={readOnly}
      error={attachError}
      onAdd={onAddAttachments}
      onRemove={onRemoveAttachment}
    />
  );

  const notes = (
    <Card>
      <div>
        <label className={label}>Observations</label>
        <textarea className={field} rows={3} readOnly={readOnly} value={report.observations}
          onChange={(e) => setText("observations", e.target.value)} placeholder="What stood out during the inspection" />
      </div>
      <div>
        <label className={label}>Recommendations</label>
        <textarea className={field} rows={3} readOnly={readOnly} value={report.recommendations}
          onChange={(e) => setText("recommendations", e.target.value)} placeholder="What should be done, and when" />
      </div>
    </Card>
  );

  return (
    <div className="min-h-screen bg-[#0B1120] text-white pb-24">
      <div className="border-b border-white/10 bg-[#0B1120]/90 backdrop-blur sticky top-0 z-20">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-2">
          <button onClick={() => navigate("/inspection-reports")} aria-label="Back" className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate">{report.header.plateNumber}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <TypeBadge type={report.type} /> <StatusBadge status={report.status} />
              {needsRepair > 0 && <span className="text-[10px] font-semibold text-red-300">{needsRepair} need repair</span>}
            </div>
          </div>
          <span className="flex items-center gap-1 text-[11px] text-gray-500" aria-live="polite">
            {!online ? <><CloudOff className="w-3.5 h-3.5" /> Offline</>
              : save === "saving" ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving</>
              : save === "error" ? <span className="text-red-300">Not saved</span>
              : <><Cloud className="w-3.5 h-3.5" /> Saved</>}
          </span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 space-y-3">
        {!online && <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">You're offline. Changes are kept on this device and sync when you're back online.</p>}
        {report.status !== "draft" && <p className="text-xs text-gray-400 bg-white/5 border border-white/10 rounded-lg px-3 py-2">This report is finalized and can't be edited.</p>}
        {notice && <p className="text-xs text-gray-300 bg-white/5 border border-white/10 rounded-lg px-3 py-2">{notice}</p>}

        <Card>
          <div className="text-sm">
            <p className="font-semibold text-gray-100">{report.header.customerName}</p>
            <p className="text-xs text-gray-500">
              {[report.header.make, report.header.model].filter(Boolean).join(" ") || report.header.vehicleType}
              {" · "}{report.header.customerPhone}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Mileage (km)</label>
              <input className={field} inputMode="numeric" readOnly={readOnly} value={report.mileage ?? ""}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 7);
                  const km = digits === "" ? null : parseInt(digits, 10);
                  edit((r) => ({ ...r, mileage: km }), { mileage: km });
                }} placeholder="Optional" />
            </div>
            <div>
              <label className={label}>Date</label>
              <input type="date" className={field} readOnly={readOnly} value={toDateInput(report.reportDate)}
                onChange={(e) => {
                  if (!e.target.value) return;
                  const ts = Timestamp.fromDate(new Date(`${e.target.value}T12:00:00`));
                  edit((r) => ({ ...r, reportDate: ts }), { reportDate: ts });
                }} />
            </div>
          </div>
          <div>
            <label className={label}>Inspector</label>
            <input className={field} readOnly={readOnly} value={report.inspectorName} maxLength={80}
              onChange={(e) => setText("inspectorName", e.target.value)} placeholder="Inspector name" />
          </div>
          {isManager && report.status === "draft" && (
            <div>
              <label className={label}>Assigned to</label>
              <select
                className={field}
                value={report.assignedToUid ?? ""}
                onChange={(e) => {
                  const tech = technicians.find((t) => t.id === e.target.value);
                  const uid = tech?.id ?? null;
                  const name = tech ? staffDisplayName(tech) : "";
                  edit((r) => ({ ...r, assignedToUid: uid, assignedToName: name }), { assignedToUid: uid, assignedToName: name });
                }}
              >
                <option value="">Unassigned</option>
                {technicians.map((t) => <option key={t.id} value={t.id}>{staffDisplayName(t)}</option>)}
              </select>
            </div>
          )}
        </Card>

        {isDiagnostic && (
          <Card>
            <div>
              <label className={label}>Title</label>
              <input className={field} readOnly={readOnly} value={report.title} maxLength={120}
                onChange={(e) => setText("title", e.target.value)} placeholder="e.g. Engine warning light diagnosis" />
            </div>
            <div>
              <label className={label}>Findings</label>
              <textarea className={field} rows={5} readOnly={readOnly} value={report.findings}
                onChange={(e) => setText("findings", e.target.value)} placeholder="Summary of what the scan and tests showed" />
            </div>
          </Card>
        )}

        {isDiagnostic ? (<>{attachments}{checklist}{notes}</>) : (<>{checklist}{notes}{attachments}</>)}

        <Card>
          <div>
            <label className={label}>Disclaimer</label>
            <textarea className={field} rows={3} readOnly={readOnly || !isManager} value={report.disclaimer}
              onChange={(e) => setText("disclaimer", e.target.value)} />
          </div>
          <div>
            <label className={label}>Signed by</label>
            <input className={field} readOnly={readOnly} value={report.signatureName} maxLength={80}
              onChange={(e) => setText("signatureName", e.target.value)} placeholder="Name of the person signing off" />
          </div>
        </Card>

        {role === "Owner" && report.status === "draft" && (
          <div className="pt-2">
            {confirmDelete ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-400">Delete this draft and its photos?</span>
                <button onClick={onDelete} className="text-red-300 hover:text-red-200 font-semibold">Delete</button>
                <button onClick={() => setConfirmDelete(false)} className="text-gray-500 hover:text-gray-300">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-300">
                <Trash2 className="w-3.5 h-3.5" /> Delete draft
              </button>
            )}
          </div>
        )}
      </div>

      {photoQueue.length > 0 && (
        <PhotoCaptureModal
          key={photoQueue[0].file.name + photoQueue[0].file.size + photoQueue.length}
          file={photoQueue[0].file}
          remaining={photoQueue.length - 1}
          onConfirm={confirmPhoto}
          onSkip={() => setPhotoQueue((q) => q.slice(1))}
        />
      )}
    </div>
  );
}
