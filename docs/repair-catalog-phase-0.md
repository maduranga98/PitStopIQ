# Repair Catalog — Phase 0 findings

Read-only investigation of `maduranga98/PitStopIQ` @ `f4ecc51` (branch `claude/blissful-albattani-rdnbm9`, identical to `main`). **No application code changed.** Everything below is static analysis: no emulator, no staging or prod access.

**Headline:** the feature fits the codebase well. The reference cache, the module-flag pattern and the invoice/commission structure all support an additive design. There are **five places where the brief's assumptions don't match the repo** (§1), **three existing code paths that must be touched to keep repair lines on the bill** (§6, flagged for your approval per rule 5), and **eight decisions I need from you** (§13).

---

## 1. Where the brief and the repo disagree

| # | Brief assumes | Repo reality |
|---|---|---|
| 1 | "8 fixed vehicle types" | `VehicleType` is a plain `string` (`types/auth.ts:931`). Defaults are **4**: `car, van, lorry, motor bike` (`lib/vehicleOptions.ts`). Each center adds its own on `servicecenters/{id}.customVehicleTypes` and can hide defaults (`hiddenVehicleTypes`). Matching everywhere is an exact, case-sensitive string compare (`servicePricing.ts:pickForType`). |
| 2 | Per-center flags such as `bayWorkflowEnabled` / `commissionEnabled` are set by the super admin | **They are set by the center.** Settings → Services & Modules (`SettingsPage.tsx:4643`, `setFlag` → `safeUpdateDoc(center, {[field]: value})`), gated by the `settings.manageServiceLibrary` permission. There is **no existing super-admin-only module flag**. The admin center page (`ServiceCenterDetailPage.tsx`) only writes plan, status, renewal and SMS quota. So `repairCatalogEnabled` starts a new pattern (§9). |
| 3 | `servicesPerformed` | No such field. A job (`servicecenters/{id}/jobs/{jobId}`) carries `services: string[]`, `customServices: string[]`, optional `serviceLines[]` (bay/commission modules only), `serviceDiscounts`, and `partsUsed[]`. The brief's "service doc" is the **job** doc. A legacy `services` collection exists but is unused for new work. I'll call the new field `repairsPerformed` on the job. |
| 4 | "`onServiceCompleted`" stock deduction | There is no such function. Stock deduction is **client-side**, in `ServiceDetailPage.handleMarkDone` → `deductParts` (§7). The only job trigger is `onJobCompleted`, which does commission only. |
| 5 | "Pro/Business" plans | `ServiceCenter.plan` is `"basic" | "pro"` only. No Business tier in code. Nothing here needs a plan check, and I won't add one. Also: the stack is **React 19 / Tailwind 4 / TypeScript 6 / Vite 8**, not React 18. |

Repo has only `main` and this branch. There is no `staging` branch or `handloom-ecom` alias in `.firebaserc` (only `default: pitstopiq`), and the only workflows are Hosting deploys, so I can't see the staging mechanics.

---

## 2. Service library (the model to mirror)

**Data model.** `servicecenters/{c}/servicePrices/{id}` (`ServicePriceItem`): `name, description?, category?, defaultPrice, unit?, isActive?, vehicleType?`. **One document per (name, vehicleType)** pair, with an optional typeless doc as the "all types" fallback. A service "Oil Change" priced for 3 types is 3–4 docs. Categories are a fixed union (`Engine | Brakes | Tyres | Suspension | Electrical | Body | AC | General | Other`), units are `per service | per litre | per item | per hour`.

**Price resolution** (`lib/servicePricing.ts`): `pickForType` returns exact `vehicleType` match → typeless entry → `matches[0]`. `buildCatalogIndex` groups by name once so list screens avoid O(n²) (a past freeze on tablets, documented in the file). On a job the price is **re-resolved at every invoice sync** from the live catalog (`ServiceDetailPage.createDraftInvoice` L720, `serviceLines.syncServiceLines`), never frozen, except once a commission snapshot exists. A manual override exists only as a per-service **discount** (`job.serviceDiscounts[name]`), not a price override.

