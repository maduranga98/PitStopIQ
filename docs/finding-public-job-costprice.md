# Finding: shop purchase prices are publicly readable via job and invoice documents

**Status:** open, pre-existing, **not addressed by the Repair Catalog work**. Written up separately so it can be handled in its own PR.
**Found in:** Repair Catalog Phase 0 (`docs/repair-catalog-phase-0.md`, §5), re-confirmed in Phase 2 at `f4ecc51`.

## What
The customer share link (`/c/:centerId/:customerId`) reads Firestore anonymously, so these rules are `read: if true` (`firestore.rules`, `servicecenters/{centerId}` sub-collections):

- `jobs/{jobId}`: carries `partsUsed[]`, and each entry has **`costPrice`** (what the workshop paid the supplier) next to `unitPrice` (what the customer was charged). Also `laborCost` and `commissionTotal`, which are internal.
- `invoices/{invoiceId}`: `lineItems[].costPrice` ("snapshotted for margin reporting"), plus `commissionTotal`.
- `vehicles/{vehicleId}`: public by design for the share link.

Anyone who knows (or enumerates) a `centerId` and a job or invoice id can read the full document with the web SDK or REST, with no login. Customer ids are Firestore auto-ids, which are unguessable in practice, but they appear in every share link and short link, so any customer (or anyone a link is forwarded to) can read the margin on their own jobs and, by changing the query to a collection read, `list` is also open for `jobs`/`invoices` (`allow read` covers both get and list), so a client can query **all jobs and invoices of a center** without knowing any id.

## Why it matters
Per-part markup is exactly what a repair shop does not want customers to see, and the Repair Catalog makes parts a bigger share of each bill. It also exposes labour cost and staff commission totals.

## Suggested direction (for the separate PR)
- Serve the share-link views through a callable that returns a whitelisted projection (the diagnostic-report share flow, `getPublicReport`, is the existing precedent), and make `jobs`/`invoices` staff-only; or
- as a smaller step, stop writing `costPrice` onto documents that are publicly readable and keep cost in a staff-only sub-document.
- Either way `list` on `jobs`/`invoices` should not be public.

Needs its own review: it changes `PublicCustomerView` / `PublicInvoiceView` data loading, and any report that reads `costPrice` from the job or invoice (`jobProfitability.ts`, `ProfitabilityReport.tsx`).
