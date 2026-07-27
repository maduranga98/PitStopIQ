import type { Timestamp } from "firebase/firestore";

export type UserRole = "Owner" | "Manager" | "Technician" | "Cashier" | "Receptionist";

export interface ServiceCenter {
  id: string;
  name: string;
  phone: string;
  address: string;
  district: string;
  logoUrl?: string;
  businessRegistrationNumber?: string;
  smsSenderName: string;
  reminderThresholdKm?: number;
  reminderCooldownDays: number;
  // Days since a customer's last service after which they're treated as
  // "inactive" on the Customers list. Configurable per center's customer base;
  // defaults to 90 when unset.
  customerInactiveDays?: number;
  plan: "basic" | "pro";
  createdAt: Date;
  ownerId: string;
  // Multi-branch: the owner's Firebase Auth uid, shared across every branch
  // document that owner has (primary + additional branches).
  ownerUid: string;
  // false = primary branch (the one created at registration, centerId == uid).
  // true = an additional branch provisioned later by the super admin.
  isBranch: boolean;
  // The primary branch's centerId. null for the primary itself.
  primaryCenterId: string | null;
  // Friendly label for additional branches (falls back to `name` if unset).
  branchName?: string;
  // Monthly billing rate for this specific branch document:
  // 7999 primary-pro / 4999 primary-basic / 4000 additional branch.
  monthlyRate: number;
  // Soft-delete flag distinct from `status` (billing state). false = the
  // super admin has closed this branch; data is retained, billing stops.
  isActive: boolean;
  // Payment reference code (short unique code for bank transfers)
  paymentCode?: string;
  // Super admin managed fields
  // active: payment current; grace_period: overdue but within 7-day grace;
  // pending_payment: slip uploaded, awaiting verification; blocked: access cut off
  status: "active" | "grace_period" | "pending_payment" | "blocked";
  ownerName?: string;
  ownerPhone?: string;
  registeredByAdminId?: string;
  // Subscription period
  currentPeriodStart?: Timestamp;
  currentPeriodEnd?: Timestamp;
  graceDeadline?: Timestamp;
  lastPaymentVerifiedAt?: Timestamp;
  lastPaymentAmount?: number;
  // SMS quota
  smsQuotaUsed: number;
  smsQuotaLimit: number; // 200 basic / 1000 pro
  // SMS templates (stored as strings; undefined = use default)
  completionSmsTemplate?: string;
  reminderSmsTemplate?: string;
  // Inspection module (Pro only, off by default)
  inspectionEnabled?: boolean;
  // Multi-user settings (Pro only)
  multiUser?: boolean;
  maxStaff?: number;
  // Account deletion
  isDeleted?: boolean;
  deletionScheduledAt?: Timestamp;
  // Set when the Owner has submitted a deletion request that is awaiting super
  // admin approval. Cleared by the super admin if the request is rejected.
  deletionRequestedAt?: Timestamp;
}

export type AccountDeletionRequestStatus = "pending" | "completed" | "rejected";

export interface AccountDeletionRequest {
  id: string;
  centerId: string;
  centerName: string;
  ownerUid: string;
  requestedBy: string;
  requestedByName: string;
  reason?: string;
  status: AccountDeletionRequestStatus;
  createdAt: Timestamp;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
  reviewedByName?: string;
  completedAt?: Timestamp;
  completedBy?: string;
}

export interface SuperAdmin {
  id: string;
  email: string;
  displayName: string;
  createdAt: Timestamp;
}

export type PaymentStatus = "pending" | "paid";
export type PaymentPeriod = "monthly" | "yearly";

export interface ServiceCenterPayment {
  id: string;
  centerId: string;
  amount: number;
  plan: "basic" | "pro";
  period: PaymentPeriod;
  status: PaymentStatus;
  paidAt?: Timestamp;
  markedBy: string; // super admin uid
  markedByName: string;
  notes?: string;
  upgradeRequestId?: string;
  createdAt: Timestamp;
  // The billing month this payment covers, e.g. "2026-07" — distinct from
  // paidAt (when it was actually recorded). Lets the admin mark a payment
  // against the month it's for, even if paid late or in advance.
  forMonth?: string;
}