**Consequence for repairs:** the brief wants "override-able by the user, as with the service library". The library doesn't really allow that (it allows a discount). I propose repairs **freeze their resolved/overridden price on the job** (`repairsPerformed[].price`), and the invoice reads that snapshot instead of re-resolving. Simpler, and a catalog edit can't silently re-price an open job (§13-Q4).

**UI.** `pages/services/ServiceCatalogPage.tsx` (829 lines), route `/services/catalog`, `RequirePermission serviceLibrary.view`. Writes are Owner/Manager at the rules level.

**Reads.** The job form (`NewServicePage`) loads it with a `watchQuery(orderBy("name"))` listener. The ref-cache (`lib/refData.ts`) has `fetchServicePrices` too. Both patterns exist.

---

## 3. Vehicle forms and make/model today

- `AddVehiclePage.tsx` (897 lines) serves add and edit (`EditVehiclePage` passes `initialData`). Fields: plate (required, uppercase, duplicate check on `plateNumber + isDeleted==false`), customer (required), **`vehicleType` (required, free text with suggestions)**, `make?`, `model?` (both **free text** via a combobox of suggestions), colour, mileage, oil fields.
- Make/model suggestions = union of every saved vehicle's make/model **plus** `center.customVehicleMakes` / `customVehicleModels` (flat string lists, no link between a make and its models, no type). `persistCustomOptions` writes new strings to the center doc in the same save. So today "Dio" and "dio " are different strings.
- Vehicle write rule: Owner/Manager/Receptionist create+update. Vehicles are **publicly readable** (`read: if true`, for the customer share link).
- Jobs snapshot `make`, `model`, `year`, `vehicleType` from the vehicle at creation (`jobCreation.ts`). They don't carry a vehicle id for the *model*, so the job needs `modelId` snapshotted too, otherwise a job opened for an old vehicle can't re-resolve prices if the vehicle is later re-linked.
- **Slot for the model picker:** replace the Make + Model comboboxes in `AddVehiclePage` (render-gated on the flag) with a single searchable "Vehicle model" picker. Picking a model sets `make`, `model`, `vehicleType` from the model doc and writes `modelId`. "Add new model" creates the `vehicleModels` doc from the make/model/type already on the form. The free-text fields stay as they are when the flag is off. `make`/`model` keep being written when a model is picked, so every reader that predates this still works (rule 6).
- A suggestion-linking pass for existing vehicles (match `make`+`model` text to a `vehicleModels` doc, case/trim-insensitive) is feasible entirely client-side from the cached vehicles list, with explicit confirmation. No bulk write is ever automatic.

---

## 4. Job creation and where Repairs slots in

`pages/services/NewServicePage.tsx` (1730 lines), 3 steps: Customer → Vehicle → Job Details. A walk-in mode skips records (blank `vehicleId`).

