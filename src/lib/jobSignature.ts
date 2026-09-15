// The customer's valuables waiver for a job: read and written as its own
// document under the job, never as a field on it.
//
// The signature is a PNG data URL — a few kilobytes, but a few kilobytes on
// every job the workshop has ever done. Job lists and boards read whole job
// documents, so keeping the image out of them (behind the job's
// `signatureCaptured` flag) is what stops one waiver per job turning into a
// slower services list for everyone.
import { doc, serverTimestamp, Timestamp } from "firebase/firestore";
import { db } from "../config/firebase";
import { safeSetDoc, safeUpdateDoc } from "./firestoreWrite";
import type { CapturedSignature } from "../components/services/CustomerSignatureModal";

function signatureRef(centerId: string, jobId: string) {
  return doc(db, "servicecenters", centerId, "jobs", jobId, "signature", "main");
}

/**
 * The waiver document's fields, without saying where they go.
 *
 * Split out of saveJobSignature so job creation can put the SAME fields into
 * the batch that writes the job itself (see lib/jobCreation.ts): the waiver's
 * create rule is the job's create rule exactly, so the two can share a batch
 * without narrowing who may create a job. Everything after creation — the job
 * card re-capturing a signature — still goes through saveJobSignature below.
 */
export function signatureFields(
  signature: CapturedSignature,
  witness?: { id?: string; name?: string },
) {
  return {
    dataUrl: signature.dataUrl,
    signedByName: signature.signedByName,
    valuables: signature.valuables,
    hasValuables: signature.hasValuables,
    // Client-stamped so it reads back immediately (and while offline); the
    // browser's clock is also the one the customer actually signed at.
    signedAt: Timestamp.fromDate(new Date(signature.signedAt)),
    ...(witness?.id ? { witnessedById: witness.id } : {}),
    ...(witness?.name ? { witnessedByName: witness.name } : {}),
  };
}

/**
 * Store a captured waiver against a job and flag the job as signed. The flag
 * and the document are written separately: the job may be seconds old and
 * the flag is what every list reads, so a failed image write must not leave
 * a job claiming a signature it hasn't got — hence the flag goes second.
 */
export async function saveJobSignature(
  centerId: string,
  jobId: string,
  signature: CapturedSignature,
  witness?: { id?: string; name?: string },
): Promise<void> {
  await safeSetDoc(signatureRef(centerId, jobId), signatureFields(signature, witness));
  await safeUpdateDoc(doc(db, "servicecenters", centerId, "jobs", jobId), {
    signatureCaptured: true,
    updatedAt: serverTimestamp(),
  });
}
