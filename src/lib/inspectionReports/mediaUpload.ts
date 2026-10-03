// ── Media upload (online direct, offline via the existing queue) ─────────────
//
// Online: upload straight to Storage and hand back an item with its URL.
// Offline (or the upload fails): park the bytes in the IndexedDB queue
// (lib/photoUploadQueue.ts, unchanged behaviour for every other caller) and
// hand back a `pending` item with url null. When the queue later lands the
// file it writes `media.<id>.url` and clears `media.<id>.pending` on the
// report document, so nothing here needs to be running at that point.
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../../config/firebase";
import type { QueuedUpload } from "../photoUploadQueue";
import type { InspectionMediaItem, InspectionMediaKind } from "../../types/inspectionReports";
import { inspectionMediaStoragePath, inspectionReportDoc } from "./paths";
import { blobToDataUrl } from "./media";
import { newMediaId } from "./mediaRules";

type Enqueue = (item: Omit<QueuedUpload, "id" | "attempts" | "status">) => Promise<string>;

export interface StoreMediaInput {
  centerId: string;
  reportId: string;
  blob: Blob;
  mimeType: InspectionMediaItem["mimeType"];
  name: string;
  kind: InspectionMediaKind;
  enqueue: Enqueue;
}

export async function storeMedia(input: StoreMediaInput): Promise<InspectionMediaItem> {
  const { centerId, reportId, blob, mimeType, name, kind, enqueue } = input;
  const id = newMediaId();
  const path = inspectionMediaStoragePath(centerId, reportId, id);
  const base: InspectionMediaItem = {
    id, kind, name, mimeType, sizeBytes: blob.size,
    url: null, pending: true, mediaDeleteAt: null, mediaDeleted: false,
  };

  if (navigator.onLine) {
    try {
      const ref = storageRef(storage, path);
      await uploadBytes(ref, blob, { contentType: mimeType });
      return { ...base, url: await getDownloadURL(ref), pending: false };
    } catch {
      // Fall through to the queue: nothing reached Storage, so retrying later is safe.
    }
  }

  await enqueue({
    storagePath: path,
    base64Data: await blobToDataUrl(blob),
    mimeType,
    fileType: mimeType === "application/pdf" ? "pdf" : "image",
    metadata: {
      centerId,
      serviceId: reportId,
      type: "inspectionReport",
      fieldPath: inspectionReportDoc(centerId, reportId).path,
      fieldKey: `media.${id}.url`,
    },
    createdAt: Date.now(),
  });
  return base;
}