export type UpgradeRequestStatus = "pending" | "approved" | "rejected";
export type PaymentSlipRequestStatus = "pending" | "confirmed" | "rejected";

export interface PaymentSlipRequest {
  id: string;
  centerId: string;
  centerName: string;
  paymentCode: string;
  plan: "basic" | "pro";
  period: PaymentPeriod;
  amount: number;
  slipUrl: string;
  status: PaymentSlipRequestStatus;
  notes?: string;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
  reviewedByName?: string;
  createdAt: Timestamp;
}

export type PlanChangeType = "upgrade" | "downgrade";

export interface UpgradeRequest {
  id: string;
  centerId: string;
  centerName: string;
  paymentCode: string;
  // The plan the center wants to move to. "pro" = upgrade (payment slip
  // required), "basic" = downgrade (no payment, no slip). Older documents
  // predate downgrades and are always upgrades to "pro".
  requestedPlan: "basic" | "pro";
  // Absent on legacy upgrade docs; derive from requestedPlan when missing.
  type?: PlanChangeType;
  period: PaymentPeriod;
  amount: number;
  // Optional: downgrade requests carry no payment slip.
  slipUrl?: string;
  status: UpgradeRequestStatus;
  notes?: string;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
  reviewedByName?: string;
  createdAt: Timestamp;
}

export interface StaffMember {
  id: string;
  email: string;
  displayName?: string;
  fullName: string;
  phone: string;
  role: UserRole;
  centerId: string;
  active: boolean;
  createdAt: Timestamp;
  lastLoginAt?: Timestamp;
  employeeId?: string;
  dateJoined?: Timestamp;
  notes?: string;
  inviteSent?: boolean;
  hasLogin?: boolean;
  authUid?: string;
  loginPhone?: string;
}

export type AttendanceStatus = "present" | "absent" | "half_day" | "holiday";

export interface AttendanceMonth {
  days: Record<string, AttendanceStatus>; // key = "YYYY-MM-DD"
}

export interface PendingInvite {
  id: string;
  email: string;
  role: UserRole;
  centerId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  createdBy: string;
}

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  centerId?: string;
  role?: UserRole;
  centerPlan?: "basic" | "pro";
}

export type SmsLanguage = "sinhala" | "tamil" | "english";

export interface Customer {
  id: string;
  name: string;
  phone: string;
  nic?: string;
  notes?: string;
  smsLanguage?: SmsLanguage;
  isDeleted: boolean;
  vehicleCount: number;
  lastServiceDate: Timestamp | null;
  createdAt: Timestamp;
  centerId: string;
}

// Built-in categories; centers can also add their own custom categories,
// so vehicleType is stored as a plain string.
export type VehicleType = string;

export type ServiceLibraryCategory =
  | "Engine"
  | "Brakes"
  | "Tyres"
  | "Suspension"
  | "Electrical"
  | "Body"
  | "AC"
  | "General"
  | "Other";

export type ServiceLibraryUnit =
  | "per service"
  | "per litre"
  | "per item"
  | "per hour";

export interface ServicePriceItem {
  id: string;
  name: string;
  description?: string;
  category?: ServiceLibraryCategory;
  defaultPrice: number;
  /** @deprecated Use defaultPrice */
  price?: number;
  unit?: ServiceLibraryUnit;
  isActive?: boolean;
  // When set, this price only applies to vehicles of this type. Multiple
  // entries can share the same `name` — one per vehicle type — plus an
  // optional general entry with no vehicleType used as the fallback price.
  vehicleType?: VehicleType;
  centerId: string;
  createdAt: Timestamp;
}

