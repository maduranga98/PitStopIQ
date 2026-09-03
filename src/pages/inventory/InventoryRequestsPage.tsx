import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  collection, query, where, onSnapshot, doc, orderBy, Timestamp, arrayUnion,
} from "firebase/firestore";
import {
  ClipboardList, Package, Plus, X, Check, AlertTriangle, Search, Car,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { safeAddDoc, safeUpdateDoc } from "../../lib/firestoreWrite";
import { logMovement } from "../../lib/inventoryMovements";
import { billIssuedPartToJob } from "../../lib/jobInvoice";
import type { InventoryItem, InventoryRequest, InventoryRequestStatus, ServiceJob } from "../../types/auth";
import { LoadingBlock } from "../../components/LoadingProgress";
import { formatLKR, serviceCenterPriceOf } from "../../lib/inventoryPricing";

// Technicians can't touch stock levels, so they ask for what they need here.
// Owners/managers approve a request, which issues the parts and deducts them
// from the item's quantity in one step.

const STATUS_CHIP: Record<InventoryRequestStatus, string> = {
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  approved: "bg-green-500/15 text-green-400 border-green-500/30",
  rejected: "bg-red-500/15 text-red-400 border-red-500/30",
};

const STATUS_LABEL: Record<InventoryRequestStatus, string> = {
  pending: "Pending",
  approved: "Issued",
  rejected: "Rejected",
};

function stockLabel(item: InventoryItem | undefined): string {
  if (!item) return "Item no longer in inventory";
  return `${item.currentQty} ${item.unit} in stock`;
}

// Parts a technician takes out are billed to the customer at the service-center
// price, so that — not cost, not MRP — is the figure shown on a request and the
// one written to the issue log.
function requestValue(item: InventoryItem | undefined, quantity: number): number | null {
  if (!item) return null;
  const unitPrice = serviceCenterPriceOf(item);
  return unitPrice > 0 ? unitPrice * quantity : null;
}

// ── New request modal ─────────────────────────────────────────────────────────

function jobLabel(job: ServiceJob): string {
  const desc = [...(job.services ?? []), ...(job.customServices ?? [])].join(", ");
  return desc ? `${job.plateNumber} · ${desc}` : job.plateNumber;
}

function NewRequestModal({
  items, jobs, centerId, requestedBy, requestedByName, onClose,
}: {
  items: InventoryItem[];
  jobs: ServiceJob[];
  centerId: string;
  requestedBy: string;
  requestedByName: string;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [jobSearch, setJobSearch] = useState("");
  const [jobId, setJobId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? items.filter(i => i.name.toLowerCase().includes(q)) : items;
    return list.slice(0, 8);
  }, [items, search]);

  const jobMatches = useMemo(() => {
    const q = jobSearch.trim().toLowerCase();
    const list = q
      ? jobs.filter(j => j.plateNumber.toLowerCase().includes(q) || (j.jobNumber ?? "").toLowerCase().includes(q))
      : jobs;
    return list.slice(0, 8);
  }, [jobs, jobSearch]);

  const selected = items.find(i => i.id === itemId);
  const selectedJob = jobs.find(j => j.id === jobId);

  async function handleSubmit() {
    const qty = parseFloat(quantity);
    if (!selected) {
      setError("Pick an item to request.");
      return;
    }
    if (!quantity || isNaN(qty) || qty <= 0) {
      setError("Enter a positive quantity.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await safeAddDoc(collection(db, "servicecenters", centerId, "inventoryRequests"), {
        itemId: selected.id,
        itemName: selected.name,
        unit: selected.unit,
        quantity: qty,
        status: "pending",
        note: note.trim() || null,
        vehicleId: selectedJob?.vehicleId ?? null,
        plateNumber: selectedJob?.plateNumber ?? null,
        jobId: selectedJob?.id ?? null,
        jobNumber: selectedJob?.jobNumber ?? null,
        jobRef: selectedJob ? `${selectedJob.plateNumber} · ${selectedJob.jobNumber}` : null,
        requestedBy,
        requestedByName,
        centerId,
        createdAt: Timestamp.now(),
      });
      onClose();
    } catch {
      setError("Could not send the request. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Request an Item</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Item <span className="text-red-400">*</span>
            </label>
            {selected ? (
              <div className="flex items-center justify-between bg-[#0B1120] border border-white/10 rounded-lg px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-white font-medium truncate">{selected.name}</p>
                  <p className="text-xs text-gray-500">{selected.category} · {stockLabel(selected)}</p>
                  <p className="text-xs text-gray-500">
                    Billed at {formatLKR(serviceCenterPriceOf(selected))} per {selected.unit.toLowerCase().replace(/s$/, "")}
                  </p>
                </div>
                <button
                  onClick={() => { setItemId(""); setSearch(""); }}
                  className="text-xs text-[#F97316] hover:text-[#fb923c] flex-shrink-0 ml-3"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search inventory…"
                    className="w-full pl-9 pr-4 py-2.5 bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg text-sm text-white placeholder-gray-600 transition"
                  />
                </div>
                <div className="mt-2 max-h-44 overflow-y-auto space-y-1">
                  {matches.length === 0 ? (
                    <p className="text-xs text-gray-500 px-1 py-2">No matching items.</p>
                  ) : matches.map(item => (
                    <button
                      key={item.id}
                      onClick={() => setItemId(item.id)}
                      className="w-full text-left bg-[#0B1120] hover:bg-white/5 border border-white/5 rounded-lg px-3 py-2 transition"
                    >
                      <p className="text-sm text-white truncate">{item.name}</p>
                      <p className="text-xs text-gray-500">{stockLabel(item)}</p>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Quantity <span className="text-red-400">*</span>
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              placeholder={selected ? `e.g. 2 ${selected.unit}` : "e.g. 2"}
              className="w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              For which vehicle <span className="text-gray-600 font-normal">(optional)</span>
            </label>
            {selectedJob ? (
              <div className="flex items-center justify-between bg-[#0B1120] border border-white/10 rounded-lg px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-white font-medium truncate flex items-center gap-1.5">
                    <Car className="h-3.5 w-3.5 text-gray-500 flex-shrink-0" />
                    {selectedJob.plateNumber}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {selectedJob.jobNumber}
                    {selectedJob.customerName ? ` · ${selectedJob.customerName}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => { setJobId(""); setJobSearch(""); }}
                  className="text-xs text-[#F97316] hover:text-[#fb923c] flex-shrink-0 ml-3"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                  <input
                    type="text"
                    value={jobSearch}
                    onChange={e => setJobSearch(e.target.value)}
                    placeholder="Search by plate or job number…"
                    className="w-full pl-9 pr-4 py-2.5 bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg text-sm text-white placeholder-gray-600 transition"
                  />
                </div>
                <div className="mt-2 max-h-36 overflow-y-auto space-y-1">
                  {jobs.length === 0 ? (
                    <p className="text-xs text-gray-500 px-1 py-2">No active job cards right now.</p>
                  ) : jobMatches.length === 0 ? (
                    <p className="text-xs text-gray-500 px-1 py-2">No matching vehicles.</p>
                  ) : jobMatches.map(job => (
                    <button
                      key={job.id}
                      onClick={() => setJobId(job.id)}
                      className="w-full text-left bg-[#0B1120] hover:bg-white/5 border border-white/5 rounded-lg px-3 py-2 transition"
                    >
                      <p className="text-sm text-white truncate">{jobLabel(job)}</p>
                      <p className="text-xs text-gray-500">{job.jobNumber}</p>
                    </button>
                  ))}
                </div>
              </>
            )}
            <p className="mt-1.5 text-[11px] text-gray-600">
              Linking a vehicle bills this part straight onto that job's invoice once approved.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Note <span className="text-gray-600 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Anything the storekeeper should know"
              className="w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
            </p>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm flex items-center justify-center gap-2"
          >
            <Plus className="h-4 w-4" />
            {saving ? "Sending…" : "Send Request"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = "pending" | "history";

export default function InventoryRequestsPage() {
  const { currentUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const canRequest = usePermission("inventory.request");
  const canApprove = usePermission("inventory.approveRequests");

  const centerId = currentUser?.centerId ?? "";
  const uid = currentUser?.uid ?? "";
  const userName = currentUser?.displayName ?? currentUser?.email ?? "Staff";

  const [requests, setRequests] = useState<InventoryRequest[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [activeJobs, setActiveJobs] = useState<ServiceJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("pending");
  const [modalOpen, setModalOpen] = useState(searchParams.get("new") === "1");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Clear the ?new=1 deep link once the modal has opened, so a refresh or a
  // back-navigation doesn't reopen it.
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      searchParams.delete("new");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!centerId) return;
    const q = query(
      collection(db, "servicecenters", centerId, "inventoryRequests"),
      orderBy("createdAt", "desc"),
    );
    return onSnapshot(q, snap => {
      setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryRequest)));
      setLoading(false);
    }, () => setLoading(false));
  }, [centerId]);

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(collection(db, "servicecenters", centerId, "inventory"), snap => {
      setItems(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() } as InventoryItem))
          .filter(i => !i.isArchived),
      );
    }, () => setItems([]));
  }, [centerId]);

  // Open job cards, for the "which vehicle is this for" picker on a new
  // request. Only jobs still in progress make sense — a done/delivered job's
  // invoice shouldn't be reopened by a part request.
  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(
      query(
        collection(db, "servicecenters", centerId, "jobs"),
        where("status", "in", ["pending", "in_progress"]),
      ),
      snap => setActiveJobs(snap.docs.map(d => ({ id: d.id, ...d.data() } as ServiceJob))),
      () => setActiveJobs([]),
    );
  }, [centerId]);

  // Someone who can only request sees their own requests; approvers see them all.
  const mine = useMemo(
    () => (canApprove ? requests : requests.filter(r => r.requestedBy === uid)),
    [requests, canApprove, uid],
  );
  const visible = useMemo(
    () => mine.filter(r => (tab === "pending" ? r.status === "pending" : r.status !== "pending")),
    [mine, tab],
  );
  const pendingCount = mine.filter(r => r.status === "pending").length;

  async function decide(req: InventoryRequest, status: Exclude<InventoryRequestStatus, "pending">) {
    if (!canApprove) return;
    setBusyId(req.id);
    setError("");
    try {
      const item = items.find(i => i.id === req.itemId);
      if (status === "approved") {
        if (!item) {
          setError(`${req.itemName} is no longer in inventory — reject the request instead.`);
          return;
        }
        if (item.currentQty < req.quantity) {
          setError(`Only ${item.currentQty} ${item.unit} of ${item.name} left — restock before issuing.`);
          return;
        }
        // Issue the parts: deduct the stock, then record the decision.
        const qtyAfter = parseFloat((item.currentQty - req.quantity).toFixed(2));
        await safeUpdateDoc(doc(db, "servicecenters", centerId, "inventory", item.id), {
          currentQty: qtyAfter,
          issueLog: arrayUnion({
            requestId: req.id,
            issuedQty: req.quantity,
            issuedTo: req.requestedByName,
            issuedBy: userName,
            jobRef: req.jobRef ?? null,
            unitPrice: serviceCenterPriceOf(item),
            timestamp: Timestamp.now(),
          }),
          updatedAt: Timestamp.now(),
        });
        logMovement({
          centerId,
          itemId: item.id,
          itemName: item.name,
          unit: item.unit,
          type: "issue",
          qtyChange: -req.quantity,
          qtyBefore: item.currentQty,
          qtyAfter,
          refId: req.id,
          refLabel: req.jobRef ? `Issued to ${req.requestedByName} · ${req.jobRef}` : `Issued to ${req.requestedByName}`,
          performedBy: uid,
          performedByName: userName,
        }).catch(() => {});

        // A request tied to a job bills the part straight onto that job's
        // invoice, so the customer is charged for it the same way any other
        // part added from the job card would be.
        if (req.jobId) {
          await billIssuedPartToJob(centerId, req.jobId, {
            itemId: item.id,
            itemName: item.name,
            quantity: req.quantity,
            unitPrice: serviceCenterPriceOf(item),
            ...(item.partNumber ? { partNumber: item.partNumber } : {}),
          });
        }
      }
      await safeUpdateDoc(doc(db, "servicecenters", centerId, "inventoryRequests", req.id), {
        status,
        issuedQty: status === "approved" ? req.quantity : null,
        reviewedAt: Timestamp.now(),
        reviewedBy: uid,
        reviewedByName: userName,
      });
    } catch {
      setError("Could not update the request. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  if (!canRequest && !canApprove) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <ClipboardList className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to view inventory requests.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<ClipboardList className="w-5 h-5" />}
        title="Inventory Requests"
        actions={
          canRequest ? (
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2.5 rounded-xl transition text-sm"
            >
              <Plus className="h-4 w-4" />
              New Request
            </button>
          ) : undefined
        }
        below={
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-3">
            <div className="flex bg-white/5 rounded-lg p-0.5 gap-0.5 w-fit">
              {(["pending", "history"] as Tab[]).map(key => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                    tab === key ? "bg-orange-500 text-white" : "text-gray-400 hover:text-white"
                  }`}
                >
                  {key === "pending" ? `Pending (${pendingCount})` : "History"}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {error && (
          <div className="mb-4 flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-300">{error}</p>
          </div>
        )}

        {loading ? (
          <LoadingBlock className="py-20" />
        ) : visible.length === 0 ? (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3">
            <Package className="h-12 w-12 text-gray-700" />
            <p className="text-gray-400 font-medium">
              {tab === "pending" ? "No pending requests" : "Nothing in the history yet"}
            </p>
            {tab === "pending" && canRequest && (
              <button
                onClick={() => setModalOpen(true)}
                className="mt-2 flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2 rounded-xl transition text-sm"
              >
                <Plus className="h-4 w-4" /> Request an Item
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map(req => {
              const item = items.find(i => i.id === req.itemId);
              return (
                <div key={req.id} className="bg-[#162032] border border-white/10 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-white truncate">
                        {req.itemName}
                        <span className="text-gray-400 font-normal"> · {req.quantity} {req.unit}</span>
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {req.requestedByName}
                        {req.plateNumber ? ` · ${req.plateNumber}${req.jobNumber ? ` (${req.jobNumber})` : ""}` : req.jobRef ? ` · ${req.jobRef}` : ""}
                        {req.createdAt ? ` · ${req.createdAt.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
                      </p>
                      {req.note && <p className="text-xs text-gray-400 mt-1.5">{req.note}</p>}
                      {canApprove && req.status === "pending" && (
                        <p className="text-xs text-gray-500 mt-1.5">
                          {stockLabel(item)}
                          {(() => {
                            const value = requestValue(item, req.quantity);
                            return value != null
                              ? ` · ${formatLKR(value)} at service-center price`
                              : "";
                          })()}
                        </p>
                      )}
                      {req.status !== "pending" && req.reviewedByName && (
                        <p className="text-xs text-gray-500 mt-1.5">
                          {req.status === "approved" ? "Issued" : "Rejected"} by {req.reviewedByName}
                        </p>
                      )}
                    </div>
                    <span className={`flex-shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${STATUS_CHIP[req.status]}`}>
                      {STATUS_LABEL[req.status]}
                    </span>
                  </div>

                  {canApprove && req.status === "pending" && (
                    <div className="flex gap-2 mt-4">
                      <button
                        onClick={() => decide(req, "approved")}
                        disabled={busyId === req.id}
                        className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 px-3 py-2 rounded-lg transition disabled:opacity-60"
                      >
                        <Check className="h-3.5 w-3.5" /> Approve &amp; Issue
                      </button>
                      <button
                        onClick={() => decide(req, "rejected")}
                        disabled={busyId === req.id}
                        className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-3 py-2 rounded-lg transition disabled:opacity-60"
                      >
                        <X className="h-3.5 w-3.5" /> Reject
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modalOpen && canRequest && (
        <NewRequestModal
          items={items}
          jobs={activeJobs}
          centerId={centerId}
          requestedBy={uid}
          requestedByName={userName}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
