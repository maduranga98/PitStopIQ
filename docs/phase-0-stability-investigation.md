# Phase 0 — Stability investigation (no code changes)

Scope: read-only audit of `maduranga98/PitStopIQ` at `b858beb` against the eight
hypotheses (A–H) in the remediation brief.

**Headline: most of this plan has already been built.** Between roughly commit
`0928532` and `86b970f` this codebase went through a sustained non-blocking-write,
bounded-read and cache-hardening campaign. Five of the eight hypotheses are
already fixed in `main`, and **two of the prescribed Phase 4 changes would
actively re-introduce bugs that were deliberately fixed** (see §4). Please read
§4 and §9 before approving anything.

I could **not** run the production audit half of 0.2 — this container has no
Firebase service-account credentials, no `firebase` CLI and no `gcloud` (verified:
`which firebase gcloud` empty, no `GOOGLE_APPLICATION_CREDENTIALS`, no
`~/.config/firebase`). Everything below is static analysis. The production counts
you asked for in 0.2 are listed as a deliverable I still owe you, with the script
to produce them proposed in Phase 2.

---

## Verdict table

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| A | Writes are `await`ed, promises resolve on server ack | **Refuted — already fixed** | `src/lib/firestoreWrite.ts:1–110` |
| B | Login and provisioning normalise phones differently | **Mostly refuted; two narrow divergences real** | `src/lib/phone.ts:22`, `functions/index.js:200` |
| C | Firestore cache keyed by project not user → cross-owner leak | **Refuted as stated; a smaller real leak exists** | `src/lib/refCache.ts`, `src/contexts/AuthContext.tsx:693–701` |
| D | Listeners not torn down → leak and keep firing | **Largely refuted (1/101 leaks); error handling is the real gap** | 101 call sites, 21 with no error callback |
| E | Custom claims go stale | **Refuted — there are no custom claims at all** | `functions/index.js` has zero `setCustomUserClaims` |
| F | `persistentMultipleTabManager` deadlocks | **Refuted — already replaced, in the direction you propose** | `src/config/firebase.ts:81–108` |
| G | Startup cache warming pre-fetches whole collections | **Refuted — `useCacheWarming` was deleted** | `src/config/firebase.ts:50–54` |
| H | Missing composite indexes | **Confirmed — 7 missing** | §5.3 |

Plus **five additional faults** not in your list (§6), two of which I rate above
several of A–H on customer impact.

---

## 0.1 Writes (hypothesis A) — REFUTED, already fixed

### Awaited raw writes

`grep -rnE "await (addDoc|setDoc|updateDoc|deleteDoc|writeBatch)" src/` returns
**11 hits, not the dozens the hypothesis assumes**:

| File:line | Blocks UI? | Assessment |
|---|---|---|
| `src/contexts/PermissionsContext.tsx:138` | Yes (save button) | Settings-only, rare, admin at a desk. Low priority. |
| `src/contexts/PermissionsContext.tsx:145` | Yes | Same. |
| `src/lib/pushNotifications.ts:68` | No — fire-and-forget at startup | Fine as is. |
| `src/lib/photoUploadQueue.ts:87` | No — background queue worker | **Must stay awaited**; it is the queue's own sequencing. |
| `src/lib/outletsPos.ts:59` | Yes | Outlet link creation, Business-tier only. |
| `src/lib/auditLog.ts:25` | No — callers use `void logAuditEvent(...)` | Fine. |
| `src/lib/inventoryMovements.ts:40` | Partly | Sits inside stock-adjust flows. |
| `src/lib/departments.ts:71` | Yes | `writeBatch` — see §6.2. |
| `src/lib/distributors.ts:67` | Yes | Portal link creation. |
| `src/lib/shortLinks.ts:67` | Yes | Blocks the "send invoice SMS" button. |
| `src/pages/departments/DepartmentsPage.tsx:85` | Yes | `writeBatch` — see §6.2. |

Everything on the hot paths — job creation, invoice creation, payments, stock,
checklists, signatures — already routes through `safeAddDoc` / `safeSetDoc` /
`safeUpdateDoc` / `safeDeleteDoc`.

### `safeUpdateDoc` and friends — full behaviour

`src/lib/firestoreWrite.ts`. Signature at `:83`; the family is `safeSetDoc:73`,
`safeUpdateDoc:83`, `safeAddDoc:92`, `safeDeleteDoc:104`.