export interface Vehicle {
  id: string;
  plateNumber: string;
  customerId: string;
  customerName: string;
  make?: string;
  model?: string;
  year?: number;
  vehicleType?: VehicleType;
  colour?: string;
  currentMileageKm: number;
  nextServiceMileageKm: number;
  oilBrand?: string;
  oilGrade?: string;
  oilViscosityNotes?: string;
  qrCodeUrl?: string;
  // True once the stored QR image encodes a resolvable short link
  // (pitstopiq.com/v/{code}). Older QRs encoded the vehicle id, which the
  // /v/ resolver can't map to a customer view, so they are regenerated.
  qrEncodesShortLink?: boolean;
  photoUrls?: string[];
  centerId: string;
  isDeleted: boolean;
  lastServiceDate?: Timestamp | null;
  // Time-based reminder scheduling (derived once a vehicle is serviced twice)
  serviceIntervalDays?: number;
  nextServiceDate?: Timestamp | null;
  reminderSent?: boolean;
  reminderSentAt?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface ServiceRecord {
  id: string;
  vehicleId: string;
  plateNumber: string;
  customerId: string;
  serviceType: string;
  status: "pending" | "in_progress" | "done" | "delivered";
  technicianName?: string;
  totalAmount?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SmsLog {
  id: string;
  customerId: string;
  customerName: string;
  phone: string;
  vehicleId?: string;
  plateNumber?: string;
  jobId?: string;
  messageType: "Completion" | "Reminder" | "Invitation";
  status: "sent" | "delivered" | "failed" | "pending_blackout";
  message: string;
  sentAt: Timestamp;
  errorCode?: string;
  errorMessage?: string;
  providerResponse?: unknown;
  deliveredAt?: Timestamp;
  senderMask?: string;
  /** Optional sender mask override, checked against an approved allowlist server-side. */
  mask?: string;
  esmsTransactionId?: number;
  esmsCampaignId?: string | null;
}

export interface PartUsed {
  itemId: string;
  itemName: string;
  quantity: number;
  /**
   * What the customer is charged per unit — the item's service-center price.
   * Written on every new line; older lines only carry `unitCost`.
   */
  unitPrice?: number;
  /** @deprecated Kept for lines saved before service-center pricing existed. */
  unitCost?: number;
}

export interface RestockEntry {
  addedQty: number;
  addedBy: string;
  timestamp: Timestamp;
  note?: string;
}

// Stock handed to a technician against an approved inventory request. Kept
// apart from deductionLog, which records parts consumed by a specific service.
export interface IssueEntry {
  requestId: string;
  issuedQty: number;
  issuedTo: string;
  issuedBy: string;
  jobRef?: string;
  // Service-center price at the moment of issue, so the value of what left the
  // store room is recoverable even if the price book changes later.
  unitPrice?: number;
  timestamp: Timestamp;
}

export interface DeductionEntry {
  serviceId: string;
  vehicleId: string;
  date: Timestamp;
  qtyDeducted: number;
  remainingQty: number;
}

// Stock handed over to a distributor, either by finalizing one of their
// purchase orders or by releasing it to them directly from the item.
export interface ReleaseEntry {
  distributorId: string;
  distributorName: string;
  releasedQty: number;
  releasedBy: string;
  orderId?: string;
  orderNumber?: string;
  unitPrice?: number;
  timestamp: Timestamp;
  note?: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  // Built-in categories plus whatever the center has added itself, so this is
  // a plain string (see lib/inventoryOptions).
  category: string;
  // Same story as `category`: the built-in units plus whatever the center has
  // added itself (drums, cans, boxes…), so this is a plain string.
  unit: string;
  currentQty: number;
  threshold: number;
  // ── Price book ─────────────────────────────────────────────────────────────
  // One item, five figures: what it cost to buy and the four ways it can be
  // sold on. Every read goes through lib/inventoryPricing so the fallbacks stay
  // in one place — an item saved before this existed only has `unitCost`.
  /** What the center paid the supplier per unit. */
  purchasePrice?: number;
  /** @deprecated Superseded by purchasePrice; still written for old readers. */
  unitCost?: number;
  /** Price a distributor pays. */
  distributorPrice?: number;
  /** Price the center's own retail outlet sells at. */
  outletPrice?: number;
  /** Price billed on a service-center invoice when a technician uses the part. */
  serviceCenterPrice?: number;
  /** Manufacturer's marked price (MRP) printed on the item. */
  markedPrice?: number;
  // false hides the item from every distributor portal. Undefined = shareable.
  availableToDistributors?: boolean;
  // Where the stock comes from. supplierId points at the suppliers collection;
  // the rest is snapshotted so the item still reads correctly if the supplier
  // record is later edited or deactivated.
  supplierId?: string;
  supplierName?: string;
  supplierCompany?: string;
  supplierBrand?: string;
  supplierPhone?: string;
  notes?: string;
  isArchived?: boolean;
  restockLog?: RestockEntry[];
  deductionLog?: DeductionEntry[];
  issueLog?: IssueEntry[];
  releaseLog?: ReleaseEntry[];
  centerId: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export type InventoryRequestStatus = "pending" | "approved" | "rejected";

// A technician asking the workshop for stock. Approving one issues the parts
// and deducts them from the item's current quantity.
export interface InventoryRequest {
  id: string;
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  status: InventoryRequestStatus;
  note?: string;
  // Job the parts are needed for (free text: plate or job number).
  jobRef?: string;
  requestedBy: string;      // staff uid
  requestedByName: string;
  createdAt: Timestamp;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewNote?: string;
  // Quantity actually issued when approved (may be less than requested).
  issuedQty?: number;
}

// ── Suppliers ────────────────────────────────────────────────────────────────
// Who the workshop buys stock from. A supplier is a rep (name + mobile) acting
// for a company and, usually, a single brand — the way parts are actually
// bought in Sri Lanka. Recording a supply from one both restocks inventory and
// leaves a goods-received record behind.

export interface Supplier {
  id: string;
  /** The rep the workshop actually deals with. */
  name: string;
  companyName: string;
  brand: string;
  mobile: string;
  email?: string;
  address?: string;
  notes?: string;
  isActive: boolean;
  lastSupplyAt?: Timestamp;
  centerId: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

// One line of a supply: an item that arrived, how much of it, and the price
// book it was booked in at. Prices are snapshotted here so a later price change
// never rewrites what a past delivery cost.
export interface SupplyLine {
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  purchasePrice: number;
  lineTotal: number;
  distributorPrice?: number;
  outletPrice?: number;
  serviceCenterPrice?: number;
  markedPrice?: number;
  /** True when this line created the inventory item rather than restocking it. */
  isNewItem: boolean;
}

export interface SupplierSupply {
  id: string;
  /** Goods-received number, e.g. GRN-2607-0004. */
  supplyNumber: string;
  supplierId: string;
  supplierName: string;
  supplierCompany: string;
  supplierBrand?: string;
  items: SupplyLine[];
  total: number;
  /** The supplier's own invoice / bill reference. */
  invoiceRef?: string;
  note?: string;
  centerId: string;
  createdAt: Timestamp;
  createdBy: string;
  createdByName: string;
}

// ── Distributors ─────────────────────────────────────────────────────────────
// A distributor takes stock off the owner's hands and sells it on. They have no
// login: the owner shares a link that opens a read-only catalog where the
// distributor builds a purchase order. Nothing leaves the store room until the
// owner finalizes that order.

export interface Distributor {
  id: string;
  name: string;
  contactPerson?: string;
  phone: string;
  email?: string;
  address?: string;
  notes?: string;
  isActive: boolean;
  // Secret half of the share link. Regenerating it invalidates every link the
  // distributor already has, which is how access is revoked.
  accessToken: string;
  // Short code minted in `links/{code}` so the owner can share a tiny URL.
  shortCode?: string;
  // false takes the portal offline without deleting the distributor.
  portalEnabled: boolean;
  lastOrderAt?: Timestamp;
  centerId: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export type DistributorOrderStatus = "submitted" | "finalized" | "rejected" | "cancelled";

export interface DistributorOrderItem {
  itemId: string;
  itemName: string;
  unit: string;
  // What the distributor asked for.
  requestedQty: number;
  // What the owner is actually releasing. Starts equal to requestedQty and can
  // be trimmed during review — 0 drops the line from the release.
  approvedQty: number;
  unitPrice: number;
  lineTotal: number;
}

// How a distributor settled (part of) an order. An order can carry any mix:
// some cash now, a cheque for the rest, the remainder on credit.
//   cash   — money handed over
//   cheque — a cheque received; not money until it clears, but recorded in full
//   credit — the portion explicitly taken on credit, still owed
export type DistributorPaymentMethod = "cash" | "cheque" | "credit";

export interface DistributorPayment {
  // Stable id so a mis-keyed entry can be removed from the array.
  id: string;
  method: DistributorPaymentMethod;
  amount: number;
  // When the money changed hands (or the credit was agreed).
  date: Timestamp;
  note?: string;
  // Cheque only — all four are required when method is "cheque".
  chequeNumber?: string;
  bank?: string;
  branch?: string;
  chequeDate?: Timestamp;
  recordedBy: string;
  recordedByName: string;
  recordedAt: Timestamp;
}

export type DistributorPaymentStatus = "unpaid" | "partial" | "paid";

export interface DistributorOrder {
  id: string;
  orderNumber: string;
  distributorId: string;
  distributorName: string;
  distributorPhone?: string;
  items: DistributorOrderItem[];
  note?: string;
  status: DistributorOrderStatus;
  // Total of the approved quantities — recomputed whenever the owner edits.
  total: number;
  payments?: DistributorPayment[];
  // Denormalised from `payments` on every write so the list and the portal can
  // show balances without re-summing, and so a cashier's write touches a fixed
  // set of keys the security rules can whitelist.
  // receivedTotal counts cash + cheques — actual money in. Credit is tracked
  // separately because it is a promise, not a payment, and still counts
  // towards the balance due.
  receivedTotal?: number;
  creditTotal?: number;
  balanceDue?: number;
  paymentStatus?: DistributorPaymentStatus;
  // "portal" = built by the distributor from their link; "staff" = raised in
  // the app on their behalf.
  createdVia: "portal" | "staff";
  centerId: string;
  createdAt: Timestamp;
  reviewNote?: string;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
  reviewedByName?: string;
  finalizedAt?: Timestamp;
}

export type DistributorStockRequestStatus =
  | "pending"       // waiting for the workshop to look at it
  | "acknowledged"  // seen, more stock is on the way
  | "fulfilled"     // the stock is in and the distributor can order it
  | "declined";

// A distributor can only order what's on the shelf. When they need more than
// that, this is how they ask for it — a nudge to the workshop, not an order:
// nothing is reserved and no stock moves.
export interface DistributorStockRequest {
  id: string;
  distributorId: string;
  distributorName: string;
  itemId: string;
  itemName: string;
  unit: string;
  requestedQty: number;
  /** What was on the shelf when they asked — context for the reviewer. */
  availableQtyAtRequest: number;
  note?: string;
  status: DistributorStockRequestStatus;
  reviewNote?: string;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
  reviewedByName?: string;
  centerId: string;
  createdAt: Timestamp;
}

export interface ServiceJob {
  id: string;
  jobNumber: string;
  vehicleId: string;
  plateNumber: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  make: string;
  model: string;
  year: number;
  // Snapshotted from the vehicle when the job is created, so per-vehicle-type
  // catalog prices can be re-resolved for this job's invoice.
  vehicleType?: VehicleType;
  mileageIn: number;
  mileageOut?: number;
  nextServiceMileageKm?: number;
  oilBrand?: string;
  oilGrade?: string;
  oilViscosityNotes?: string;
  technicianId: string;
  technicianName: string;
  services: string[];
  customServices: string[];
  internalNotes?: string;
  status: "pending" | "in_progress" | "done" | "delivered";
  partsUsed: PartUsed[];
  smsSent: boolean;
  startedAt?: Timestamp;
  completedAt?: Timestamp;
  deliveredAt?: Timestamp;
  centerId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface InvoiceLineItem {
  description: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export type InvoiceStatus = "pending" | "partial" | "paid";
export type DiscountType = "amount" | "percent";

// How a customer settled (part of) an invoice. One invoice can carry any mix:
// some cash at the counter, a cheque for the rest, the remainder on credit.
//   cash          — money handed over
//   card          — card machine at the counter
//   bank_transfer — money sent to the center's account
//   cheque        — a cheque received; recorded in full, with its own details
//   credit        — the portion explicitly taken on credit, still owed
export type InvoicePaymentMethod = "cash" | "card" | "bank_transfer" | "cheque" | "credit";

// Cash, a card and a transfer are done the moment they're taken. A cheque and a
// credit are not: the cheque still has to clear, and the credit still has to be
// collected. Both sit "pending" until an Owner or Manager confirms it came in.
// Absent on an entry that needs no confirmation, and read as "pending" on a
// cheque or credit saved before confirmation existed.
export type PaymentClearance = "pending" | "cleared";

export interface InvoicePayment {
  // Stable id so a mis-keyed entry can be removed from the array.
  id: string;
  method: InvoicePaymentMethod;
  amount: number;
  // When the money changed hands (or the credit was agreed).
  date: Timestamp;
  note?: string;
  // Cheque only — all four are required when method is "cheque".
  chequeNumber?: string;
  bank?: string;
  branch?: string;
  chequeDate?: Timestamp;
  // Cheque and credit only.
  clearance?: PaymentClearance;
  clearedAt?: Timestamp;
  clearedBy?: string;
  clearedByName?: string;
  recordedBy: string;
  recordedByName: string;
  recordedAt: Timestamp;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  serviceId?: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  vehicleId: string;
  plateNumber: string;
  serviceDate: Timestamp;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  discount: number;
  discountType: DiscountType;
  tax: number;
  grandTotal: number;
  status: InvoiceStatus;
  paidAmount: number;
  balanceDue: number;
  // How the invoice was settled. Once any entry exists these are the source of
  // truth: paidAmount, balanceDue and status are all re-derived from them on
  // every write (see lib/invoicePayments), so the ledger and the totals can
  // never drift apart. Invoices settled before this existed simply have none.
  payments?: InvoicePayment[];
  // Denormalised from `payments` so lists and reports don't have to re-sum.
  // receivedTotal counts cash, card, transfers and cheques — actual money in.
  // Credit is a promise, not a payment, so it is tracked apart and still
  // counts towards the balance due.
  receivedTotal?: number;
  creditTotal?: number;
  paidAt?: Timestamp;
  pdfUrl?: string;
  pdfGeneratedAt?: Timestamp;
  centerId: string;
  finalized?: boolean;
  finalizedAt?: Timestamp;
  smsSent?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ── Vehicle Inspection (Pro only) ────────────────────────────────────────────

export type FuelLevel = "empty" | "quarter" | "half" | "three_quarter" | "full";
export type OverallCondition = "good" | "minor_damage" | "major_damage";
export type ChecklistStatus = "ok" | "needs_attention" | "damaged";

export interface ChecklistItem {
  item: string;
  status: ChecklistStatus;
}

export interface DamageReport {
  id: string;
  location: string;
  description: string;
  photoUrl: string | null;
  photoDeleteAt: Timestamp;
  photosDeleted: boolean;
}

export interface VehicleInspection {
  conductedBy: string;
  completedAt: Timestamp;
  fuelLevel: FuelLevel;
  odometerReading: number;
  overallCondition: OverallCondition;
  checklistItems: ChecklistItem[];
  damageReports: DamageReport[];
  notes: string | null;
  skipped: boolean;
  nextPhotoDeleteAt?: Timestamp;
  photosDeleted?: boolean;
}

export const INSPECTION_CHECKLIST_ITEMS = [
  "Front Left Tyre",
  "Front Right Tyre",
  "Rear Left Tyre",
  "Rear Right Tyre",
  "Windscreen",
  "Front Bumper",
  "Rear Bumper",
  "Left Side Panels",
  "Right Side Panels",
  "Front Lights",
  "Rear Lights",
  "Left Mirror",
  "Right Mirror",
  "Interior / Seats",
  "Dashboard",
] as const;

export const SRI_LANKA_DISTRICTS = [
  "Ampara", "Anuradhapura", "Badulla", "Batticaloa", "Colombo",
  "Galle", "Gampaha", "Hambantota", "Jaffna", "Kalutara",
  "Kandy", "Kegalle", "Kilinochchi", "Kurunegala", "Mannar",
  "Matale", "Matara", "Monaragala", "Mullaitivu", "Nuwara Eliya",
  "Polonnaruwa", "Puttalam", "Ratnapura", "Trincomalee", "Vavuniya",
] as const;
