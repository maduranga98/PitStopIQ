# Callers, assignment and commission payouts

Lead handlers ("callers") work leads assigned to them from the existing sales pipeline; the super admin
confirms payments and pays commission weekly.

## Roles

| | Super admin | Caller |
|---|---|---|
| Sign in | `/admin/login` | `/caller/login` (email + password) |
| Leads | all, full CRUD | only `assignedTo == their uid`; no create/delete |
| Stage | any | any except Won (set by registration); Lost needs a reason |
| Assign / package / commission / payout fields | yes (validated) | never |
| Account lives in | `superadmins/{uid}` | `callers/{uid}` (`isActive` must be true) |

## One-off setup

1. **Seed the price list** (once per project):
   ```bash
   cd functions
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/seed-packages.js --dry-run
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/seed-packages.js
   ```
   Basic 4,999 and Pro 7,999, both at 20%. Commission is `round(price × rate)`: **Rs 1,000** and **Rs 1,600**.
   To change a price later, edit `PACKAGES` in the script and re-run with `--force`. Leads already converted keep the
   commission they were stamped with.
2. **Deploy** the rules and the function:
   ```bash
   firebase deploy --only firestore:rules,functions:createCallerAccount
   ```
3. Add callers from **Callers** in the admin sidebar. The temporary password is shown once; callers can set their
   own with "Forgot password?" on the sign-in page.

## Caller screens

- **My Leads** (`/caller`): Kanban on desktop, stage tabs on phones. No "Video & details" column or call outcome for
  callers — a lead already in that stage shows under Follow-up. Won is locked; Lost asks for a reason.
- **Revenue** (`/caller/revenue`): total earned, paid out / payable / awaiting customer payment, an 8-week chart and a
  list of their sales, all from their own won leads.

## Flow

1. Super admin adds a lead and assigns it (at creation, or from the lead drawer).
2. The caller works it on **My Leads**: logs calls, moves stages, marks Lost with a reason.
3. The lead is registered as a customer through the existing "Open in Management" → register flow. That marks it
   **Won** and stamps `packageId` and `commissionAmount` from `packages/{plan}`.
4. When the first payment actually arrives, the super admin opens the lead and clicks **Confirm payment received**.
   This stamps the confirmation and files the commission under the current ISO week (Colombo time) as `pending`.
   It is blocked, with the reason shown, if the lead has no package (won outside registration) or no assigned caller.
5. On **Payouts**, pick the week, pay each caller, then **Mark payout sent**. Sent weeks stay listed with a tick;
   weeks that still owe a commission are listed at the top so a late payout can't go unnoticed.

## Guarantees enforced by `firestore.rules` (see `tests/rules/leads.rules.test.mjs`)

- Callers can only touch an allow-list of fields on their own leads; every stage change must append exactly one
  matching `stageHistory` entry.
- `commissionAmount` must equal `round(price × rate)` from `packages`; confirming a payment needs a Won lead with a
  commission, stamped by the confirming admin.
- Once a payout is sent, the package, commission and payout fields are frozen from the client.
- Deactivating a caller cuts their access immediately (`isCaller()` requires `isActive`) and signs them out live.

## Tests

```bash
npm test                 # unit tests (commission, ISO weeks, payouts, caller board rules)
npm run test:rules       # Firestore rules, needs Java + the emulator
npm run test:callers     # createCallerAccount against the Auth + Firestore emulators
```
