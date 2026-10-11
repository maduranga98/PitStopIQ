# Repair Catalog: what the customer portal callables must include

`PublicCustomerView` and `PublicInvoiceView` are not edited by the Repair Catalog.
The public-read security work rewrites them and the callables behind them
(`functions/shared/portalProjections.mjs`). For repairs to show to a customer,
the projections must INCLUDE exactly the fields below. Anything not listed
stays out.

## `getPortalData`: the job projection (`projectPortalJob`)

Include, in addition to today's allowed fields (`id`, `plateNumber`,
`createdAtMillis`, `services`, `customServices`, `mileageOut`):

| Field | Source on the job | Shape |
| --- | --- | --- |
| `repairs` | `job.repairsPerformed[].name` | array of non-empty strings |

Build it as the names only, for example
`repairs: (Array.isArray(j.repairsPerformed) ? j.repairsPerformed : []).map((r) => str(r && r.name)).filter(Boolean)`.
The view lists these with the job's `services` and `customServices` (one
"services performed" list). A job with no `repairsPerformed` yields `[]`.

Allowed from each repair entry: `name`. Nothing else from `repairsPerformed`
(its `price`, `repairItemId`, `resolvedFrom`, `resolvedSourceId`,
`priceOverridden`, `custom` and `partItemIds` are internal) is part of the
projection. Prices reach the customer through the invoice, below.

## `getPublicInvoice`: the line whitelist (`projectInvoiceLine`)

Allowed `type` values for a line item: `"service"`, `"part"`, `"repair"`.
A line with any other `type` is projected with `type` unset.

A line with `type: "repair"` is projected with exactly:

| Field | Notes |
| --- | --- |
| `description` | the repair's name |
| `qty` | always 1 |
| `unitPrice` | the price frozen on the job |
| `lineTotal` | equal to `unitPrice` |
| `discount` | only when the counter set one on that line |

The allowed set stays the existing line fields (`description`, `qty`,
`unitPrice`, `lineTotal`, `type`, `partNumber`, `brand`, `warranty`,
`discount`, `billingType`, `hourlyRate`, `workingHours`). `repairItemId` is not
in it. A repair line has no `technicianId`, and none is projected.

## What the views need

`PublicInvoiceView` already groups every line whose `type` is not `"part"`
under services, so repair lines appear there with no view change once the
whitelist above lets `"repair"` through. `PublicCustomerView` needs the
`repairs` names added to the services list it prints per job.

## Test to add with that change

Feed `projectInvoiceLine` a `type: "repair"` line carrying `repairItemId` and
`technicianId`; assert the result has `type: "repair"`, the four money and text
fields above, and neither of those two keys. Feed `projectPortalJob` a job with
two repairs; assert `repairs` is their two names and that no price appears.
