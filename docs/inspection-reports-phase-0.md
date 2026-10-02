# Inspection Reports — Phase 0 findings

Read-only investigation of `maduranga98/PitStopIQ` @ `61f3645`. No code changed. Everything below is static analysis (no emulator, no prod access).

**Headline: five assumptions in the brief do not match the repo, and one existing module overlaps heavily.** Section 1 lists them; I need your calls on §10 before Phase 2.

---

## 1. Where the brief and the repo disagree

| # | Brief assumes | Repo reality |
|---|---|---|
| 1 | Invoice / vehicle share links have token, expiry, revocation, public read rules | **They have none of these.** The "share link" is `/c/:centerId/:customerId[/invoice/:invoiceId]`: a capability URL built from two Firestore IDs, read straight from Firestore under `allow get/read: if true`. No token, no expiry, no revoke, no view tracking. Short link `/v/:code` → `links/{code}` → `/c/…` (customer only). |
| 2 | A PDFKit invoice PDF function with signed URLs | **Doesn't exist.** No `pdfkit` in `functions/package.json` (deps: firebase-admin, firebase-functions, sharp, @napi-rs/canvas, pdfjs-dist). Invoice "PDF" = browser print (`usePrintDocument`, `printPaper.ts`). No `getSignedUrl` anywhere. The only "signed URL" idea is `buildFirebaseDownloadUrl` (Storage download-token URL) in the existing diagnostic-report code. |
| 3 | Atomic per-center-per-year invoice counter | **Not atomic and not a counter.** Invoices: `INV-YYYY-MM-NNNN`, allocated client-side by reading the highest number in the month prefix (`limit(1)`) and +1 (`ServiceDetailPage.tsx:651-672`, `NewInvoicePage.tsx:231`). Collisions are flagged after the fact by `flagDuplicateInvoiceNumber`. |
| 4 | Customer "portal" with sections, customer identity | There is no login portal. `/c/:centerId/:customerId` (`PublicCustomerView.tsx`, 1087 lines) is an unauthenticated tabbed page: Details · Service History · Invoices · Bookings · Complaints. Identity = knowing the URL. |
| 5 | Greenfield "diagnostic" report type | **A diagnostic-report module already ships**: `diagnosticReports` collection, `diagnosticReportsEnabled` flag, `DIAG-YYYY-NNNN` numbers, `/r/:shareToken` page, callables `getPublicReport` / `trackReportView`, Storage `diagnosticReports/…`, `src/components/diagnosticReports/*`. See §3. |

Also: stack is **React 19, Tailwind 4, TypeScript 6, Vite 8**, not React 18. `functions/` is a single 3.9k-line CommonJS `index.js` on Node 24 / firebase-functions v7, with a lint predeploy step. `.firebaserc` has only `default: pitstopiq` — no `handloom-ecom` / staging alias in the repo, and the only workflows are Hosting deploys, so staging deploy mechanics are outside what I can see.

---

## 2. Share links (invoice, vehicle/customer) — how they actually work

- **Customer link:** `buildViewLink(centerId, customerId)` in `src/lib/smsTemplates.ts:3` → `/c/{centerId}/{customerId}`. Public `get` on `customers/{id}`; `list` is staff-only. Vehicles, jobs, invoices, bookings are `read: if true` (so the page can `where("customerId","==",id)` as anonymous).
- **Invoice link:** `/c/:centerId/:customerId/invoice/:invoiceId`. `PublicInvoiceView` does `getDocWithRetry` on the invoice and checks `inv.customerId === customerId` and "finalized/smsSent". That is the only authorization.
- **Short links:** `src/lib/shortLinks.ts`. `links/{code}` (7-char base62, `get: true, list: false, create: any signed-in, update/delete: false`). Cached on `customers.shortCode`. Resolver `ShortLinkResolver.tsx` switches on `d.type` (`distributor`, `pos`, default customer). Cloud Functions have their own copy of the mint logic (`index.js:1568`).
- **Expiry / revocation:** none. Revoking means deleting the customer.
- **The one token-based mechanism in the repo is the diagnostic report one** (`/r/:shareToken`): 32-char `crypto.getRandomValues` token on the doc; **no client rule allows public read of the report**; the page calls callable `getPublicReport` (Admin SDK collection-group lookup by `shareToken`, can distinguish "revoked" from "not found", returns only whitelisted fields + center branding) and `trackReportView` (per-token 30 s warm-instance throttle, `increment(1)` + `lastViewedAt`). Toggling `isPublic` is the revoke. Needs a collection-group index on `shareToken`.

