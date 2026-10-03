# Inspection Reports — Phase 9 final review

Scope: the whole feature (phases 2–8). Evidence is the repo's own tests unless stated; items that need a real device or a deployed project are listed as manual checks at the end.

## 1. Read cost

**Listeners.** Exactly one, in all the new code: `useReportDraft` → `watchDoc` on the *one report that is open*. No collection or query listener exists in the module (grep of `onSnapshot|watchQuery|watchDoc` over `src/lib/inspectionReports`, `src/components/inspectionReports`, `src/pages/inspectionReports`, the hooks and `functions/inspection*.js`).

**Every read, with its bound:**

| Where | Read | Bound |
|---|---|---|
| Staff list (`fetchReportsPage`) | `inspectionReports` by status / assignee | `limit(20)` + cursor, on demand, re-run only on tab change or "Load more" |
| Vehicle history | `inspectionReports` by `vehicleId` | `limit(20)` + cursor, on mount |
| Template page | 1 doc (`inspectionTemplates/default`) | once per open |
| Open report | 1 doc, listener | one per open editor |
| Quick-add | customer by phone (`limit 1`), vehicles of a customer (`limit 20`), plate (`limit 1` + prefix search `limit 5`) | per search, debounced 350 ms |
| Share card | 1 doc (the centre, for quota + name) | once per open, once more after an SMS |
| Module flag | **0 extra reads**: `useWorkshopModules` (existing live listener on the centre doc) now carries the flag and keeps the gate's cache current; the old per-session `getDoc` remains only as a fallback for direct landings on a module page | — |
| `getPublicInspectionReport` | 1 collection-group query (`limit 1`) + 1 centre doc | per page view |
| `trackInspectionReportView` | 1 query (`limit 1`) + 1 write | throttled 30 s per link per warm instance |
| `getPortalInspectionReports` | centre + customer docs + ≤ 4 queries totalling ≤ ~20 reports | 20 rows per call; fetched only when the Reports tab is opened |
| `dailyStandaloneInspectionCleanup` | collection-group scan on `nextMediaDeleteAt <= now` | 100 per page, ≤ 50 pages per run; processed reports leave the query |

A centre that never turns the module on pays nothing: the flag rides an existing listener, the portal tab is hidden by the public centre doc it already reads, the vehicle card and nav entry are gated, and no function runs for it except the nightly scan (one indexed query that returns nothing).

Each query's index is declared (`src/lib/inspectionReports/indexes.test.ts` checks `firestore.indexes.json` against the list of queries; the emulator doesn't enforce indexes, so this is the guard).

No client transactions (`runTransaction` / `writeBatch`: none in the module). Report numbers use an Admin SDK transaction at finalize.

## 2. Offline

Automated (emulator end-to-end, real Firestore persistence in Chromium, `setOffline`):
- create a brand-new draft with no connection (cached template + vehicle) and edit it; both sync on reconnect
- edit an existing draft offline; photo taken offline is queued ("Queued" tile with a local preview) and uploaded on reconnect, which clears `pending`
- finalize, reopen, PDF, WhatsApp, SMS are disabled offline with an explanation; Copy link and Download PDF still work; the draft stays editable

Manual on a phone (cannot be automated here):
1. Airplane mode → New report from a vehicle opened earlier → answer ten items → add two photos → leave the app → reopen it → still there.
2. Reload the app **while offline** and open the draft (needs the PWA shell cached).
3. Reconnect: photos upload, "Queued" disappears, edits appear on a second device.
4. Offline with a technician login: assigned report opens, edits, photo queue.
5. Kill the browser tab mid-upload; reopen online — the queued photo still lands.

## 3. Security review

Reviewed `firestore.rules` and `storage.rules` additions line by line, the callables, and the public surfaces. Tested against the emulators (16 Firestore rule tests, 7 Storage rule tests, 159 end-to-end checks).

**Fixed during this pass**
- *Public page link injection.* A media `url` is staff-writable and the public page renders it as a link/image source. A staff account could have planted a `javascript:` URL that runs in a customer's browser. The public callable now passes on only Firebase Storage download URLs (`isStorageDownloadUrl`; emulator hosts only under the emulator) and drops the rest. Unit + end-to-end tests.
- *Storage: who may touch report media.* Any centre member (incl. Cashier / Receptionist, who are view-only) could add or delete photos. Create/delete is now Owner / Manager / Technician; `report.pdf` stays Owner-only to delete and never client-creatable. Also added `resource == null` on create so a file can't be overwritten. Corrects an earlier note: the real `storage.rules` **are** now verified in the Storage emulator (the earlier failure was the sandbox's proxy `JAVA_TOOL_OPTIONS`, not the rules).
- *Read cost:* see §1 (removed an unconditional per-session read).

