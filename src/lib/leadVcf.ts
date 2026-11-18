import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { deleteField, serverTimestamp } from "firebase/firestore";
import { storage } from "../config/firebase";
import { safeUpdateDoc } from "./firestoreWrite";
import { leadDoc } from "./leads";
import type { LeadVcf } from "../types/leads";

/**
 * A contact card (.vcf) the super admin attaches to a lead, so the caller it
 * is assigned to can save the number to their phone before calling.
 *
 * The file sits in Storage under `leadContacts/{leadId}/contact.vcf` (the
 * storage rules let the super admin and the lead's assigned caller read it);
 * the lead document only carries the pointer shown in the UI.
 */

export const MAX_VCF_BYTES = 2 * 1024 * 1024;

export const vcfPath = (leadId: string) => `leadContacts/${leadId}/contact.vcf`;

/** Number of contacts in vCard text — one per BEGIN:VCARD line. */
export function countVcards(text: string): number {
  return (text.match(/^BEGIN:VCARD\s*$/gim) ?? []).length;
}

/** A name safe to put in a Content-Disposition header. */
const safeName = (name: string) => name.replace(/[^\w.\- ]+/g, "_").slice(0, 80) || "contact.vcf";

export async function uploadLeadVcf(leadId: string, file: File, byName: string): Promise<LeadVcf> {
  if (!/\.vcf$/i.test(file.name)) throw new Error("Choose a .vcf contact file.");
  if (file.size === 0) throw new Error("That file is empty.");
  if (file.size > MAX_VCF_BYTES) throw new Error("That file is over 2 MB.");
  const contacts = countVcards(await file.text());
  if (contacts === 0) throw new Error("That doesn't look like a contact file (no vCard found).");

  const name = safeName(file.name);
  // `text/vcard` + an attachment disposition makes a phone offer "Add to
  // contacts" / save the file, instead of rendering the text in the browser.
  await uploadBytes(storageRef(storage, vcfPath(leadId)), file, {
    contentType: "text/vcard",
    contentDisposition: `attachment; filename="${name}"`,
  });
  const vcf: LeadVcf = { name, size: file.size, contacts, uploadedByName: byName };
  await safeUpdateDoc(leadDoc(leadId), {
    vcfFile: vcf,
    vcfUploadedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return vcf;
}

export async function removeLeadVcf(leadId: string): Promise<void> {
  await safeUpdateDoc(leadDoc(leadId), {
    vcfFile: deleteField(), vcfUploadedAt: deleteField(), updatedAt: serverTimestamp(),
  });
  await deleteObject(storageRef(storage, vcfPath(leadId))).catch(() => undefined);
}

/** Best-effort cleanup used when a lead is deleted for good. */
export async function deleteLeadVcfFile(leadId: string): Promise<void> {
  await deleteObject(storageRef(storage, vcfPath(leadId))).catch(() => undefined);
}

/** A tokened URL that downloads the file (the object carries an attachment disposition). */
export const leadVcfUrl = (leadId: string) => getDownloadURL(storageRef(storage, vcfPath(leadId)));