**Consequence for "mirror exactly":** mirroring the invoice mechanism would give no revoke, no `viewedAt`, no `viewCount` — all three required by the spec — and would need `inspectionReports` to be publicly readable, which would expose remarks and customer data to anyone guessing IDs. **Recommendation:** mirror the diagnostic-report mechanism (token + callable + Admin-SDK read, `revoked` flag), and reuse the `links/{code}` short-link collection with a new `type: "inspectionReport"` for SMS. Needs your approval (§10-Q1).

---

## 3. The existing Diagnostic Reports module (overlap)

Files: `src/types/diagnosticReports.ts`, `src/lib/diagnosticReports.ts`, `src/store/diagnosticReportsSlice.ts`, `src/hooks/useDiagnosticReportsEnabled.ts`, `src/components/diagnosticReports/*` (5), `src/pages/public/DiagnosticReportPublicView.tsx`, hooks into `VehicleDetailPage`, `ServiceDetailPage`, `NewServicePage`, `DashboardPage`, `SettingsPage`, `PublicCustomerView`, `photoUploadQueue.ts`. Functions: `getPublicReport`, `trackReportView`, `flagDuplicateReportNumber`, `generateReportThumbnail`. Rules: `diagnosticReports` (create gated on flag; read staff-only) + storage path.