**Checked and fine**
- Cross-centre access: every rule keys on `{centerId}` in the path; a staff member of centre A cannot read or write centre B's reports, templates, counters or media (rules tests + storage tests).
- Server-owned fields (status, number, PDF, share token, revoke, view counts, expiry key, `finalizedBy`) cannot be written from a client, on create or update.
- A finalized report is locked to everyone except `visibleToCustomer` / `sharedAt` (needs `send`).
- Permission ceilings hold even if a stored grid says otherwise; custom-role grids replace the base role's entry; Owner is immune. Rules, callables and app share one definition, enforced by a parity test.
- Public callables return a whitelisted payload: no customer phone, uids, share token, internal fields or retention dates (end-to-end check).
- Share tokens are 32 random alphanumerics (≈ 190 bits), queried by exact match; malformed tokens are rejected before any query.
- The report counter lives outside `counters/` (which is client-writable) and is written only by the finalize transaction; 6 concurrent finalizes give 6 consecutive numbers.
- Text from staff/customers is rendered through React (escaped); PDF text goes through `pdfSafe`.

**Known and accepted (pre-existing patterns, flagged for your decision)**
1. *Revocation scope.* Revoking turns off the page. The individual photo/PDF **download-token URLs** keep working for anyone who already copied one directly (unguessable, unlistable). Closing this means rotating each file's token on revoke — say if you want it.
2. *The portal is a capability URL.* Anyone with `/c/:centerId/:customerId` can list that customer's visible, non-revoked reports (and so their share tokens) — the same exposure the portal already has for invoices and history. `visibleToCustomer` and revoke are the owner's controls.
3. *SMS creation* is governed by the existing `smsLogs` rule (Owner / Manager / Technician); the `send` permission is enforced by the report update rule and the UI, not by that rule (it is not edited here). A Manager with `send` off could still queue an SMS by writing `smsLogs` directly.
4. *Public callables have no App Check / rate limit*, like `getPublicReport`; view tracking is throttled per warm instance only, so a determined client can inflate `viewCount`.
5. *`links/{code}` is creatable by any signed-in user* (existing rule); an attacker can't guess a report's code (it derives from the secret token).
6. `smsQuotaUsed` is client-writable by Owner/Manager under the existing centre rule (deny-list) — not changed here.

## 4. Regression check

Diff of the feature against the pre-feature base (`61f3645`) restricted to files that already existed:
- 23 existing files touched, **17 lines removed in total, every one a replacement of a single line by a superset** (an import list, a union type, a ternary/array, a `modules` object). No existing logic was deleted or reordered. `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `translation.json`, `App.tsx`, `PermissionsEditor.tsx` and `types/permissions.ts` are pure additions.
- The existing job-card inspection module, `dailyInspectionCleanup`, `compressImage`, the invoice/diagnostic code and the diagnostic card on the portal are untouched.
- Behaviour-affecting edits to existing code, all additive: `photoUploadQueue.ts` (a new type value and one branch that only runs for it), `functions/index.js` (`"reportId"` added to `RETRY_FIELDS`; one `require` line at the end), `ShortLinkResolver` (one branch ahead of the existing ones), `PublicCustomerView` (a tab entry shown only when the module is on), `VehicleDetailPage` (a button and a card, both gated), `useWorkshopModules` (an extra returned field), `defaultPermissions.ts` (a new group; `mergeWithDefaults` already tolerates stored grids that predate it).
- With the module off (the default) the app renders exactly as before: no nav item, no routes' content (redirect), no portal tab, no vehicle card or button.
- Checks run: `tsc -b`, `vite build`, 48 app unit tests, 27 functions tests, 16 + 7 rules tests, 7 cleanup tests, 159 end-to-end checks. ESLint: no new errors in the feature's files; the repo's pre-existing lint errors (Navbar ×2, `useCachedRefList`, `usePhotoUploadQueue`, `PermissionsEditor` fast-refresh, `DiagnosticReportPublicView`, `PublicCustomerView`, `SettingsPage:1932`) are unchanged.
- Existing end-to-end coverage of the *old* flows (invoices, jobs, SMS, existing diagnostic module) does not exist in this repo; regression assurance for them is the diff analysis above plus staging smoke test (§5).

## 5. Before and after deploy

**Order:** (1) `firestore.indexes.json` — wait for the 5 composites + 2 overrides to finish building; (2) `functions` (`npm ci` first; adds `pdfkit`; new callables + `dailyStandaloneInspectionCleanup`); (3) `firestore.rules` and `storage.rules`; (4) hosting. The feature is off until an Owner switches it on, so (4) alone is harmless.

**Note on history:** the first PR for this branch (phases 0–5) was merged into `main` before phases 6–8 were pushed; `main` therefore already carries phases 0–5 (hosting auto-deploys from `main`; functions and rules do not). Phases 6–9 are in a new PR.

**Staging smoke test (existing flows, ~15 min):** create a job → complete → invoice → send invoice SMS; open an invoice share link; add a customer and a vehicle; upload a diagnostic scan report and open its `/r/` link; run a job-card inspection with a photo; open the customer portal (all existing tabs); change a role permission and a custom role; switch Inspection Reports on and off.