- Vehicle selected in step 2 (`selectedVehicle`, or typed `walkInVehicleType`). `jobVehicleType` drives service-grid filtering (`serviceNamesFromIndex`).
- Services: grid of catalog names + free-text `customServices`. Parts: search box → `searchInventoryItems` (client-side substring filter over the **cached** inventory catalog, 5-min TTL, `lib/inventorySearch.ts`) → qty → `addPart()` which snapshots `{itemId, itemName, partNumber, brand, warranty, quantity, unitPrice: serviceCenterPriceOf(item), unitCost, costPrice: purchasePriceOf(item)}` and **merges by `itemId`** if already present.
- Write path: `createServiceJob` (`lib/jobCreation.ts`) builds `jobData` + a draft `invoices` doc (`{jobNumber}-INV`) and fires `safeWriteBatch(job)` + `safeAddDoc(invoice)` in parallel (separate requests on purpose: invoice and job rules allow different roles). Optional extras ride in `extraWrites` (same rules as job) and `alongside` (different rules).
- **Where a Repairs picker slots in:** a new `<RepairPicker>` block in Step 3 above "Services", rendered only when `repairCatalogEnabled && selectedVehicle`. State: `repairs: RepairSelection[]`. On Create, it passes `repairsPerformed` into `createServiceJob` via one new optional param (same pattern as `serviceLines`), and its parts are merged into the existing `partsUsed` state through the existing `addPart` logic, so no parallel parts path exists.
- **The job card can also edit services and parts after creation** (`ServiceDetailPage.saveServices`, `addPart`). If Repairs only exists at creation, repairs can never be added later or fixed. I recommend the same `<RepairPicker>` on the job card (§13-Q6).
- **Role reality:** by default Technician has `jobs.create: false`, Receptionist `jobs.addParts: false`, and **Receptionist can't read inventory at all** (`inventory` rule: `Owner, Manager, Cashier, Technician`). So a Receptionist can add repairs but won't see suggested parts or stock; the part list must degrade quietly rather than error (the cached `loadCatalog` would throw `permission-denied`).

---

## 5. Inventory and the selling-price question

`InventoryItem` (`types/auth.ts:1217`) already has a full price book: `purchasePrice` (cost), `serviceCenterPrice` (**billed on a service-center invoice**), `markedPrice`, `outletPrice`, `distributorPrice`; legacy `unitCost`. `lib/inventoryPricing.ts: serviceCenterPriceOf` = `serviceCenterPrice ?? markedPrice ?? purchasePrice`.

**Resolution: no new selling-price field is needed.** Markup is already supported: `PartUsed.unitPrice` is the item's `serviceCenterPrice` and `PartUsed.costPrice` is the purchase price, both snapshotted at add time, and invoices bill `unitPrice`. Repair-selected parts reuse `addPart` and inherit this for free.

