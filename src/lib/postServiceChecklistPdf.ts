// Client side of the post-service checklist report PDF. The PDF itself is made
// by the generatePostServiceChecklistPdf Cloud Function (functions/
// postServiceChecklists.js) and needs a connection — everything else about a
// checklist works offline.
import { httpsCallable } from "firebase/functions";
import { functions } from "../config/firebase";

/** A job's checklist is addressed by the job id, a standalone record by its own id. */
export type ChecklistPdfKind = "standalone" | "job";

/** The PDF's URL, generating it first when it doesn't exist yet. */
export async function fetchChecklistPdfUrl(
  centerId: string, kind: ChecklistPdfKind, id: string, regenerate = false,
): Promise<string> {
  const res = await httpsCallable<
    { centerId: string; kind: ChecklistPdfKind; id: string; regenerate?: boolean },
    { pdfUrl: string; cached: boolean }
  >(functions, "generatePostServiceChecklistPdf")({ centerId, kind, id, ...(regenerate ? { regenerate } : {}) });
  return res.data.pdfUrl;
}

/**
 * Opens the PDF in a new tab. The tab is opened straight away, inside the
 * click, and pointed at the file once it exists: a window opened after an
 * await is treated as a pop-up and blocked by Safari and most phones.
 */
export async function openChecklistPdf(centerId: string, kind: ChecklistPdfKind, id: string): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const url = await fetchChecklistPdfUrl(centerId, kind, id);
    if (tab) tab.location.href = url;
    else window.location.assign(url);
  } catch (err) {
    tab?.close();
    throw err;
  }
}
