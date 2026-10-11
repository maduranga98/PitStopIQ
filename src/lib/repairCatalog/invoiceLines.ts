// Invoice lines for the repairs recorded on a job. Pure.
//
// Called from the two places that build a job's bill (createServiceJob's first
// draft and ServiceDetailPage.createDraftInvoice's rebuild on Mark Done). A job
// with no `repairsPerformed` yields [], so those bills are exactly what they
// were before the Repair Catalog existed.
//
// These lines are never commissionable: they carry no technicianId and
// type "repair", and the commission function only pays type "service".
import type { InvoiceLineItem, ServiceJob } from "../../types/auth";

export function repairLineItems(job: Pick<ServiceJob, "repairsPerformed">): InvoiceLineItem[] {
  return (job.repairsPerformed ?? []).map((r) => {
    // The frozen price. Never re-resolved; a bad value bills as 0 rather than NaN.
    const price = Number.isFinite(r.price) && r.price > 0 ? r.price : 0;
    return {
      description: r.name,
      qty: 1,
      unitPrice: price,
      lineTotal: price,
      type: "repair" as const,
      ...(!r.custom && r.repairItemId ? { repairItemId: r.repairItemId } : {}),
    };
  });
}