What it is: one uploaded file (PDF/photo) + title + scan tool + notes, optionally tied to a job. Numbering `DIAG-YYYY-NNNN` via a non-transactional read-bump-write on `counters/diagnosticReports` (comment cites the same offline reasoning as the brief's rule 4).

Two things worth knowing:

1. **Likely existing bug:** `PublicCustomerView.tsx:744` calls `fetchPublicReportsForVehicle` from an **unauthenticated** client against `diagnosticReports`, whose rule is `read: if isSuperAdmin() || isMember(centerId)`. It will be denied; the `catch` returns `[]`, so customers never see the "Reports" card on the history tab. I haven't confirmed in prod. Not touching it (rule 1) — your call.
2. The comment on `diagnosticReportsEnabled` says "Owner-only", and the Settings card is gated `editable && isOwner`, but **firestore.rules does not enforce it** — a Manager can write that field with the SDK. Only `postServiceChecklistEnabled` and the working-hours flags have a rule guard (`postChecklistFlagOk()`, `workingHoursFlagsOk()`).

**Recommendation:** leave it entirely alone; the new engine's `diagnostic` type is a different thing (structured findings + multiple uploads + quick-check). Naming collision is a product problem: two "Diagnostic" features on the vehicle page. Suggest UI naming "Scan Reports" (old) vs "Inspection Reports" (new, includes a "Diagnostic" template). §10-Q2.

---

## 4. Customer portal structure (to match for "Reports")

- Route `/c/:centerId/:customerId`, tab state in `?tab=` (`details|history|invoices|bookings|feedback`), `TABS` array at `PublicCustomerView.tsx:611`. Dark card style: `bg-[#162032] border border-white/10 rounded-2xl p-5`, accent `#F97316`.
- Loads once with `getDocsWithRetry`: customer, center, vehicles/jobs/invoices `where customerId ==` — **unbounded, not paginated**. Bookings and feedback use `watchQuery` (listener).
- Center fields exposed to the page are read straight off the public center doc (`diagnosticReportsEnabled` is read this way to gate the card).
- **"Vehicle QR page" is this same page.** The vehicle QR encodes the *customer's* short link (`AddVehiclePage.tsx:515-522`), not a vehicle. So "appears on the QR page only if `visibleToCustomer`" = the same portal list.

**Plan for the new section:** add a `reports` tab (additive entry in `TABS`, shown only when `center.standaloneInspectionEnabled === true`). Because `inspectionReports` cannot be public-read, the tab fetches via a new callable `getPortalInspectionReports({centerId, customerId, cursor})` (Admin SDK, `finalized && visibleToCustomer && !revoked`, `orderBy finalizedAt desc`, `limit 20`, cursor = `finalizedAt` millis + id). Detail view → same `/i/:shareToken` page, or a callable `getPortalInspectionReport`. Customer identity stays "knows the URL", exactly as today — **gap to report, not fix:** anyone with the `/c/` URL can read the customer's whole history; the `/c/` capability has no revoke, so a leaked link also exposes reports. Callable adds no new exposure beyond what invoices already have, but it does mean "revoking a report share link" does not hide it from the portal list; `visibleToCustomer=false` does.

---

## 5. Job-card inspection module — reuse vs don't touch

- `src/components/inspection/VehicleInspectionForm.tsx` (554), `InspectionViewer.tsx` (183). Types + `INSPECTION_CHECKLIST_ITEMS` in `src/types/auth.ts`; statuses `ok | needs_attention | damaged`. Data: `jobs/{jobId}/inspection/{docId}` (rules: `read: if true`). Flag `inspectionEnabled`, **Pro-only**, gated in `NewServicePage` / `ServiceDetailPage`.
- Photos: `compressImage` (`lib/imageCompressor.ts`: `createImageBitmap` → OffscreenCanvas, max 1920, ≤800 KB, JPEG) then **direct `uploadBytes`** to `inspections/{centerId}/{jobId}/{file}` — it does **not** use the offline queue. 30-day purge via `dailyInspectionCleanup` (collection-group `inspection`, `nextPhotoDeleteAt <= now` and `photosDeleted != true`, 02:00 LKT).
- **Do not touch:** all of the above, `INSPECTION_CHECKLIST_ITEMS`, `compressImage` (different limits: ours 1600 px / q0.8; also no manual rotate/EXIF handling), `dailyInspectionCleanup`.
- **Offline queue** (`lib/photoUploadQueue.ts`, `hooks/usePhotoUploadQueue.ts`, IndexedDB `pitstopiq-photo-queue` v1): stores base64 data URL; on reconnect `uploadString` → `getDownloadURL` → `updateDoc(doc(fieldPath), {[fieldKey]: url})`; 3 attempts then `failed`; users today are the diagnostic upload sheet and `OfflineAwarePhotoInput`. `metadata.type` is a closed union. **Limitation:** it can only set *one field path to a string URL*. It cannot append to an array nested inside `results.{itemId}.photos`. It can, however, set a dotted path inside a **map** (`media.<fileId>.url`). So a map-by-fileId data shape lets me reuse the queue with one additive change (`"inspectionReport"` in the type union, and clearing `pending` on landing, same as the `diagnosticReport` branch). Note the queue is stored in the same IDB store as other types, and a shared `processQueue` runs on `online`, so the change must be strictly additive. §10-Q3.
- No EXIF handling exists. `createImageBitmap` honours EXIF by default in current Chromium/Safari (`imageOrientation: "from-image"`), but I'll set it explicitly and verify with a canvas fallback.

---

## 6. SMS and WhatsApp

- **Send path:** client creates a doc in `servicecenters/{c}/smsLogs` with `messageType`, `status: "sent"`, `message`, `phone`, ids (`InvoiceDetailPage.tsx:1236`). Cloud Function `dispatchSmsLog` (`onDocumentCreated`, maxInstances 3) sends via eSMS and, **only on successful delivery**, increments `smsQuotaUsed` by computed segments. The field is `messageType`, not `type`. Current values: `Completion | Reminder | Invitation | ThankYou | PurchaseOrder | BookingConfirmed | BookingRejected` (`types/auth.ts:1027`). Rules: create allowed for Owner/Manager/Technician; Receptionist only for the two Booking types; Cashier none; update/delete false.
- **Quota check is client-side and advisory:** read `smsQuotaUsed` / `smsQuotaLimit` (fallback `smsQuotaLimit(plan)` = 200/1000) from the center doc, `quotaExceeded = used >= limit`. No reservation: concurrent sends can overshoot by a message or two; the segment count (Sinhala/Tamil = UCS-2, 70 chars) is only known after sending. Same behaviour will apply to us.
- **New value:** add `"InspectionReport"` to the union (type-only, additive). `RETRY_FIELDS` in `retrySmsLoginFailures` (`index.js:1464`) is an allow-list of fields copied on auto-retry: a new `reportId` field would be dropped on retry unless added there — a tiny edit to an existing function; flagging because of rule 6's spirit. Rules need no change.
- **Short link in SMS:** `smsShortLink(code)` = scheme-less `app.pitstopiq.com/v/{code}`. New `links/{code}` docs with `type: "inspectionReport", centerId, shareToken` + one extra branch in `ShortLinkResolver` (existing file, additive).
- **WhatsApp:** `https://wa.me/{number}?text={encoded}` where `number` = digits of `customerPhone`, leading `0` → `94` (`InvoiceDetailPage.tsx:1275-1281`). (`diagnosticReports.ts` uses `wa.me/?text=` with no recipient.)
- **Phone formats differ:** customers are stored as `+94XXXXXXXXX` (`AddCustomerPage.normaliseLKPhone`, a local copy). Login/SMS use `functions/shared/phone.mjs` `normaliseLocalPhone` → 9-digit `771234567`; eSMS has its own `normaliseMsisdn`. The brief says use "the same normalisation as login/SMS" — I'll normalise with `normaliseLocalPhone` and then match/store as `"+94"+local`, since that is the stored format. Legacy rows in other formats (import/edit) could be missed; `customers.phone ==` exact match is what Add Customer does today too.

---

## 7. Role permissions

- `settings/rolePermissions` doc = `{manager, technician, cashier, receptionist}: RolePermissions` (full grid per role), written with `setDoc(..., {merge:false})` from `PermissionsContext.saveRolePermissions`. Owner is implicit-all. Loaded only for **Pro** centers; Basic falls back to defaults. `customRoles/{id}` hold a full grid + `baseRole`; rules only know the base role.
- Adding a group is additive-safe: `mergeWithDefaults` iterates the defaults' sections, so a stored doc predating `inspectionReports` still resolves via defaults. Touch points: `types/permissions.ts` (interface), `lib/defaultPermissions.ts` (4 role defaults + `LOCKED_OFF`), `RolePermissionsPage.tsx` (label/section list), i18n, `navItems.ts`.
- **Constraints from existing LOCKED_OFF / rules:** Technician has `customers.view` and `vehicles.view` locked off and cannot create customers/vehicles (rules: Owner/Manager/Receptionist only). So a Technician **cannot pick a vehicle or quick-add**; they can only fill reports "assigned to them" — I'll implement that as `assignedToUid` on the report, set by Owner/Manager/Receptionist.
- Rules can mirror granular grants: the `jobs` rule already `get()`s `settings/rolePermissions` and `customRoles/{id}` (`timerPermissionGranted`, `firestore.rules` ~L295-330). I'll reuse that pattern for `inspectionReports.*`, at the cost of 2–3 extra `get()` calls per write.

---

## 8. Firestore / Storage rules structure

- Helpers: `isSuperAdmin()`, `isMember(c)`, `hasRole(c, [roles])` (reads `staff/{uid}.role`). Each center sub-collection has its own `match` block; defaults are deny.
- **Center doc update** (`firestore.rules:91`): Owner/Manager may write **any field except** a deny-list (`ownerUid, isBranch, primaryCenterId, monthlyRate, isActive, plan, status, currentPeriodStart/End, graceDeadline, smsQuotaLimit, paymentCode, storeAddons`). Owner-only flags use helper functions (`postChecklistFlagOk`, `workingHoursFlagsOk`) that check `diff().affectedKeys().hasAny([...]) → hasRole Owner`.
  - **Note:** `smsQuotaUsed`, `smsPackageSubscriptions`, `deletionScheduledAt` etc. are *not* in the deny-list — a client Owner/Manager can already write them. Pre-existing; out of scope, but it matters for your "no other protected fields" requirement: the rule is a deny-list, so "narrow" means adding `inspectionReportsFlagOk()` to enforce Owner-only for `standaloneInspectionEnabled`, not a field allow-list. Say if you want a stricter allow-list approach for the owner path (would change existing behaviour — I won't).
- New collections will follow the diagnostic-report pattern: read staff-only, create gated on the flag read from the center doc (`get()`), update/delete by role; status/finalized locking enforced in rules (`resource.data.status == 'draft'`); finalized writes only via Admin SDK callable.
- Storage rules: `isMember` via `firestore.exists`; existing size/contentType patterns for `inspections/…` and `diagnosticReports/…`. New path `inspectionReports/{centerId}/{reportId}/{fileId}` (≤10 MB, `image/jpeg|image/png|application/pdf`, staff create, no update, member delete). Reads staff-only; customers get Admin-minted download-token URLs from callables.
- Indexes: `firestore.indexes.json` has `indexes` + `fieldOverrides` (collection-group overrides exist for `shareToken`).

---

## 9. Settings toggles, customers/vehicles creation, reminders

**Toggles.** Settings → tab `services` = "Services & Modules" (`ServicesTab`, `SettingsPage.tsx:~4590`; the brief's "Service Settings"). Each is a `ModuleCard` (collapsible row, `enabled`, `editable`, `locked`, `onToggle`, `notes`). Write = `safeUpdateDoc(doc(db,"servicecenters",id), {[field]: value})`. `editable = usePermission("settings.manageServiceLibrary")`; Owner-only ones add `&& isOwner`. Read side varies: `inspectionEnabled` is re-read per page from the center doc; diagnostic reports use a zustand store read once per center (`useDiagnosticReportsEnabled`). I'll use the diagnostic pattern (one read, cached) plus the public center doc for the portal. `standaloneInspectionEnabled` default absent = false.

**Customers / vehicles — the logic is inline in the pages, not in lib/.**
- Customer (`AddCustomerPage.tsx`): name 2–80, phone must match `^\+94\d{9}$|^0\d{9}$|^94\d{9}$` → stored `+94…`; duplicate check `where phone == normalized, isDeleted == false, limit(1)` → offers "open existing"; doc `{name, phone, smsLanguage:"english", notes, isDeleted:false, vehicleCount:0, lastServiceDate:null, createdAt, centerId}` via `safeAddDoc`. `maintainCustomerSearchFields` trigger adds search fields.
- Vehicle (`AddVehiclePage.tsx`): required plate, customer, vehicleType; mileage optional ≥0; duplicate check `plateNumber == UPPER(trim), isDeleted == false`; payload as at L455-475; then `logVehicleEvent("Vehicle added")`; then **QR generation** (mint customer short link, render PNG, upload `servicecenters/{c}/vehicles/{id}/qr.png`, write `qrCodeUrl`/`qrEncodesShortLink`); `persistCustomOptions` writes new make/model/type options onto the **center doc**. `maintainVehicleSearchFields` trigger adds `searchPlate`.
- To "reuse the same logic" without editing those pages (rule 1) I'd have to **duplicate** it into `src/lib/quickAdd.ts`, with a parity test pinning the field set. Refactoring the pages to call shared helpers is cleaner but modifies the existing flow. §10-Q4.
- Permissions for quick-add follow existing rules: Owner/Manager/Receptionist only.

**Reminder behaviour (what you asked me to report).**
- Nightly reminder = `sendServiceReminders` (08:30 LKT). It does **not** look at mileage. It selects vehicles by **`nextServiceDate`** in `[now − 14d, now + 3d]` (collection-group query), skips `reminderSent === true`, needs `customerId` and customer `phone`.
- `nextServiceDate` is written **only** at job completion (`ServiceDetailPage.tsx:~990`, from the gap since `lastServiceDate`). A vehicle created without a completed job never has one → **never gets an SMS reminder**, whatever mileage fields it has.
- `dueForService` (used by the dashboard "reminder vehicles" list, `where dueForService == true`) is maintained by `maintainVehicleDueFlag`: true only if **both** `nextServiceMileageKm` and `currentMileageKm` are numbers and `next − current ≤ 0`, and it is recomputed only when one of those two fields changes.
- So: a quick-added vehicle with no mileage → both null → never due, never reminded. **Caveat to the brief:** the existing Add Vehicle logic sets `nextServiceMileageKm = mileage + 5000` automatically whenever mileage is typed (`AddVehiclePage.tsx:471-473`; the comment says that's deliberate). Reusing that logic therefore *does* set `nextServiceMileageKm` for a quick-added vehicle with mileage. It still wouldn't be due (5,000 km ahead) and still wouldn't get the nightly SMS, but it would later flag dueForService once some other flow bumps `currentMileageKm` past it. To honour "don't set unless user fills", the quick-add path must write `nextServiceMileageKm: null` explicitly (a deliberate divergence from Add Vehicle). **I won't write mileage back to the vehicle from a report** unless you say so — doing that would feed `maintainVehicleDueFlag`.

**Read-cost safety.** `lib/listeners.ts` `watchQuery/watchDoc` wrap `onSnapshot`; `boundedGetDocs` has a 10 s timeout + cache fallback. No pagination helper exists today; I'll add `limit(20)` + `startAfter` cursor queries via `boundedGetDocs` for lists and use `watchDoc` only on the single open report.

**Writes.** `safeSetDoc/safeUpdateDoc/safeAddDoc/safeDeleteDoc` (`firestoreWrite.ts`): offline → resolve immediately; online → wait for ack up to 8 s; rejections reach `registerWriteFailureHandler` → toast. Only client `runTransaction` in the repo is `postServiceChecklist.saveTemplate` (documented exception).

---

## 10. Decisions I need from you

**Q1 — Share-link mechanism (blocks Phase 6).** Mirror the diagnostic-report model (token + `getPublicInspectionReport` / `trackInspectionReportView` callables, revoke flag, `links/{code}` short link `type:"inspectionReport"`), since the invoice mechanism has no token/revoke/viewed? *Recommended: yes.*

**Q2 — Overlap with Diagnostic Reports.** Keep both modules independent and separately toggled, naming the new one "Inspection Reports" and leaving the old "Diagnostic Reports" card untouched? Should I also report/fix the portal-section permission bug (§3) separately? *Recommended: independent; fix the bug in its own PR, not here.*

**Q3 — Media data shape (blocks Phase 2).** Spec says `photos[]` and `attachments[]` arrays. To reuse the offline queue I'd store a map `media: { [fileId]: {kind, name, mime, size, url|null, pending, mediaDeleteAt, mediaDeleted} }` with `results[itemId].photoIds[]` and `attachmentIds[]` referencing it, plus top-level `nextMediaDeleteAt` for the cleanup query. Accept the map? *Recommended: yes — arrays can't be updated by the queue, and per-item `mediaDeleteAt` can't be indexed in either shape.*

**Q4 — Quick-add reuse.** Duplicate the add-customer/add-vehicle logic into `lib/quickAdd.ts` (existing pages untouched, parity test), or extract shared helpers and edit the two pages? *Recommended: duplicate + parity test now; consolidate later in a separate PR.*

**Q5 — Report number + finalize (blocks Phase 5).** No atomic counter exists. Since finalize is online-only, do it server-side in callable `finalizeInspectionReport`: Admin-SDK `runTransaction` on `counters/inspectionReports` (`{year, seq}`) → `INS-YYYY-NNNN`, lock, generate PDF — truly atomic and allowed (rule 4 forbids *client* transactions). *Recommended: yes.*

**Q6 — PDF engine.** Add `pdfkit` to `functions/package.json`. PDFKit's built-in fonts have no Sinhala/Tamil glyphs, and `smsLanguage` supports both, so customer/remark text in those scripts would render as blanks; I'd bundle Noto Sans (+ Sinhala, Tamil) TTFs in `functions/fonts/`, which increases package size. Accept? Output is stored at `inspectionReports/{c}/{id}/report.pdf` and returned as a download-token URL (same approach as the diagnostic module; there is no existing signed-URL code to mirror). Note retention: media expires at 12 months but the PDF (with embedded photos) is permanent — regenerate-after-expiry must show "Photo expired", per spec. *Recommended: yes.*

**Q7 — Flag write guard.** Add `inspectionReportsFlagOk()` (Owner-only via `affectedKeys`) like `postChecklistFlagOk`. The center rule stays a deny-list for everything else; I won't change existing protections (e.g. `smsQuotaUsed` is client-writable today — flagging, not fixing). OK?

**Q8 — Technician flow.** Technicians can't read vehicles/customers (locked off) so they only open reports assigned to them. OK, or do you want to unlock a minimal vehicle read for inspections?

**Q9 — Mileage.** Don't write report mileage back to the vehicle; quick-add vehicle gets `nextServiceMileageKm: null` even though Add Vehicle would auto-set it. OK?

---

## 11. Proposed file / folder plan (all new unless marked *edit*)

```
src/
  constants/inspectionReports.ts          limits, retention months, photo dims, DEFAULTS_VERSION
  constants/defaultInspectionChecklist.ts versioned default template (stable ids)
  types/inspectionReports.ts
  lib/inspectionReports/
    paths.ts            collection/doc refs, storage path builder
    templates.ts        seed-on-enable, hide/restore/add/rename/reorder (pure fns + writes)
    reports.ts          create draft, autosave patch (dotted-path updates), reopen, delete
    snapshot.ts         template → report snapshot
    media.ts            EXIF fix, resize 1600/q0.8, rotate 90°, validate type/size/count
    mediaQueue.ts       additive wrapper over photoUploadQueue
    quickAdd.ts         phone/plate match + real customer/vehicle creation (see Q4)
    share.ts            callables client, wa.me builder, SMS log writer + quota check
    permissions.ts      keys + helper hook
  hooks/useInspectionReportsEnabled.ts (+ store/inspectionReportsSlice.ts)
  pages/inspectionReports/
    InspectionReportListPage.tsx          paginated 20 + cursor
    InspectionReportEditorPage.tsx        checklist / diagnostic layouts
    InspectionTemplatePage.tsx
  components/inspectionReports/           NewReportSheet, QuickAddForm, ChecklistSection,
    ItemRow, PhotoPicker (rotate), AttachmentList, SignaturePad(reuse existing jobSignature if suitable),
    ShareSheet, ReportStatusBadge, VehicleReportsList
  pages/public/InspectionReportPublicView.tsx   route /i/:shareToken
  components/public/PortalReportsTab.tsx        paginated, via callable

functions/
  inspectionReports.js        callables + scheduled cleanup, required from index.js
    finalizeInspectionReport, regenerateInspectionReportPdf, reopenInspectionReport,
    getPublicInspectionReport, trackInspectionReportView, revokeInspectionReportLink,
    getPortalInspectionReports, dailyStandaloneInspectionCleanup (every day 02:30 Asia/Colombo)
  inspectionPdf.js            PDFKit renderer
  fonts/                      Noto TTFs (Q6)
  index.js                    *edit*: one `require("./inspectionReports")` line
```

Existing files touched (each a small additive edit, none changes existing behaviour):
`src/types/auth.ts` (center flag + `"InspectionReport"` messageType), `src/types/permissions.ts`, `src/lib/defaultPermissions.ts`, `src/pages/settings/RolePermissionsPage.tsx`, `src/pages/settings/SettingsPage.tsx` (one ModuleCard), `src/lib/navItems.ts` + `Layout` nav, `src/App.tsx` (3 routes), `src/pages/vehicles/VehicleDetailPage.tsx` (button + history list), `src/pages/public/PublicCustomerView.tsx` (tab), `src/pages/public/ShortLinkResolver.tsx` (one branch), `src/lib/photoUploadQueue.ts` (type union + landing branch), `functions/index.js` (require line, `RETRY_FIELDS`), `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `src/locales/{en,si,ta}`.

### Rules sketch (Phase 2)
- `servicecenters/{c}/inspectionTemplates/{id}`: read staff; create/update `manageTemplate`; no delete.
- `servicecenters/{c}/inspectionReports/{id}`: read staff (view perm; Technician only where `assignedToUid == uid`); create needs `create` perm **and** flag on; update only while `status == 'draft'` for edit perms, and **never** touching server-owned keys (`status→finalized`, `reportNumber`, `finalizedAt`, `pdfUrl`, share fields, `viewCount/viewedAt`, `sharedAt`) from the client — those are written by callables; delete `delete` perm (Owner only by default).
- Center doc: `inspectionReportsFlagOk()` as in Q7.
- Counter `counters/inspectionReports` written only by Admin SDK.

### Indexes (initial list)
1. `inspectionReports`: `status ASC, finalizedAt DESC` (list/portal)
2. `inspectionReports`: `customerId ASC, status ASC, visibleToCustomer ASC, finalizedAt DESC` (portal list, Admin SDK)
3. `inspectionReports`: `vehicleId ASC, createdAt DESC` (vehicle history)
4. `inspectionReports`: `assignedToUid ASC, updatedAt DESC` (technician list)
5. Collection-group override: `inspectionReports.shareToken` (ASC, COLLECTION_GROUP + COLLECTION)
6. Collection-group override: `inspectionReports.nextMediaDeleteAt` (cleanup) — also needs `mediaDeleted` handled in code, not as `!=` filter, to avoid the extra composite the existing cleanup needs.

### Phase 2 deliverables (when approved)
Types, constants (defaults + limits + retention), `standaloneInspectionEnabled` on `ServiceCenter`, Settings ModuleCard + hook/store, rules + storage rules + indexes, and a rules unit-test plan (the repo has no rules test harness; `npm test` is `node --test src/**/*.test.ts` — I'd add pure-function tests only, and list manual emulator checks).
