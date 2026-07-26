import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  doc, onSnapshot, collection, query, where,
  getDocs, getDoc, Timestamp,
} from "firebase/firestore";
import { safeUpdateDoc, safeAddDoc } from "../../lib/firestoreWrite";
import {
  ref as storageRef, uploadBytes, uploadString, getDownloadURL, deleteObject,
} from "firebase/storage";
import QRCode from "qrcode";
import {
  ArrowLeft, Edit2, Car, Clock, QrCode, Download, Printer,
  AlertTriangle, CheckCircle, AlertCircle, Bell, Image, Trash2, Upload,
  Gauge,
} from "lucide-react";
import { db, storage } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import type { Vehicle, ServiceJob, Customer, ServiceCenter } from "../../types/auth";
import {
  getReminderTemplate, resolveReminderTemplate, smsQuotaLimit, buildViewLink,
  type SmsLang,
} from "../../lib/smsTemplates";
import { getOrCreateShortLink, smsShortLink, fullShortLink } from "../../lib/shortLinks";
import { useTranslation } from "react-i18next";
import { LoadingBlock, LoadingScreen } from "../../components/LoadingProgress";

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
  const navigate = useNavigate();
  const { t } = useTranslation();

  const canSendSms = usePermission("sms.sendManual");
  const canEditVehicle = usePermission("vehicles.edit");
  const canViewQr = usePermission("vehicles.viewQr");
  const canUploadPhotos = usePermission("vehicles.uploadPhotos");
  const canViewHistory = usePermission("vehicles.viewHistory");

  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<ServiceJob[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);

  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [deletingPhoto, setDeletingPhoto] = useState<string | null>(null);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [reminderMsg, setReminderMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [center, setCenter] = useState<ServiceCenter | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const qrBackfillRef = useRef(false);
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
    // No orderBy here: combining an equality filter with orderBy on a different
    // field needs a composite index. A vehicle has only a handful of jobs, so we
    // fetch by vehicleId and sort newest-first on the client instead.
    getDocs(
      query(
        collection(db, "servicecenters", currentUser.centerId, "jobs"),
        where("vehicleId", "==", vehicleId),
      )
    ).then((snap) => {
      const jobs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ServiceJob));
      jobs.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      setServices(jobs);
      setLoadingServices(false);
    }).catch(() => setLoadingServices(false));
  }, [vehicleId, currentUser?.centerId]);

  // Load the center (name/phone/templates/quota) and the vehicle's customer
  // (phone + preferred language) so the "Send Reminder" button can compose and
  // dispatch an SMS.
  useEffect(() => {
    if (!currentUser?.centerId) return;
    getDoc(doc(db, "servicecenters", currentUser.centerId)).then((snap) => {
      if (snap.exists()) setCenter({ id: snap.id, ...snap.data() } as ServiceCenter);
    });
  }, [currentUser?.centerId]);

  useEffect(() => {
    if (!vehicle?.customerId || !currentUser?.centerId) return;
    getDoc(doc(db, "servicecenters", currentUser.centerId, "customers", vehicle.customerId)).then((snap) => {
      if (snap.exists()) setCustomer({ id: snap.id, ...snap.data() } as Customer);
    });
  }, [vehicle?.customerId, currentUser?.centerId]);

  // (Re)generate the QR code so it always encodes a resolvable short link.
  // Runs when a vehicle has no stored QR (older records, or any created while
  // the storage rule was missing) OR when its stored QR still encodes the old
  // /v/{vehicleId} URL that the resolver can't map to a customer view. Only
  // staff who can edit vehicles do this, since it writes to the vehicle doc.
  useEffect(() => {
    if (!vehicle || !currentUser?.centerId || !canEditVehicle) return;
    if (vehicle.qrCodeUrl && vehicle.qrEncodesShortLink) return;
    if (qrBackfillRef.current) return;
    qrBackfillRef.current = true;
    const centerId = currentUser.centerId;
    const vId = vehicle.id;
    const customerId = vehicle.customerId;
    (async () => {
      try {
        // The QR must point at a link the public /v/ resolver understands: a
        // short-link code that maps to the customer's self-service view. Fall
        // back to the full /c/ link if a code can't be minted.
        const code = await getOrCreateShortLink(centerId, customerId).catch(() => null);
        const target = code ? fullShortLink(code) : buildViewLink(centerId, customerId);
        const dataUrl = await QRCode.toDataURL(target, { width: 300, margin: 2 });
        const sRef = storageRef(storage, `servicecenters/${centerId}/vehicles/${vId}/qr.png`);
        await uploadString(sRef, dataUrl, "data_url");
        const downloadURL = await getDownloadURL(sRef);
        await safeUpdateDoc(doc(db, "servicecenters", centerId, "vehicles", vId), {
          qrCodeUrl: downloadURL,
          qrEncodesShortLink: true,
        });
      } catch {
        qrBackfillRef.current = false; // allow a retry on the next load
      }
    })();
  }, [vehicle, currentUser?.centerId, canEditVehicle]);

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
      await safeUpdateDoc(
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
      await safeUpdateDoc(
        doc(db, "servicecenters", currentUser.centerId, "vehicles", vehicle.id),
        { photoUrls: newUrls },
      );
    } finally {
      setDeletingPhoto(null);
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
        <p style="margin-top:16px;font-size:12px;color:#888">Scan to view service history</p>
      </body></html>
    `);
    win.document.close();
    win.print();
  }

  async function handleSendReminder() {
    if (!vehicle || !currentUser?.centerId || !center) return;
    setReminderMsg(null);

    const phone = customer?.phone;
    if (!phone) {
      setReminderMsg({ type: "error", text: "No phone number on file for this customer." });
      return;
    }
    const quotaUsed = center.smsQuotaUsed ?? 0;
    const quotaMax = center.smsQuotaLimit ?? smsQuotaLimit(center.plan ?? "basic");
    if (quotaUsed >= quotaMax) {
      setReminderMsg({ type: "error", text: "Monthly SMS quota reached." });
      return;
    }

    setSendingReminder(true);
    try {
      const lang: SmsLang = customer?.smsLanguage ?? "english";
      const template = getReminderTemplate(center as unknown as Record<string, unknown>, lang);
      const code = await getOrCreateShortLink(currentUser.centerId, vehicle.customerId).catch(() => null);
      const viewLink = code
        ? smsShortLink(code)
        : buildViewLink(currentUser.centerId, vehicle.customerId);
      const message = resolveReminderTemplate(template, {
        customerName: vehicle.customerName,
        plate: vehicle.plateNumber,
        centerName: center.name ?? "",
        centerPhone: center.phone ?? "",
        currentKm: String(vehicle.currentMileageKm),
        nextServiceMileage: String(vehicle.nextServiceMileageKm),
        viewLink,
      });

      // Writing the smsLogs doc with status "sent" hands off to the Cloud
      // Function that actually dispatches the SMS and increments the quota.
      await safeAddDoc(collection(db, "servicecenters", currentUser.centerId, "smsLogs"), {
        customerId: vehicle.customerId,
        customerName: vehicle.customerName,
        phone,
        vehicleId: vehicle.id,
        plateNumber: vehicle.plateNumber,
        messageType: "Reminder",
        status: "sent",
        message,
        sentAt: Timestamp.now(),
      });
      // Mark the reminder as sent so scheduled backend reminders don't re-fire.
      await safeUpdateDoc(
        doc(db, "servicecenters", currentUser.centerId, "vehicles", vehicle.id),
        { reminderSent: true },
      ).catch(() => {});
      setReminderMsg({ type: "success", text: "Reminder SMS sent." });
    } catch {
      setReminderMsg({ type: "error", text: "Failed to send reminder. Please try again." });
    } finally {
      setSendingReminder(false);
    }
  }

  if (loading) {
    return (
      <LoadingScreen />
    );
  }

  if (!vehicle) return null;

  const status = getStatus(vehicle, threshold);
  const remaining = vehicle.nextServiceMileageKm - vehicle.currentMileageKm;

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
            {canEditVehicle && (
              <button
                onClick={() => navigate(`/vehicles/${vehicleId}/edit`)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-300 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors"
              >
                <Edit2 className="w-4 h-4" />
                Edit
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Mileage Banner */}
        <MileageBanner status={status} remaining={remaining} vehicle={vehicle} />

        {/* Send Reminder */}
        {canSendSms && (status === "due_soon" || status === "overdue") && (
          <div className="flex flex-col items-end gap-2">
            <button
              disabled={sendingReminder || !center || !customer}
              onClick={handleSendReminder}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-lg transition-colors disabled:opacity-50"
            >
              <Bell className="w-4 h-4" />
              {sendingReminder ? "Sending…" : "Send Reminder Now"}
            </button>
            {reminderMsg && (
              <p
                className={`flex items-center gap-1 text-xs ${
                  reminderMsg.type === "success" ? "text-green-400" : "text-red-400"
                }`}
              >
                {reminderMsg.type === "success" ? (
                  <CheckCircle className="w-3.5 h-3.5" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5" />
                )}
                {reminderMsg.text}
              </p>
            )}
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
          </div>

          {/* QR Code */}
          {canViewQr && (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 flex flex-col items-center gap-4">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider self-start">QR Code</h2>
            {vehicle.qrCodeUrl ? (
              <>
                <img
                  src={vehicle.qrCodeUrl}
                  alt="Vehicle QR Code"
                  className="w-40 h-40 rounded-lg bg-white p-2"
                />
                <p className="text-xs text-gray-500 text-center">
                  Scan to view service history
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
          )}
        </div>

        {/* Service History */}
        {canViewHistory && (
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Service History
          </h2>
          {loadingServices ? (
            <LoadingBlock className="py-8" />
          ) : services.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No service records yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {services.map((s) => {
                const cfg = SERVICE_STATUS_CONFIG[s.status] ?? SERVICE_STATUS_CONFIG.pending;
                const title =
                  [...(s.services ?? []), ...(s.customServices ?? [])].join(", ") || "Service";
                return (
                  <div
                    key={s.id}
                    className="flex items-start gap-4 p-4 bg-[#0B1120]/50 border border-white/5 rounded-xl hover:border-white/10 transition-colors cursor-pointer"
                    onClick={() => navigate(`/services/${s.id}`)}
                  >
                    <div className="w-2 h-2 mt-2 rounded-full bg-[#F97316] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-white truncate">{title}</p>
                        <span className={`px-2 py-0.5 text-xs rounded-full ${cfg.bg} ${cfg.text}`}>
                          {cfg.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                        <span>{formatDate(s.createdAt)}</span>
                        {s.jobNumber && <span>· {s.jobNumber}</span>}
                        {s.technicianName && <span>· {s.technicianName}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {/* Photo Gallery */}
        {canUploadPhotos && (
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
                    title="Remove photo"
                    className="absolute top-1.5 right-1.5 p-1.5 bg-red-500/90 hover:bg-red-500 rounded-md transition-all disabled:opacity-50 shadow-lg"
                  >
                    {deletingPhoto === url ? (
                      <div className="w-3.5 h-3.5 border border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5 text-white" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        )}
      </div>

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