Two caveats worth deciding on:
1. **Silent zero-markup.** If `serviceCenterPrice` and `markedPrice` are unset, the fallback is the *purchase price*, so a part sells at cost with no warning. For flag-on centers I'd add an "No selling price" filter beside "Unclassified" in inventory (§13-Q8, small, additive).
2. **Pre-existing exposure (now its own write-up: `docs/finding-public-job-costprice.md`):** `jobs` are `read: if true` (customer share link), so `partsUsed[].costPrice` (the shop's purchase price) is publicly readable by anyone with a job id. That already exists; repair parts don't make it worse, but a repair shop's markup is exactly what it reveals. Not touching it, but flagging.

**Forms.** `AddEditInventoryPage.tsx` (Owner/Manager only, UI-gated). Payload builder is a flat object where `undefined` becomes `deleteField()` on edit; I'd add `compatibility` inside that payload under a `repairCatalogEnabled` guard, so with the flag off the keys are left exactly as they were (same technique as the warranty fields). `InventoryListPage` holds items from an `onSnapshot` on the whole collection with client-side filters (`categoryFilter`, `statusFilter`), so an "Unclassified" filter is a third client-side filter with zero extra reads.

**Inventory write rules:** Owner/Manager create/update; Technician/Cashier may change only `currentQty, updatedAt`. Adding `compatibility` is therefore Owner/Manager-only automatically.

### Derived "Used for repairs" view — recommendation
**Compute client-side from the cached repair catalog. No denormalized field, no Cloud Function.**
- The catalog is small and bounded; build `Map<inventoryItemId, repairId[]>` once with `useMemo` over the already-loaded catalog (O(total suggestedParts)). The inventory form and list read from it for free.
- A trigger-maintained `usedForRepairIds` would add a function, write amplification (editing one repair rewrites N inventory docs), eventual consistency, and a second place the link lives, which breaks your "ONE side only" requirement.
- Adding/removing a link from the inventory form writes to the **repair doc** (`suggestedParts` via read-modify-write on the cached doc, `safeUpdateDoc`). Concurrent edits to one repair's part list from two devices is last-write-wins on the array; acceptable for a setup screen (§12 risks).

---

## 6. Invoice generation and the repair line

`InvoiceLineItem` (`types/auth.ts:2040`): `type?: "service" | "part"` (absent ⇒ service), plus `itemId?`, `partNumber`, `brand`, `warranty`, `costPrice`, `discount`, `technicianId`, `commissionSnapshot`, hourly fields.

**Three places build line items from a job.**
1. `jobCreation.createServiceJob`: initial draft, from `services/customServices/partsUsed`.
2. `ServiceDetailPage.createDraftInvoice` (L707–762): **on Mark Done it rebuilds `lineItems` from scratch** (then `carryHourlyLine` preserves only the hourly line). Anything not rebuilt here is **dropped when the job completes.**
3. `jobInvoice.billIssuedPartToJob`: appends a part line when an inventory request is approved. Parts only; unaffected.

So repair lines **must be added to #1 and #2** or they vanish at completion. These are the "clearly marked additive hooks" you asked to hear about first (rule 5): one `repairLineItems(job.repairsPerformed)` spread into each list, a no-op when the field is absent. No existing lines change.

**Proposed shape:** `type: "repair"` (new union member) + optional `repairItemId`, rather than reusing `type: "service"`. Why this is the safer choice:
- Every reader that groups with `type !== "part"` (`InvoiceDetailPage` L797, `PublicInvoiceView` L268, print) will render a `repair` line in the **Services group with zero edits**. Nothing breaks, and I can add a "Repairs" sub-heading later as polish.
- Commission excludes it **structurally** (§8).
- `invoiceTotals`, discounts, payments, `RevenueReport` (sums `qty*unitPrice` by description) and `jobProfitability` (revenue = invoice total) are type-agnostic, so repair revenue counts correctly.
- Draft-invoice rule for Receptionist/Technician (`repricesUntouchedDraft`) allows `lineItems` content, so no rules change.

A typed-`"service"` alternative would work, but then a user adding `technicianId` to it in the invoice UI (`NewInvoicePage` shows the technician picker for `type === "service"`) could earn commission. `"repair"` avoids that class of bug entirely.

---

## 7. Stock deduction

`ServiceDetailPage.handleMarkDone` (L865+), **Pro centers only** (`isPro(centerPlan)`): reads each `job.partsUsed[].itemId` in parallel, blocks with a stock-warning modal if `currentQty < quantity`, then `deductParts()` does a per-item read + `safeUpdateDoc(currentQty)` + `logMovement` (best-effort). No transaction. `handleStockWarningConfirm` is the force path.

**Repair-selected parts need no changes** provided they land in `partsUsed` (which is the plan). Notes:
- `addPart` merges by `itemId`, so a part suggested by two repairs becomes one row with summed qty. Deduction is correct either way.
- Parts aren't attributed to a repair in `partsUsed`; unticking a repair later won't remove its parts. I'd store `partItemIds` on the `repairsPerformed` entry **for display grouping only**, with no effect on deduction (§13-Q7).
- Rules: Technician/Cashier may update only `currentQty`/`updatedAt`; unchanged.

---

## 8. Commission — how repair lines are guaranteed excluded

Two paths, both verified in `functions/index.js`:
- `onJobCompleted` (L1938): reads **only `job.serviceLines`**. `repairsPerformed` is a separate field and never enters `serviceLines`, so it cannot be paid. A job with no `serviceLines` exits on the first guard.
- `onInvoiceCommission` (L2143): processes lines where `line.type === "service" && line.technicianId` (`invoiceCommissionLines`, L2095) and **skips any invoice that belongs to a job** (`serviceId`). A `type: "repair"` line fails the strict equality.

Client side, `previewJobCommissions` / `previewLineCommissions` iterate `serviceLines` / given lines, so repairs aren't in them either.

**Guarantee = structural, not a flag.** I'll lock it with tests: (a) a Node `--test` unit test on the pure helpers; (b) a functions test with fixtures proving `invoiceCommissionLines` returns nothing for a repair line even with `technicianId` set. Note the repo's `npm test` only runs `src/**/*.test.ts`; `tests/functions` and `tests/rules` are separate emulator-style suites, so I'll add to those following their conventions.

---

## 9. Admin panel and the flag

- The admin app is the same SPA under `/admin/*` (`App.tsx:430`, `AdminApp`), not a separate hostname build; nothing distinguishes `admin.pitstopiq.com` in code.
- `ServiceCenterDetailPage.tsx` (1449 lines) has the right neighbours (plan switch `changePlan`, block/restore, renewal) and uses `safeUpdateDoc(doc(db,"servicecenters",id), {...})` with local `setCenter` mirroring. A "Repair Catalog" card there is a one-write change.
- Super admin can already write any center field: `allow update: if isSuperAdmin() || (Owner/Manager && ... deny-list)`.
- **Making it super-admin-only:** the center update rule is a **deny-list** for Owner/Manager (`firestore.rules:91`). I add `repairCatalogEnabled`, `repairCatalogToggledAt`, `repairCatalogToggledBy`, `repairCatalogToggledByName` to that list. That's all of non-negotiable #2 for updates.
- **A gap on create:** `allow create: if request.auth.uid == centerId || isSuperAdmin()` has no field restriction, so a signed-in owner could create their own center doc with `repairCatalogEnabled: true` directly via the SDK. Registration normally goes through the `registerServiceCenter` callable (Admin SDK), but the rule permits it. I'd add a create-time guard (`!('repairCatalogEnabled' in request.resource.data) || isSuperAdmin()`). It's additive and only affects that one key.
- **"Log who toggled and when":** the center `auditLog` create rule requires `hasRole(...)` (a staff member), and a super admin isn't one, so it can't write there. Options (§13-Q5): (a) fields on the center doc plus (b) an append-only top-level `adminActionLog` collection (super-admin create/read only, no update/delete). I recommend both: the fields give the current state at a glance, the log gives history.
- Center-side read: `useWorkshopModules` already live-watches the center doc for flags; `repairCatalogEnabled` is one more field on its existing single listener (0 extra reads). `Navbar` and `CommandPalette` already consume it and `navItems` supports `module:` gating (`bays | commission | inspectionReports`), so a `repairCatalog` module key is a type + one line each. (There's also a second cached-gate pattern, `useInspectionReportsEnabled`, which I won't copy.)
- Turning it off: UI hides everything; no code deletes data.

---

## 10. Role Permission Manager

- `types/permissions.ts` `RolePermissions` is a flat object of sections → boolean fields. Add `repairCatalog: { view, create, edit, delete, manageModels }`.
- `lib/defaultPermissions.ts`: four per-role default grids plus `LOCKED_OFF`. `mergeWithDefaults` iterates the *defaults'* sections, so a stored `settings/rolePermissions` doc that predates the section still resolves from defaults. **Adding a group is safe for existing centers.** Owner is implicit-all.
- Touch points: `types/permissions.ts`, `defaultPermissions.ts` (×4 roles, plus `LOCKED_OFF` for Technician/Cashier/Receptionist `create/edit/delete/manageModels` so an owner can't hand out what the rules deny), `RolePermissionsPage.tsx` (label list), `CustomRolesPage.tsx` (same grid), i18n `en/si/ta` (`settings.permissions.*`), `navItems.ts`.
- Your defaults are straightforward: Owner all; Manager all; Technician, Cashier, Receptionist view only.
- **Rules mirror:** `servicePrices`, `bays`, `departments` mirror at the *base-role* level (`hasRole(Owner, Manager)` to write; `isMember` to read); the granular grid is UI-only for those. A granular rules mirror exists as a precedent (`timerPermissionGranted`, jobs rule) but costs 2–3 `get()` calls per write. For a setup collection written rarely that's affordable. §13-Q3.

---

## 11. Customer portal / invoice display / PDF

- Portal = `/c/:centerId/:customerId` (`PublicCustomerView.tsx`, 1096 lines), unauthenticated, loads customer/vehicles/jobs/invoices with `getDocsWithRetry`. Service History shows `[...services, ...customServices]` names only (L973). **Repairs would not appear there unless I add a line**; trivial and additive (render `repairsPerformed[].name` when present).
- Invoice view `PublicInvoiceView.tsx` (`/c/.../invoice/:id`) and the shop's `InvoiceDetailPage` both group `type !== "part"` as Services. Repairs show up there with no change; an explicit "Repairs" sub-heading is optional polish. PDF = browser print (`usePrintDocument`, `printPaper.ts` roll/A4); there is no server-side PDF. So "PDF shows repair lines" falls out of the print markup above.
- `isHourlyLine` and warranty tables key on other fields and don't interfere.

---

## 12. Security rules structure (center-scoped)

Each sub-collection is its own `match` under `servicecenters/{centerId}`; helpers `isSuperAdmin()`, `isMember(c)`, `hasRole(c, [...])` (reads `staff/{uid}.role`; roles are `Owner|Manager|Technician|Cashier|Receptionist`; custom roles only change the UI grid, rules see the base role). Default is deny.

**New collections** (`vehicleModels`, `vehicleGroups`, `repairCatalog`, and a small `repairCategories` list, or a center-doc array; see Q2): `read: isSuperAdmin() || isMember(centerId)`; `write: hasRole(Owner, Manager)` (mirrors `servicePrices`). Receptionist/Technician/Cashier read-only, which matches your defaults.

**Existing rules that need no change:** `jobs` update has no field whitelist for Owner/Manager/Receptionist/Technician (so `repairsPerformed` and `modelId` writes work), and Cashier is whitelisted to `partsUsed, internalNotes, status, deliveredAt, updatedAt` (so a cashier can't add repairs, as intended). `vehicles` update covers `modelId`. `inventory` covers `compatibility` (Owner/Manager).

**Rules that do change:** the center-doc deny-list and create guard (§9), plus the new `match` blocks. If you choose a flag-gated create rule like `diagnosticReports` has, it needs a `get()` of the center doc per write. Not recommended here (flag-off data is inert and Owner/Manager-only).

### Indexes
**None required.** Catalogs are read by one-time whole-collection fetch and filtered on the device (no `where` + `orderBy` combos), sorted client-side like `refData.ts` already does. Optional: a collection-group index is not needed either. (The existing app already has missing-index fallbacks in places; I'm deliberately not adding queries that need one.)

---

## 13. Decisions needed from you

| # | Question | My recommendation |
|---|---|---|
| **Q1** | **Tie-break** when a vehicle's model sits in several groups that each override price/qty (the brief asks me to propose). | Add an integer `priority` to each group (lower wins; defaults to creation order; reorderable by drag/up-down). Resolution: model → group by priority → type → default. The job shows *where* the price came from (`resolvedFrom`). "Lowest price" is tempting but silently undercharges; "first by creation order" is invisible. I'd also warn in the catalog editor when one item has overrides on two overlapping groups. |
| **Q2** | **Categories:** owner-defined list. Where? | A `repairCategories: string[]` on the **center doc** (like `customInventoryCategories`). No new collection. Seed the 9 library categories as suggestions. |
| **Q3** | **Rules granularity** for `repairCatalog.*` permissions. | Base-role (Owner/Manager write) like `servicePrices`, with the permission grid enforced in UI. Granular `get()`-based rules cost 2–3 reads per write; say if you want them anyway. |
| **Q4** | **Price on a job:** library re-resolves each sync; repairs? | Freeze `repairsPerformed[].price` (resolved at pick time, editable), invoice uses the snapshot. |
| **Q5** | **Who/when audit** for the toggle (a super admin can't write the center `auditLog`). | Fields on the center doc (`repairCatalogToggledAt/By/ByName`) **plus** an append-only top-level `adminActionLog` (super-admin create/read only). |
| **Q6** | **Job card:** also add/edit repairs after creation? | Yes, same `<RepairPicker>` on `ServiceDetailPage`; otherwise a repair forgotten at intake can never be added. Costs another hook into `saveServices`-style code on that 2.5k-line page. |
| **Q7** | **Removing a repair** after its parts were added. | Don't auto-remove parts (could delete a part already handed to the customer). Keep `partItemIds` on the repair entry for grouping only. |
| **Q8** | **Extra inventory filter** "No selling price" next to "Unclassified" (§5). | Yes, since a missing selling price silently sells at cost. |

Smaller calls I'll make unless you object:
- **Type matching** in `appliesTo.types` / `priceOverrides` normalises with `trim().toLowerCase()`. The service library is exact-match, so I'd diverge deliberately to survive "Motor Bike" vs "motor bike". Stored `scopeId` keeps the original text.
- **Group membership** lives on the group (`modelIds[]`, `types[]`), not on the model, so a model needn't be rewritten when groups change. "Groups of model X" is derived from the cached groups list.
- **Vehicles with no `modelId`** only match `appliesTo.all` and their `types` entry (and a group's `types[]`). They never match models or model-only groups; no fuzzy text matching at resolve time.
- Jobs get a snapshotted `modelId` next to `make/model/vehicleType`.

---

## 14. Read-cost and offline design

- New collections load via `cachedFetch` / `boundedGetDocs` in a new `lib/repairData.ts`, registered in the ref-cache (`REF_COLLECTIONS`) so every write through `firestoreWrite.ts` invalidates it automatically, with 10-minute TTL like `vehicles`. **No `onSnapshot` on any new collection.**
- The persistent IndexedDB cache is already configured (`config/firebase.ts`, `persistentLocalCache`), so offline reads fall back via `boundedGetDocs`.
- Filtering/resolution is pure functions over in-memory arrays, memoised once per catalog load (the repo's documented fix for the tablet freeze).
- Flag-off cost: **zero** reads and zero listeners. The flag comes off the center-doc listener `useWorkshopModules` already holds open, and every new fetch is behind `if (repairCatalogEnabled)`.
- Writes: only `safeSetDoc/safeUpdateDoc/safeAddDoc/safeWriteBatch`. No `runTransaction`. Arrays updated with whole-array replace or `arrayUnion/arrayRemove` where the element is a primitive; `suggestedParts`/`priceOverrides` are object arrays so they're replace-the-array (last-write-wins; acceptable for setup screens, noted as a risk).

### Risks I want you aware of
1. `createDraftInvoice` rebuilds lines from scratch, so the repair hook there is **mandatory** (§6).
2. Last-write-wins on `suggestedParts` if two devices edit the same repair.
3. Receptionist can't read inventory, so suggested-parts UI degrades for them.
4. Public job docs expose `partsUsed[].costPrice` (pre-existing).
5. `NewServicePage` (1.7k lines) and `ServiceDetailPage` (2.5k lines) are large; I'll keep changes to isolated components plus minimal insertion points to keep review diffs small.

---

## 15. Proposed file / folder plan

**New**
```
src/types/repairCatalog.ts              VehicleModel, VehicleGroup, RepairItem, RepairPerformed, AppliesTo, ...
src/constants/repairCatalog.ts          default categories, flag/permission keys, CSV template headers
src/lib/repairCatalog/
  data.ts            cached fetchers (vehicleModels, vehicleGroups, repairCatalog), invalidation
  applicability.ts   appliesTo(vehicle, repair), group membership, "show all" fallback
  pricing.ts         resolvePrice / resolvePartQty (model > group[priority] > type > default) + resolvedFrom
  partsIndex.ts      inverted itemId -> repairIds map (derived "Used for repairs")
  invoiceLines.ts    repairLineItems(job)  <- the additive invoice hook
  linking.ts         suggest modelId for existing vehicles (never automatic)
  csv.ts             template, parse, validate, error report (Phase 8)
  *.test.ts          pure-function tests (node --test)
src/hooks/useRepairCatalog.ts           gated loader (returns empties when flag off)
src/components/repairCatalog/           RepairPicker, RepairPartsPanel, ModelPicker, AddModelDialog, ...
src/pages/repairCatalog/                RepairCatalogPage, RepairEditorPage, ModelsAndGroupsPage, ImportExportPage
src/pages/admin/ (edit)                 Repair Catalog card in ServiceCenterDetailPage
tests/rules/repairCatalog.rules.test.mjs
tests/functions/commissionRepairExclusion.test.mjs
```

**Edited (all additive, flag-guarded)**
`firestore.rules` (deny-list + create guard + 3 new matches), `types/auth.ts` (flag, `repairsPerformed`, `modelId`, `compatibility`, line `type: "repair"`, `repairItemId`), `types/permissions.ts`, `lib/defaultPermissions.ts`, `RolePermissionsPage.tsx`, `CustomRolesPage.tsx`, `lib/navItems.ts`, `Navbar.tsx`, `CommandPalette.tsx`, `hooks/useWorkshopModules.ts`, `lib/refData.ts` (register keys), `App.tsx` (routes), `AddVehiclePage.tsx` (model picker), `AddEditInventoryPage.tsx` + `InventoryListPage.tsx` (compatibility + filters), `NewServicePage.tsx` + `ServiceDetailPage.tsx` (picker), `lib/jobCreation.ts` + `createDraftInvoice` (**the two reported hooks**), `PublicCustomerView.tsx` (history line), locales `en/si/ta`.

**Hooks needing your sign-off before Phase 7 (rule 5):**
1. `jobCreation.createServiceJob`: spread `repairLineItems()` into the initial draft invoice lines.
2. `ServiceDetailPage.createDraftInvoice`: same spread when rebuilding lines on Done.
3. `NewServicePage` / `ServiceDetailPage`: passing `repairsPerformed` and merging suggested parts into `partsUsed` via the existing `addPart`.

None touches commission logic, `serviceLines`, `deductParts` or `handleMarkDone`.

---

## 16. Proposed phase checkpoints
Unchanged from your list. For Phase 2 specifically I'll deliver: flag + admin card + `adminActionLog` (if Q5 approved), types, rules + rules tests, permission group (all five touch points + i18n), nav/module wiring. With the flag off, the staging check is: no nav item, no new reads (Network tab / Firestore usage), and an Owner SDK write of `repairCatalogEnabled` is denied.

---

## 17. Decisions (approved)

Q1–Q8 approved as recommended, with these notes: **Q1** group `priority` (lower wins), the job screen must show where the price came from, never auto-pick the lowest. **Q3** reads on `repairCatalog`/`vehicleModels`/`vehicleGroups` open to every staff member (Receptionist included), writes Owner/Manager; inventory read access NOT widened, so roles that can't read inventory see repairs but not the suggested-parts section. **Q4** price frozen at pick time and user-overridable. **Q5** center-doc fields plus append-only `adminActionLog`. **Q6** picker on the job card too, and an added repair must survive `createDraftInvoice`'s rebuild at Done. **Q7** removing a repair never removes parts.

Hooks approved (`createServiceJob`, `createDraftInvoice`, picker wiring) on the conditions that they are no-ops when the flag is off or `repairsPerformed` is empty, with a regression test proving identical invoice output for jobs without repairs. Center create rule: narrow guard on `repairCatalogEnabled` only. The public `costPrice` exposure is left alone and written up in `docs/finding-public-job-costprice.md`.
