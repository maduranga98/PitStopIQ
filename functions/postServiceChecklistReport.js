/**
 * The plain report a post-service checklist PDF is rendered from — pure, no
 * PDFKit and no Firebase, so it is unit-tested without either installed.
 * See postServiceChecklistPdf.js for the renderer.
 */
const toDate = (v) => (v && typeof v.toDate === "function" ? v.toDate() : v instanceof Date ? v : null);

/** Sections as stored, or the flat ticks of a checklist filled in before sections existed. */
function sectionsOf(record) {
  if (Array.isArray(record.sections) && record.sections.length > 0) return record.sections;
  const flat = Array.isArray(record.items) ? record.items : [];
  if (flat.length === 0) return [];
  return [{
    id: "legacy", title: "Checks", order: 0, hasTechnician: false,
    items: flat.map((i, order) => ({
      id: i.id, label: i.label, order, type: "status", status: i.checked ? "ok" : null, value: null, technicianName: null,
    })),
  }];
}

/**
 * The plain report the renderer takes, from a stored record.
 * `kind` "standalone": the header comes off the record (typed in, or the
 * customer / vehicle documents it points at). `kind` "job": off the job card.
 */
function reportFromRecord({ kind, record, job, customer, vehicle, signerName }) {
  const signedAt = toDate(record.completedAt);
  let header;
  if (kind === "job") {
    header = {
      plate: job?.plateNumber || "",
      customer: job?.customerName || "",
      phone: job?.customerPhone || "",
      mileage: job?.mileageOut ?? job?.mileageIn ?? null,
      date: signedAt,
      reference: job?.jobNumber || "",
    };
  } else {
    header = {
      plate: record.plateNumberManual || vehicle?.plateNumber || "",
      customer: record.customerNameManual || customer?.name || "",
      phone: customer?.phone || "",
      mileage: record.mileage ?? null,
      date: toDate(record.date) ?? signedAt,
      reference: "",
    };
  }
  const bySection = [...sectionsOf(record)].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((sec) => ({ ...sec, items: [...(sec.items ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) }));
  return {
    title: record.templateName || "Post-service checklist",
    header,
    sections: bySection,
    remarks: record.remarks || "",
    signerName: signerName || "",
    signedAt,
  };
}

module.exports = { reportFromRecord };