The module already implements essentially the whole Phase 1 brief:

- **`localFirst()` (`:53`)** — if `navigator.onLine` is false, resolve
  *immediately* with the local result. If online, race the server ack against an
  `ACK_TIMEOUT_MS = 8000` (`:33`) timer and resolve on whichever wins, so a
  flaky connection cannot hang the UI. A server *rejection* still rejects, so
  rules violations surface.
- **`safeAddDoc` (`:92–102`)** already does exactly your `createDoc` spec:
  generates the ID client-side with `doc(reference)` and `setDoc`s it, so the ref
  is available synchronously.
- **Pending-write counter with subscribe** already exists:
  `trackServerAck` (`:35`) calls `increment()` / `decrement()` on
  `usePendingWritesStore` (`src/store/pendingWritesSlice.ts`), consumed by
  `src/hooks/usePendingWrites.ts`.
- **Cache invalidation on write** — `invalidateRefDataForPath(path)` fires twice
  (once immediately, once on ack) so a write is visible to the next reader.

**What is missing from your Phase 1 spec:** a *failure handler registration
point routed to a toast*. Today a server rejection is only `console.error`'d
(`:44–46`). The owner is never told a write was refused. That is a real gap and
the single most valuable part of Phase 1 still to build.

### Invoice number counter — NOT a transaction

You asked me to flag it if it were. It is not.

- Job numbers: `src/lib/jobCreation.ts:17–52` (`generateJobNumber`).
- Invoice numbers: `src/pages/services/ServiceDetailPage.tsx:651–672` and
  `src/pages/invoices/NewInvoicePage.tsx:231`.

The pattern everywhere is *read the highest existing number in the month's
prefix range with `limit(1)`, parse, `+1`*, through `boundedGetDocs`. No
`runTransaction`. The format is `INV-YYYY-MM-NNNN` and `YYYY-MM-NNNN`, **not**
`PIQ-YYYY-NNNN` as the brief states.

**But it has a real correctness bug** — see §6.1. It is not an offline *hang*;
it is an offline/concurrent *collision*. Different bug, still worth fixing.

### `runTransaction` in client code — ONE violation of your constraint #1

`src/lib/postServiceChecklist.ts:274`, inside `saveTemplate`. The author knew and
documented the trade at `:267–272`: enforcing "only one default checklist
template" across two devices. It fails loudly offline rather than hanging
silently, and it is on a settings screen an Owner touches a few times a year —
so it is the least harmful possible placement. It still violates the constraint
as written. Flagging it for your call; I would leave it.

(`functions/index.js:806, 2317, 2861` are server-side `runTransaction`s. Those
are correct and out of scope.)

### Spinners keyed to promise resolution

`src/pages/services/NewServicePage.tsx:117, 477, 1437` — `saving` state,
`{saving ? "Creating…" : "Create Job"}`. Because the underlying write is
`safeAddDoc`, this resolves immediately offline and within 8s online. The
"Creating… hangs forever" symptom therefore **cannot** come from the write any
more. It can still come from the *read* in front of it — which is why
`generateJobNumber` was wrapped in `boundedGetDocs` (`jobCreation.ts:34`, with a
comment naming exactly this symptom). Both halves are already closed.

---

## 0.2 Provisioning and login (hypothesis B) — mostly refuted

**There is no `provision.js` in this repository.** Provisioning is
`exports.registerServiceCenter`, a callable Cloud Function at
`functions/index.js:230–434`, driven from
`src/pages/admin/RegisterServiceCenterPage.tsx`.

### The two normalisers, quoted

**Client** — `src/lib/phone.ts:22–28`:

```js
export function normaliseLocalPhone(raw: string): string | null {
  const s = String(raw ?? "").trim().replace(/[\s\-().]/g, "").replace(/^\+/, "");
  if (/^94\d{9}$/.test(s)) return s.slice(2);
  if (/^0\d{9}$/.test(s)) return s.slice(1);
  if (/^\d{9}$/.test(s)) return s;
  return null;
}
```

**Server** — `functions/index.js:200–206`:

```js
function normalisePhone(raw) {
  const s = String(raw || "").replace(/[\s\-()+]/g, "");
  if (/^94\d{9}$/.test(s)) return s.slice(2);
  if (/^0\d{9}$/.test(s)) return s.slice(1);
  if (/^\d{9}$/.test(s)) return s;
  return null;
}
```

Both then build `${local}@pitstopiq.app` (client `phone.ts:43`, server
`index.js` at the `loginEmail` construction and `checkLoginAccount:828`).

### The four formats you asked about

| Input | Client | Server | Match? |
|---|---|---|---|
| `0771234567` | `771234567` | `771234567` | ✅ |
| `771234567` | `771234567` | `771234567` | ✅ |
| `94771234567` | `771234567` | `771234567` | ✅ |
| `+94771234567` | `771234567` | `771234567` | ✅ |

**All four agree.** Hypothesis B does not explain bug 4 for these inputs.

### Where they genuinely diverge

Three real differences, all at the edges:

1. **Dots.** Client strips `.`, server does not. `077.123.4567` → client
   `771234567`, server `null`.
2. **Non-leading `+`.** Server strips `+` anywhere; client only strips a leading
   one. `94+771234567` → server `771234567`, client `null`.
3. **`0094…` is rejected by both.** Your Phase 2 spec requires it; neither
   implementation handles it today. So an owner whose number was recorded as
   `0094771234567` was never provisioned at all.
4. **`trim()`** — client trims, server relies on the character class. Equivalent
   in practice (`\s` covers it), no divergence.

None of these is *nothing*, but none is the "high confidence" cause of
intermittent owner login failure. **I think bug 4 has a different cause — see
§6.3, which I rate as the actual explanation.**

Your Phase 2 item 1 (one shared normaliser) is still worth doing: two copies of
a regex that must agree, in two deploy units, already drifted three ways.

### Password alphabet

`src/pages/admin/RegisterServiceCenterPage.tsx:30`:

```js
const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#";
```

Excluded: `I O l o 0 1`. **Still present: `5`, `S`, `8`, `B`** — four of the nine
characters you listed. Over a WhatsApp message read aloud to a mechanic, `5`/`S`
and `8`/`B` are exactly the confusable pairs. Small fix, real support-call
reduction.

Note the password is generated **in the browser** and passed into the callable
(`index.js:240`), not generated server-side.

### Verification after write, and idempotency

`registerServiceCenter` does **not** read back what it wrote before returning the
credentials (`index.js:434`: `return { success: true, centerId, ownerUid, loginEmail, password }`).
It writes the Auth user, the `servicecenters/{centerId}` doc, the owner `staff`
record and the `users/{uid}` index, then returns. If any write after the Auth
user creation fails, the super admin has already been shown working-looking
credentials for an account that cannot resolve a profile.

**This is the most credible mechanism for bug 4 that I found, and it is not
hypothesis B.** See §6.3.

Idempotency on re-run: not verified statically with confidence — it depends on
`getUserByEmail` handling I did not fully trace. Treat as **unknown**, to be
confirmed in Phase 2.

### Production audit — OWED, NOT RUN

Cannot execute without credentials. The four counts you asked for
(mismatched Auth emails, missing/inconsistent claims, `claims.plan` vs
`doc.plan`, missing `servicecenters` docs) need `audit-all-accounts.js` from
Phase 2 item 4. **Note the claims-related two of those four are moot — see §0.3.**

---

## 0.3 Listeners and session (C, D, E)

### Counts

- `grep -rn "onSnapshot" src/ | wc -l` → **163** (includes imports).
- Actual **call sites: 101** (AST-ish scan, excluding import lines).
- **With an error callback: 80.** **Without: 21.**

The 21 with no error callback:

```
src/pages/attendance/AttendancePage.tsx:101      src/pages/dashboard/DashboardPage.tsx:232
src/pages/quotations/QuotationListPage.tsx:59    src/pages/dashboard/DashboardPage.tsx:245
src/pages/employees/AddEditEmployeePage.tsx:109  src/pages/dashboard/DashboardPage.tsx:264
src/pages/employees/EmployeeDetailPage.tsx:93    src/pages/dashboard/DashboardPage.tsx:276
src/pages/services/ServicesPage.tsx:116          src/pages/dashboard/DashboardPage.tsx:293
src/pages/invoices/InvoiceListPage.tsx:98        src/pages/dashboard/DashboardPage.tsx:311
src/pages/sms/SmsLogPage.tsx:59                  src/pages/dashboard/DashboardPage.tsx:356
src/pages/customers/CustomerDetailPage.tsx:123   src/pages/vehicles/VehicleListPage.tsx:55
src/pages/customers/CustomerDetailPage.tsx:146   src/pages/customers/CustomerListPage.tsx:161
src/pages/customers/CustomerDetailPage.tsx:179   src/pages/settings/SettingsPage.tsx:159
src/pages/accounting/AccountingPage.tsx:92
```

