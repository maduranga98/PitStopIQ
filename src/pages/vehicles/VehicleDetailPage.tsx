import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  doc, onSnapshot, collection, query, where, orderBy,
  getDocs, updateDoc, Timestamp, arrayUnion,
} from "firebase/firestore";
import {
  ref as storageRef, uploadBytes, getDownloadURL, deleteObject,
} from "firebase/storage";
import {
  ArrowLeft, Edit2, Car, Clock, QrCode, Download, Printer,
  AlertTriangle, CheckCircle, AlertCircle, Bell, Image, Trash2, Upload,
  Gauge, ArrowLeftRight, X, Check,
} from "lucide-react";
import { db, storage } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { useBranch } from "../../contexts/BranchContext";
import type { Vehicle, ServiceRecord, VehicleTransferLog } from "../../types/auth";
import { useTranslation } from "react-i18next";

function getStatus(v: Vehicle, threshold: number): "ok" | "due_soon" | "overdue" {
  const remaining = v.nextServiceMileageKm - v.currentMileageKm;
  if (remaining < 0) return "overdue";
  if (remaining <= threshold) return "due_soon";
  return "ok";
}

function formatDate(ts: Timestamp): string {
  return ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const SERVICE_STATUS_CONFIG = {
  pending:     { label: "Pending",     bg: "bg-gray-500/20",  text: "text-gray-300" },
  in_progress: { label: "In Progress", bg: "bg-amber-500/20", text: "text-amber-300" },
  done:        { label: "Done",        bg: "bg-green-500/20", text: "text-green-300" },
  delivered:   { label: "Delivered",   bg: "bg-blue-500/20",  text: "text-blue-300" },
};

const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export default function VehicleDetailPage() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const { currentUser } = useAuth();
  const { branches, hasBranches, activeBranchId } = useBranch();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);

  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [deletingPhoto, setDeletingPhoto] = useState<string | null>(null);
  const [sendingReminder, setSendingReminder] = useState(false);

  // Transfer state
  const [transferOpen, setTransferOpen] = useState(false);
  const [targetBranchId, setTargetBranchId] = useState("");
  const [transferring, setTransferring] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const threshold = 1000;

  useEffect(() => {
    if (!vehicleId || !currentUser?.centerId) return;
    return onSnapshot(
      doc(db, "servicecenters", currentUser.centerId, "vehicles", vehicleId),
      (snap) => {
        if (snap.exists()) {
          setVehicle({ id: snap.id, ...snap.data() } as Vehicle);
        } else {
          navigate("/vehicles");
        }
        setLoading(false);
      },
    );
  }, [vehicleId, currentUser?.centerId, navigate]);

  useEffect(() => {
    if (!vehicleId || !currentUser?.centerId) return;
    setLoadingServices(true);
    getDocs(
      query(
        collection(db, "servicecenters", currentUser.centerId, "services"),
        where("vehicleId", "==", vehicleId),
        orderBy("createdAt", "desc"),
      )
    ).then((snap) => {
      setServices(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ServiceRecord)));
      setLoadingServices(false);
    });
  }, [vehicleId, currentUser?.centerId]);

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !vehicle || !currentUser?.centerId) return;
    e.target.value = "";

    if (file.size > MAX_PHOTO_BYTES) { setPhotoError("Photo must be under 5 MB"); return; }
    if (!["image/jpeg", "image/png"].includes(file.type)) { setPhotoError("Only JPG and PNG photos are supported"); return; }
    if ((vehicle.photoUrls?.length ?? 0) >= MAX_PHOTOS) { setPhotoError(`Maximum ${MAX_PHOTOS} photos allowed`); return; }

    setPhotoError("");
    setUploadingPhoto(true);
    try {
      const filename = `${Date.now()}_${file.name}`;
      const sRef = storageRef(
        storage,
        `servicecenters/${currentUser.centerId}/vehicles/${vehicle.id}/photos/${filename}`,
      );
      await uploadBytes(sRef, file);
      const url = await getDownloadURL(sRef);
      const newUrls = [...(vehicle.photoUrls ?? []), url];
      await updateDoc(
        doc(db, "servicecenters", currentUser.centerId, "vehicles", vehicle.id),
        { photoUrls: newUrls },
      );
    } catch {
      setPhotoError("Upload failed. Please try again.");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleDeletePhoto(url: string) {
    if (!vehicle || !currentUser?.centerId) return;
    setDeletingPhoto(url);
    try {
      const sRef = storageRef(storage, url);
      await deleteObject(sRef).catch(() => {});
      const newUrls = (vehicle.photoUrls ?? []).filter((u) => u !== url);
      await updateDoc(
        doc(db, "servicecenters", currentUser.centerId, "vehicles", vehicle.id),
        { photoUrls: newUrls },
      );
    } finally {
      setDeletingPhoto(null);
    }
  }

  async function handleTransfer() {
    if (!targetBranchId || !vehicle || !currentUser?.centerId) return;
    const targetBranch = branches.find(b => b.id === targetBranchId);
    if (!targetBranch) return;

    setTransferring(true);
    try {
      const fromBranch = branches.find(b => b.id === vehicle.branchId);
      const logEntry: Omit<VehicleTransferLog, "transferredAt"> & { transferredAt: Timestamp } = {
        fromBranchId: vehicle.branchId ?? "",
        fromBranchName: fromBranch?.name ?? (activeBranchId ? "Previous branch" : "Original"),
        toBranchId: targetBranchId,
        toBranchName: targetBranch.name,
        transferredBy: currentUser.uid,
        transferredAt: Timestamp.now(),
      };
      await updateDoc(doc(db, "servicecenters", currentUser.centerId, "vehicles", vehicle.id), {
        branchId: targetBranchId,
        transferLog: arrayUnion(logEntry),
        updatedAt: Timestamp.now(),
      });
      setTransferOpen(false);
      setTargetBranchId("");
    } finally {
      setTransferring(false);
    }
  }

  function handleDownloadQR() {
    if (!vehicle?.qrCodeUrl) return;
    const a = document.createElement("a");
    a.href = vehicle.qrCodeUrl;
    a.download = `${vehicle.plateNumber}-qr.png`;
    a.target = "_blank";
    a.click();
  }

  function handlePrintQR() {
    if (!vehicle?.qrCodeUrl) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html><head><title>QR Code - ${vehicle.plateNumber}</title></head>
      <body style="display:flex;flex-direction:column;align-items:center;padding:40px;font-family:sans-serif">
        <h2 style="margin-bottom:8px">${vehicle.plateNumber}</h2>
        <p style="color:#555;margin-bottom:20px">${vehicle.make} ${vehicle.model} ${vehicle.year}</p>
        <img src="${vehicle.qrCodeUrl}" width="250" height="250" />
        <p style="margin-top:16px;font-size:12px;color:#888">pitstopiq.com/v/${vehicle.id}</p>
      </body></html>
    `);
    win.document.close();
    win.print();
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#F97316] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!vehicle) return null;

  const status = getStatus(vehicle, threshold);
  const remaining = vehicle.nextServiceMileageKm - vehicle.currentMileageKm;
  const transferableBranches = branches.filter(b => b.id !== vehicle.branchId && b.active);
  const showTransferBtn = hasBranches && transferableBranches.length > 0;

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-[#0B1120]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/vehicles")}
              className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <Car className="w-5 h-5 text-[#F97316]" />
            <h1 className="text-xl font-bold font-mono">{vehicle.plateNumber}</h1>
            <StatusChip status={status} />
          </div>
          <div className="flex items-center gap-2">
            {showTransferBtn && (
              <button
                onClick={() => { setTargetBranchId(""); setTransferOpen(true); }}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-300 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors"
              >
                <ArrowLeftRight className="w-4 h-4" />
                <span className="hidden sm:inline">Transfer</span>
              </button>
            )}
            <button
              onClick={() => navigate(`/vehicles/${vehicleId}/edit`)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-300 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors"
            >
              <Edit2 className="w-4 h-4" />
              Edit
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Mileage Banner */}
        <MileageBanner status={status} remaining={remaining} vehicle={vehicle} />

        {/* Send Reminder */}
        {(status === "due_soon" || status === "overdue") && (
          <div className="flex justify-end">
            <button
              disabled={sendingReminder}
              onClick={() => setSendingReminder(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-lg transition-colors disabled:opacity-50"
            >
              <Bell className="w-4 h-4" />
              {sendingReminder ? "Sending…" : "Send Reminder Now"}
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Spec Card */}
          <div className="lg:col-span-2 bg-[#162032] border border-white/10 rounded-2xl p-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">{t("vehicles.specifications")}</h2>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <SpecRow label="Make" value={vehicle.make} />
              <SpecRow label="Model" value={vehicle.model} />
              <SpecRow label="Year" value={String(vehicle.year)} />
              <SpecRow label="Colour" value={vehicle.colour} />
              <SpecRow label="Customer" value={vehicle.customerName} />
            </div>
            <div className="border-t border-white/10 pt-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Mileage</h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <SpecRow label="Current" value={`${vehicle.currentMileageKm.toLocaleString()} km`} />
                <SpecRow label="Next Service" value={`${vehicle.nextServiceMileageKm.toLocaleString()} km`} />
              </div>
            </div>
            {(vehicle.oilBrand || vehicle.oilGrade || vehicle.oilViscosityNotes) && (
              <div className="border-t border-white/10 pt-4">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Oil Data</h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  {vehicle.oilBrand && <SpecRow label="Brand" value={vehicle.oilBrand} />}
                  {vehicle.oilGrade && <SpecRow label="Grade" value={vehicle.oilGrade} />}
                  {vehicle.oilViscosityNotes && (
                    <div className="col-span-2">
                      <SpecRow label="Notes" value={vehicle.oilViscosityNotes} />
                    </div>
                  )}
                </div>
              </div>
            )}
            {hasBranches && vehicle.branchId && (
              <div className="border-t border-white/10 pt-4">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Branch</h3>
                <SpecRow
                  label="Current Branch"
                  value={branches.find(b => b.id === vehicle.branchId)?.name ?? vehicle.branchId}
                />
              </div>
            )}
          </div>

          {/* QR Code */}
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 flex flex-col items-center gap-4">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider self-start">QR Code</h2>
            {vehicle.qrCodeUrl ? (
              <>
                <img
                  src={vehicle.qrCodeUrl}
                  alt="Vehicle QR Code"
                  className="w-40 h-40 rounded-lg bg-white p-2"
                />
                <p className="text-xs text-gray-500 text-center break-all">
                  pitstopiq.com/v/{vehicle.id}
                </p>
                <div className="flex gap-2 w-full">
                  <button
                    onClick={handleDownloadQR}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-gray-300 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download
                  </button>
                  <button
                    onClick={handlePrintQR}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-gray-300 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Print
                  </button>
                </div>
              </>
            ) : (
              <div className="w-40 h-40 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">
                <QrCode className="w-12 h-12 text-gray-600" />
              </div>
            )}
          </div>
        </div>

        {/* Service History */}
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Service History
          </h2>
          {loadingServices ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-2 border-[#F97316] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : services.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No service records yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {services.map((s) => {
                const cfg = SERVICE_STATUS_CONFIG[s.status] ?? SERVICE_STATUS_CONFIG.pending;
                return (
                  <div
                    key={s.id}
                    className="flex items-start gap-4 p-4 bg-[#0B1120]/50 border border-white/5 rounded-xl hover:border-white/10 transition-colors cursor-pointer"
                    onClick={() => navigate(`/services/${s.id}`)}
                  >
                    <div className="w-2 h-2 mt-2 rounded-full bg-[#F97316] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-white">{s.serviceType}</p>
                        <span className={`px-2 py-0.5 text-xs rounded-full ${cfg.bg} ${cfg.text}`}>
                          {cfg.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                        <span>{formatDate(s.createdAt)}</span>
                        {s.technicianName && <span>· {s.technicianName}</span>}
                        {s.totalAmount !== undefined && (
                          <span>· LKR {s.totalAmount.toLocaleString()}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Transfer History */}
        {vehicle.transferLog && vehicle.transferLog.length > 0 && (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-6">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <ArrowLeftRight className="w-4 h-4" />
              Transfer History
            </h2>
            <div className="space-y-3">
              {[...vehicle.transferLog].reverse().map((log, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-[#0B1120]/50 border border-white/5 rounded-xl">
                  <ArrowLeftRight className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-white">
                      <span className="text-gray-400">{log.fromBranchName || "—"}</span>
                      {" → "}
                      <span className="font-medium">{log.toBranchName}</span>
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {formatDate(log.transferredAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Photo Gallery */}
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <Image className="w-4 h-4" />
              Photos
              <span className="text-gray-600 font-normal normal-case">
                ({vehicle.photoUrls?.length ?? 0}/{MAX_PHOTOS})
              </span>
            </h2>
            {(vehicle.photoUrls?.length ?? 0) < MAX_PHOTOS && (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingPhoto}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-300 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors disabled:opacity-50"
              >
                {uploadingPhoto ? (
                  <div className="w-3.5 h-3.5 border border-gray-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                Upload Photo
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={handlePhotoUpload}
          />
          {photoError && (
            <p className="flex items-center gap-1 text-xs text-red-400 mb-3">
              <AlertCircle className="w-3.5 h-3.5" /> {photoError}
            </p>
          )}
          {(vehicle.photoUrls?.length ?? 0) === 0 ? (
            <div className="text-center py-8 border border-dashed border-white/10 rounded-xl">
              <Image className="w-8 h-8 mx-auto mb-2 text-gray-600" />
              <p className="text-sm text-gray-500">No photos yet</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 text-xs text-[#F97316] hover:text-orange-400 transition-colors"
              >
                Upload first photo
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {vehicle.photoUrls!.map((url) => (
                <div key={url} className="relative group aspect-square">
                  <img
                    src={url}
                    alt="Vehicle photo"
                    className="w-full h-full object-cover rounded-lg border border-white/10"
                  />
                  <button
                    onClick={() => handleDeletePhoto(url)}
                    disabled={deletingPhoto === url}
                    className="absolute top-1.5 right-1.5 p-1 bg-red-500/80 hover:bg-red-500 rounded-md opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                  >
                    {deletingPhoto === url ? (
                      <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Trash2 className="w-3 h-3 text-white" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Transfer Modal ── */}
      {transferOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setTransferOpen(false)} />
          <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Transfer to Branch</h3>
              <button onClick={() => setTransferOpen(false)} className="text-gray-500 hover:text-gray-300 transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-sm text-gray-400">
              Moving <span className="font-semibold text-white font-mono">{vehicle.plateNumber}</span> to another branch.
              Service history is retained.
            </div>

            <div>
              <label className="text-xs text-gray-400 block mb-1.5">Select Target Branch</label>
              <select
                value={targetBranchId}
                onChange={e => setTargetBranchId(e.target.value)}
                className="w-full bg-[#0B1120] border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
              >
                <option value="">— Choose branch —</option>
                {transferableBranches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setTransferOpen(false)}
                className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 rounded-lg transition text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleTransfer}
                disabled={!targetBranchId || transferring}
                className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2"
              >
                {transferring ? (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <Check className="w-4 h-4" />
                )}
                {transferring ? "Transferring…" : "Confirm Transfer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm text-white mt-0.5">{value}</p>
    </div>
  );
}

function StatusChip({ status }: { status: "ok" | "due_soon" | "overdue" }) {
  const cfg = {
    ok:       { label: "OK",       bg: "bg-green-500/20", text: "text-green-300" },
    due_soon: { label: "Due Soon", bg: "bg-amber-500/20", text: "text-amber-300" },
    overdue:  { label: "Overdue",  bg: "bg-red-500/20",   text: "text-red-400" },
  }[status];
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  );
}

function MileageBanner({
  status, remaining, vehicle,
}: {
  status: "ok" | "due_soon" | "overdue";
  remaining: number;
  vehicle: Vehicle;
}) {
  const config = {
    ok: {
      bg: "bg-green-500/10 border-green-500/20",
      icon: <CheckCircle className="w-5 h-5 text-green-400" />,
      title: "Service Not Due",
      desc: `${remaining.toLocaleString()} km remaining until next service at ${vehicle.nextServiceMileageKm.toLocaleString()} km`,
    },
    due_soon: {
      bg: "bg-amber-500/10 border-amber-500/20",
      icon: <AlertTriangle className="w-5 h-5 text-amber-400" />,
      title: "Service Due Soon",
      desc: `Only ${remaining.toLocaleString()} km remaining — next service at ${vehicle.nextServiceMileageKm.toLocaleString()} km`,
    },
    overdue: {
      bg: "bg-red-500/10 border-red-500/20",
      icon: <AlertCircle className="w-5 h-5 text-red-400" />,
      title: "Service Overdue",
      desc: `${Math.abs(remaining).toLocaleString()} km past due — next service was at ${vehicle.nextServiceMileageKm.toLocaleString()} km`,
    },
  }[status];

  return (
    <div className={`flex items-start gap-3 p-4 border rounded-xl ${config.bg}`}>
      <div className="shrink-0 mt-0.5">{config.icon}</div>
      <div>
        <p className="text-sm font-semibold text-white">{config.title}</p>
        <p className="text-sm text-gray-400 mt-0.5 flex items-center gap-1.5">
          <Gauge className="w-3.5 h-3.5 shrink-0" />
          {config.desc}
        </p>
      </div>
    </div>
  );
}