`DashboardPage` alone accounts for 7 — and the dashboard is the first screen
every owner sees. **This is the real listener problem, not leakage.** An
`onSnapshot` with no error callback whose query is denied throws into the SDK's
internal async queue, which is precisely the un-catchable path that
`src/main.tsx:42–43` exists to mop up. At sign-out, rules stop matching before
React unmounts the route, so these fire `permission-denied` at exactly the
moment the brief describes as bug 2.

### Unsubscribe on unmount

Scan of every `useEffect` containing `onSnapshot`: **exactly one** lacks a
visible cleanup — `src/pages/settings/SettingsPage.tsx:1244`, which does
`const staffUnsub = onSnapshot(...); return staffUnsub;` and is in fact correct
(my heuristic's false positive). **Effective leak rate: 0/101.**
Hypothesis D's "listeners are not torn down" is **refuted**. The house style is
`return onSnapshot(...)` or `return () => { a(); b(); }` and it is applied
consistently.

### Sign-out path

`src/contexts/AuthContext.tsx:693–701` (`logout`):

```js
pendingSignOutIssue.current = null;
setAuthIssue(null);
clearRefCache();          // drops the TTL reference cache
await signOut(auth);
```

So: **listeners are not explicitly cleared** (they unmount via routing, racily),
the **Firestore IndexedDB cache is NOT cleared**, and there is **no hard
reload**. `clearRefCache()` handles the app-level cache only.

This is the honest version of hypothesis C. The claim as written — "the cache is
keyed by project not user, so one owner's data survives into the next owner's
session" — is **not** how it plays out, because Firestore's persistent cache is
gated by security rules on every re-read: owner B cannot read owner A's cached
docs, the reads are simply denied. What actually happens is the **denial storm**
(21 error-callback-less listeners × a router that has not unmounted them yet),
not data leakage. The user-visible symptom is the same; the fix is different.
Your Phase 3 spec (`signOutSafely` with terminate → clear → `location.replace`)
is the right fix for the right reason — I would just not describe it as a data
leak in the PR.

### ErrorBoundary

**Exists**: `src/components/ErrorBoundary.tsx`, and it is sophisticated. It
special-cases stale-deploy chunk failures (`isChunkLoadError:13`) and Firestore
IndexedDB corruption (`isFirestoreCacheCorruption:30`), shares a one-shot
`sessionStorage` recovery guard with `src/main.tsx:20`, and offers a
"Fix & Reload". A thrown render error today shows a real recovery screen, **not**
white.

What it does **not** have, from your Phase 3 item 4: no statement that saved work
is safe, and **no short reference code for WhatsApp 071 110 0800**. Those are
genuinely missing and cheap to add.

`src/main.tsx:43` already registers a global `unhandledrejection` handler — but
it *only* handles cache corruption (`recoverOnce` returns early for anything
else). Your Phase 3 item 5's "swallow benign auth codes, log the rest" is not
there.

### Custom claims — hypothesis E is REFUTED outright

`grep -rn "setCustomUserClaims\|customClaims" functions/index.js src/` returns
**zero matches**. There are no custom claims anywhere in this system.

`src/contexts/AuthContext.tsx:343–346` documents the removal explicitly:

> "The old `getIdTokenResult()` custom-claims lookup was removed — functions/index.js
> never sets any claims, so it was a guaranteed-empty round trip on every sign-in."

Identity resolves from two Firestore reads in parallel: `users/{uid}` and the
legacy `servicecenters/{uid}`. `plan` is read from the center document, so a plan
change is picked up on the next read — **there is no stale-claim window to close.**

Consequences for your plan:
- **Phase 2 item 5** (`getIdToken(true)` after sign-in) — pointless. Deleting a
  claims round trip was a deliberate sign-in speed-up (commit `d648e47`, "Cut
  sign-in from four network round-trips to two"). Re-adding it undoes that.
- **Phase 3 item 7** (claim refresh on foreground) — pointless for the same reason.
- **Phase 3 acceptance criterion** "change a plan in admin, reopen the owner's
  phone: new tier active without re-login" — this should *already* pass. Worth
  testing on staging before building anything; if it fails, the cause is the
  `serviceCenter` doc listener, not claims.
- **Two of the four production-audit counts in 0.2** (claims consistency,
  `claims.plan` vs `doc.plan`) have no data to count.

---

## 0.4 Firestore init (hypothesis F) — REFUTED, and Phase 4 would regress it

`src/config/firebase.ts:81–108`, verbatim:

```ts
const baseSettings: FirestoreSettings = {
  experimentalForceLongPolling: true,
};

function createDb() {
  try {
    return initializeFirestore(app, {
      ...baseSettings,
      localCache: persistentLocalCache({
        tabManager: persistentSingleTabManager({ forceOwnership: true }),
      }),
    });
  } catch (err) {
    console.warn(
      "[firestore] IndexedDB persistence unavailable, falling back to an " +
      "in-memory cache. Reads will not be deduplicated across reloads.",
      err,
    );
    return initializeFirestore(app, {
      ...baseSettings,
      localCache: memoryLocalCache(),
    });
  }
}
```

Point by point against your Phase 4:

| Phase 4 item | Status |
|---|---|
| 1. Replace multi-tab with `persistentSingleTabManager` | **Already done.** The multi-tab "Failed to obtain primary lease" hang is fixed and documented at `:56–63`. |
| 1. `{ forceOwnership: false }` | **Would regress.** Current value is `true`, deliberately — `:65–70` explains that with `false` a killed background tab's leftover exclusive lock makes a fresh session *silently degrade to memory cache*, restoring the read amplification. **Do not flip this.** |
| 2. `try`/`catch` → `memoryLocalCache()` | **Already done** (`:97–107`). |
| 2. Banner when persistence is unavailable | **Missing.** Only a `console.warn`. Genuinely worth building. |
| 3. `experimentalAutoDetectLongPolling: true` | **Would regress.** `:72–80` records that auto-detect's probe *itself stalls for minutes* on Sri Lankan carrier proxies — "the login spinner hanging on mobile and then dumping the user back to /login". `experimentalForceLongPolling` was chosen to skip the probe. **Do not flip this.** |
| 4. Foreground watchdog | **Missing.** No `visibilitychange` handler anywhere in `src/`. Worth building (minus the claim-refresh half, which is moot — §0.3). |
| 5. `pageshow.persisted` bfcache reload | **Missing.** No `pageshow` handler. Worth building. |

Also present and relevant: `recoverFromCorruptedCache()` (`:127–161`) tears down
and rebuilds the IndexedDB cache when the SDK throws its internal assertion — the
exact failure `forceOwnership: true` can provoke. The two were designed as a pair.
Changing one without the other is not safe.

---

## 0.5 Performance (G, H)

### Startup cache warming — hypothesis G is REFUTED

`useCacheWarming` **no longer exists**. `src/config/firebase.ts:50–54`:

> "persistence was previously removed (commit fda88a7) to fix slow app loads. The
> actual cause of that slowness was the useCacheWarming hook, which eagerly
> pre-fetched ~2,600 documents into IndexedDB on every login. That hook is gone
> and is NOT coming back."

What exists instead is `src/hooks/useAfterStartup.ts` — a
`requestIdleCallback` gate with a 2500 ms ceiling — used by `DashboardPage:191`,
`Navbar:149` and `NotificationsBell:43` to hold non-critical subscriptions until
after first paint. That is your Phase 5 item 1's "run after first paint",
already built and already bounded.

Phase 5 item 1 as written would be a **step backwards**: it asks to warm service
library + open jobs + inventory at startup. The codebase deliberately warms
*nothing*, and `DashboardPage:326–348` explicitly converted the inventory read
from a live listener to a one-shot cached `fetchInventory`. I would drop item 1.

### Queries without `limit()`

**125 of 147 query constructions have no `limit()`.** Full list captured in the
session; the ones that matter, ranked:

1. **`src/pages/vehicles/VehicleListPage.tsx:52`** — whole `vehicles` collection,
   live `onSnapshot`, no limit, no error callback, then filtered in JS. For a
   centre with 4,000 vehicles this is the single worst read in the app.
2. **`src/pages/customers/CustomerListPage.tsx`** — same shape for customers.
3. **`src/pages/dashboard/DashboardPage.tsx:228`** — today's jobs, unbounded.
4. **`src/pages/dashboard/DashboardPage.tsx:289`** — `where("creditTotal", ">", 0)`
   unbounded; grows monotonically with billing history.
5. **`src/lib/analyticsData.ts:66–177`** — nine date-range reads, no limits. These
   are report screens, so arguably correct, but they are also the reads that make
   a long-lived centre feel slow.
6. **`src/pages/reports/DailyReportPage.tsx:110–117`** — five unbounded reads.

Note the good counter-example already in place:
`DashboardPage:305–310` uses `where("dueForService", "==", true)` **with
`limit(200)`** — the `maintainVehicleDueFlag` pattern you told me to extend.

### Missing composite indexes — hypothesis H CONFIRMED

Cross-referencing every equality+range / equality+orderBy-on-another-field query
against `firestore.indexes.json` (11 indexes, 1 field override). Equality-only
conjunctions are excluded — Firestore serves those from single-field indexes.

**Missing:**

| Collection | Fields needed | Used by |
|---|---|---|
| `invoices` | `status` ASC, `createdAt` ASC | `src/lib/analyticsData.ts:104`, `:118` |
| `smsLogs` | `customerId` ASC, `sentAt` DESC | `src/pages/customers/CustomerDetailPage.tsx:174` |
| `storeAddonRequests` | `centerId` ASC, `createdAt` DESC | `src/pages/settings/SettingsPage.tsx:1804` |
| `smsPackageRequests` | `centerId` ASC, `createdAt` DESC | `SettingsPage.tsx:1814` |
| `branchRequests` | `centerId` ASC, `createdAt` DESC | `SettingsPage.tsx:1824` |
| `inventory` | `isArchived` ASC, `name` ASC | `src/pages/inventory/InventoryListPage.tsx:904` |
| `stockCounts` | `status` ASC, `finalizedAt` DESC | `src/pages/inventory/StockCountPage.tsx:58` |

`invoices(status, updatedAt)` exists but does **not** cover the `createdAt`
variants — an easy one to miss by eye.

Note: an index-missing failure surfaces through the listener's **error
callback**. Three of these seven queries are among the 21 with no error callback,
so they fail **silently** today. That coupling is why §0.3's error-callback gap
should be fixed before, or with, the indexes.

### Search — server-side or client-side?

**Client-side, and knowingly so.** `src/hooks/useCustomerSearch.ts` is 100+ lines
of documented optimisation over an in-memory list: plates indexed by `customerId`
into a `Map`, search text lower-cased once at load, `useDeferredValue` so
filtering cannot block the keystroke, results capped at `MAX_RESULTS = 50`.

There is **no `searchName` / `nameLower` / `searchTokens` field anywhere** in
`src/` or `functions/` — so your Phase 5 item 3 does need a backfill, as you
suspected. But note the prerequisite: the full list is *already downloaded* for
the picker regardless (`refData.fetchCustomers`). Moving search server-side only
pays off if the list download goes away too, which is a bigger change than item 3
describes. I'd want to scope that properly before building.

### `dueForService` never cleared after reminders send

**Confirmed.** `functions/index.js:1258–1277` (`maintainVehicleDueFlag`) sets the
flag from mileage fields only. `DashboardPage:305` reads it with `limit(200)`.
Nothing clears it when a reminder is actually sent — the client-side
`lastReminderAt` cooldown filter (`:317`) runs *after* the 200-doc cap, so once a
centre accumulates more than 200 flagged vehicles, vehicles silently fall off the
end. Exactly the edge case you named. Real, and it drops customer reminders,
which is revenue.

---

## 0.6 Additional faults found (not in hypotheses A–H)

### 6.1 — Invoice/job numbers can collide (HIGH)

`generateJobNumber` (`jobCreation.ts:17`) and the invoice equivalents read the
highest number in the month prefix and add one. `boundedGetDocs` falls back to
the **offline cache** when the network stalls (`firestoreRead.ts:61–72`). Two
counter staff on two tablets, or one tablet offline, both read the same "last"
number and both mint `2609-0017`. Nothing detects it.

This is the correct trade for an offline-first app — a transaction here would
hang exactly as you describe — but duplicate invoice numbers in an accounting
system are a customer-facing integrity problem. Worth a deliberate decision:
either accept and add a device-discriminating suffix, or reconcile server-side in
`onServiceCompleted`. Your Phase 1 item 4 is pointed at roughly the right place
for the wrong reason.

### 6.2 — `writeBatch` bypasses the whole safe-write layer (MEDIUM-HIGH)

`src/lib/departments.ts:71` and `src/pages/departments/DepartmentsPage.tsx:85`:
`await writeBatch(db)...commit()`. `WriteBatch.commit()` resolves on **server
ack**, with no `localFirst` wrapper and no timeout. **This is the only place in
the app where hypothesis A is still literally true.** It hangs offline. It is
narrow (departments are configured once), but it is a genuine instance of the bug
the whole `firestoreWrite` module exists to prevent, and there is no
`safeWriteBatch` for it.

### 6.3 — Provisioning returns credentials without verifying them (HIGH — best candidate for bug 4)

> **Corrected after a closer read (Phase A).** My first pass said the function
> writes and returns with no compensation. That was wrong: `registerServiceCenter`
> *does* roll back — `functions/index.js:406–441` deletes the Auth user and the
> three documents if any write throws, and if the rollback itself fails it logs
> `"orphaned account"` and returns a message naming the uid. Credit where due.
> The finding below is the narrower, accurate version.

`registerServiceCenter` (`functions/index.js:230–434`) creates the Auth user
first, then writes `servicecenters/{centerId}`, the owner `staff` doc and
`users/{uid}`, then returns credentials with **no read-back**.

What the existing rollback does and does not cover:

- A write that **throws** → rolled back cleanly. Well handled.
- A write that **resolves** but leaves the app unable to resolve the profile —
  a `centerId` that disagrees with the document path, a `role` that is not
  `"Owner"`, an Auth email that is not what the login form derives — is **not**
  detected, because nothing reads any of it back.
- A rollback that **itself fails** leaves a half-built centre. It is logged
  loudly, but the super admin has still been shown credentials.

Meanwhile `AuthContext.resolveAuthUser` (`:337–360`) resolves identity from
`users/{uid}` **or** legacy `servicecenters/{uid}`. When neither answers, the
owner authenticates and hits `authIssue: "no-profile"`, whose own comment
(`AuthContext.tsx:32–34`) reads:

> "Signed in, reads succeeded, but no service center is attached to this account
> (no users/{uid} index and no owner center doc). **Usually a provisioning that
> half-finished.**"

So the codebase already recognises this state as reachable in production. It is
intermittent, it affects newly provisioned owners specifically, and it is
invisible to the super admin. It remains the best candidate for symptom 4 that I
found, and a better one than phone normalisation — but the mechanism is "a write
that lands wrong, or a failed rollback", not "no compensation at all".

Phase A closes it by reading the chain back before releasing credentials.

### 6.4 — `checkLoginAccount` is an enumeration oracle (MEDIUM, accepted risk)

`functions/index.js:794` is `onCall({ invoker: "public" })` and returns
`{ exists, disabled }` for any phone number. It is throttled to 20/hour per IP
(`:792`) and the author documented the trade at `:784–787`. Flagging it because
your Phase 2 item 6 wants *more* actionable login errors, which leans on this
endpoint harder. Not a blocker; just know it is a deliberate trade you are
deepening. (Also: the IP bucket is keyed on `request.rawRequest?.ip`, which
behind a proxy can collapse many users into one bucket.)

### 6.5 — No cross-tab account guard (MEDIUM — this is bug 2's second half)

`grep -rn "BroadcastChannel" src/` → zero. With `persistentSingleTabManager`,
two tabs share one IndexedDB cache but have **independent** `AuthContext`
instances. Signing in as owner B in tab 2 leaves tab 1 holding owner A's
`centerId` in React state and happily writing to owner A's centre. Your Phase 3
item 6 is correct and, as far as I can tell, is the only unaddressed half of
symptom 2. Nothing else in the codebase covers it.

---

## 0.7 What this means for your phase plan

Against the codebase as it stands, here is what each phase actually still
contains:

| Phase | Already done | Still real | Would regress |
|---|---|---|---|
| 1 Non-blocking writes | ~90% | Toast on write failure; `safeWriteBatch` (§6.2); 11 stragglers | — |
| 2 Provisioning/login | — | **Verify-before-print (§6.3)**; shared normaliser; diagnostics; password alphabet | `getIdToken(true)` (item 5) — no claims exist |
| 3 Session/crashes | ErrorBoundary; listener teardown | **Error callbacks on 21 listeners**; `signOutSafely`; BroadcastChannel; reference code; global rejection handler | Claim refresh (item 7) — no claims exist |
| 4 Firestore init | Single-tab; memory fallback | Persistence banner; foreground watchdog; `pageshow` | **`forceOwnership: false`** and **`autoDetectLongPolling`** — both revert documented fixes |
| 5 Performance | Cache warming already deleted | `limit()` on the top 6 listeners; 7 indexes; `dueForService` clearing | Item 1 (re-introduce warming) |

## 0.8 Proposed ordering, by customer impact ÷ regression risk

I'd re-cut the phases around what is actually left:

**Phase A — Provisioning integrity** *(impact: high; risk: very low)*
§6.3 verify-before-print, plus `verify-account.js` / `audit-all-accounts.js` /
`repair-login-email.js`, plus the shared normaliser and the password alphabet.
Touches one Cloud Function and adds scripts; cannot destabilise the ten live
centres; and the audit script finally answers the 0.2 questions I could not.
**This is your Phase 2 minus item 5, and I think it should go first.**

**Phase B — Listener error containment** *(impact: high; risk: low)*
Error callbacks on all 21 bare listeners, `permission-denied`/`unauthenticated`
logged and swallowed, plus the `watchDoc`/`watchQuery` wrappers and the ESLint
ban so it stays fixed. Additive; each site is a few lines. Directly targets
symptom 2 and, as a side effect, makes the seven missing indexes *visible* instead
of silent.

**Phase C — Sign-out and cross-tab** *(impact: high; risk: medium)*
`signOutSafely()` and the `BroadcastChannel` guard. Real risk because a hard
`location.replace()` interacts with the recovery guards in `main.tsx` and
`ErrorBoundary.tsx` — needs care, not avoidance.

**Phase D — Bounded listeners and indexes** *(impact: medium-high; risk: low-medium)*
`limit()` on the six worst listeners, the seven missing composite indexes,
`dueForService` clearing after reminders. Deploy indexes *before* the queries that
need them.

**Phase E — Write-failure toast and `safeWriteBatch`** *(impact: medium; risk: low)*
The genuinely-missing part of Phase 1.

**Phase F — Firestore lifecycle** *(impact: medium; risk: medium)*
Persistence banner, foreground watchdog, `pageshow` handler. **Excluding** the two
setting flips.

**Deferred / needs a decision from you:**
- §6.1 invoice number collisions — needs a design call, not a patch.
- Server-side search + `searchName` backfill — bigger than Phase 5 item 3 implies.
- `postServiceChecklist.ts:274` client transaction — your call.
- **Correction to constraint 3:** `vite-plugin-pwa` **is** enabled. `vite.config.ts`
  imports and calls `VitePWA({...})` with a configured Workbox precache, and
  `npm run build` emits `dist/sw.js` plus 14 precache entries. The brief says it is
  not enabled yet. I have changed nothing about it, but any plan that assumed no
  service worker needs revisiting — a stale service worker is itself a candidate
  for "the app is slow / won't load".

## 0.9 What I need from you

1. **Confirm the two Phase 4 flips are withdrawn** (`forceOwnership: false`,
   `experimentalAutoDetectLongPolling`). I will not make those changes without an
   explicit instruction, because the code documents concrete production
   incidents that each one caused.
2. **Confirm Phase 2 item 5 and Phase 3 item 7 are dropped** (no custom claims exist).
3. **Confirm Phase 5 item 1 is dropped** (cache warming was deliberately deleted).
4. **Approve the re-ordering**, or tell me to run your original ordering anyway.
5. **Decide on §6.1** (invoice number collisions) and the checklist transaction.
6. If you want the 0.2 production counts before Phase A, I need a way to run a
   read-only admin script against the project — otherwise they arrive as Phase A's
   first output.
