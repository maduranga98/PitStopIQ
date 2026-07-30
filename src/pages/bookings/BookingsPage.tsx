import { useEffect, useMemo, useState } from "react";
import {
  collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, where, Timestamp,
} from "firebase/firestore";
import {
  CalendarClock, Check, X, UserCheck, PlusCircle, Wrench, Loader2, Car,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { safeAddDoc, safeUpdateDoc } from "../../lib/firestoreWrite";
import { createServiceJob } from "../../lib/jobCreation";
import {
  isCenterOpen, getAvailableSlots, toIsoDate, DEFAULT_WEEKLY_HOURS, DEFAULT_SLOT_DURATION_MINUTES,
  type ScheduleConfig,
} from "../../lib/scheduling";
import { staffDisplayName } from "../../lib/jobTechnicians";
import type {
  Booking, BookingStatus, Customer, Vehicle, ServicePriceItem, StaffMember,
} from "../../types/auth";

const STATUS_LABEL: Record<BookingStatus, string> = {
  requested: "Awaiting confirmation",
  confirmed: "Confirmed",
  rejected: "Rejected",
  checked_in: "Checked in",
  cancelled: "Cancelled",
  no_show: "No show",
  converted: "In progress",
};

const STATUS_COLOR: Record<BookingStatus, string> = {
  requested: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  confirmed: "bg-green-500/10 text-green-400 border-green-500/25",
  rejected: "bg-red-500/10 text-red-400 border-red-500/25",
  checked_in: "bg-blue-500/10 text-blue-400 border-blue-500/25",
  cancelled: "bg-gray-500/10 text-gray-400 border-gray-500/25",
  no_show: "bg-gray-500/10 text-gray-400 border-gray-500/25",
  converted: "bg-green-500/10 text-green-400 border-green-500/25",
};

const ACTIVE_STATUSES: BookingStatus[] = ["requested", "confirmed", "checked_in"];

function buildBookingSms(kind: "confirmed" | "rejected", booking: Booking, centerName: string, reason?: string): string {
  if (kind === "confirmed") {
    return `Hi ${booking.customerName}, your booking for ${booking.plateNumber} on ${booking.requestedDate} at ${booking.requestedSlot} is confirmed. - ${centerName}`;
  }
  return `Hi ${booking.customerName}, your booking request for ${booking.plateNumber} on ${booking.requestedDate} at ${booking.requestedSlot} could not be confirmed${reason ? ` (${reason})` : ""}. Please contact us to reschedule. - ${centerName}`;
}

export default function BookingsPage() {
  const { currentUser } = useAuth();
  const centerId = currentUser?.centerId;
  const canAssign = usePermission("bookings.assign");
  const canCancel = usePermission("bookings.cancel");
  const canCreate = usePermission("bookings.create");

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState<ServicePriceItem[]>([]);
  const [technicians, setTechnicians] = useState<StaffMember[]>([]);
  const [centerName, setCenterName] = useState("");
  const [schedule, setSchedule] = useState<ScheduleConfig>({
    weeklyHours: DEFAULT_WEEKLY_HOURS, slotDurationMinutes: DEFAULT_SLOT_DURATION_MINUTES,
  });

  const [reviewing, setReviewing] = useState<Booking | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!centerId) return;
    const unsub = onSnapshot(
      query(collection(db, "servicecenters", centerId, "bookings"), orderBy("requestedDate", "asc")),
      (snap) => {
        setBookings(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Booking)));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [centerId]);

  useEffect(() => {
    if (!centerId) return;
    getDocs(collection(db, "servicecenters", centerId, "servicePrices")).then((snap) => {
      setCatalog(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ServicePriceItem)));
    });
    getDocs(query(
      collection(db, "servicecenters", centerId, "staff"),
      where("role", "==", "Technician"),
      where("active", "==", true),
    )).then((snap) => {
      setTechnicians(snap.docs.map((d) => ({ id: d.id, ...d.data() } as StaffMember)));
    });
    getDoc(doc(db, "servicecenters", centerId)).then((snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      setCenterName(d.name ?? "");
      setSchedule({
        weeklyHours: d.weeklyHours ?? DEFAULT_WEEKLY_HOURS,
        slotDurationMinutes: d.slotDurationMinutes ?? DEFAULT_SLOT_DURATION_MINUTES,
        calendarOverrides: d.calendarOverrides ?? {},
      });
    });
  }, [centerId]);

  const serviceName = (id: string) => catalog.find((c) => c.id === id)?.name ?? id;

  const grouped = useMemo(() => {
    const active = bookings.filter((b) => ACTIVE_STATUSES.includes(b.status));
    const byDate = new Map<string, Booking[]>();
    for (const b of active) {
      const list = byDate.get(b.requestedDate) ?? [];
      list.push(b);
      byDate.set(b.requestedDate, list);
    }
    return Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [bookings]);

  async function sendBookingSms(booking: Booking, kind: "confirmed" | "rejected", reason?: string) {
    if (!centerId || !booking.customerPhone) return;
    await safeAddDoc(collection(db, "servicecenters", centerId, "smsLogs"), {
      customerId: booking.customerId,
      customerName: booking.customerName,
      phone: booking.customerPhone,
      plateNumber: booking.plateNumber,
      messageType: kind === "confirmed" ? "BookingConfirmed" : "BookingRejected",
      status: "sent",
      message: buildBookingSms(kind, booking, centerName || "PitStop IQ", reason),
      sentAt: Timestamp.now(),
    });
  }

  async function handleConfirm(booking: Booking, technicianId: string, slot: string) {
    if (!centerId) return;
    setBusyId(booking.id);
    try {
      const tech = technicians.find((t) => t.id === technicianId);
      await safeUpdateDoc(doc(db, "servicecenters", centerId, "bookings", booking.id), {
        status: "confirmed",
        requestedSlot: slot,
        assignedTechnicianId: tech?.id ?? null,
        assignedTechnicianName: tech ? staffDisplayName(tech) : null,
        updatedAt: Timestamp.now(),
      });
      await sendBookingSms({ ...booking, requestedSlot: slot }, "confirmed");
      setReviewing(null);
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(booking: Booking, reason: string) {
    if (!centerId) return;
    setBusyId(booking.id);
    try {
      await safeUpdateDoc(doc(db, "servicecenters", centerId, "bookings", booking.id), {
        status: "rejected",
        rejectionReason: reason,
        updatedAt: Timestamp.now(),
      });
      await sendBookingSms(booking, "rejected", reason);
      setReviewing(null);
    } finally {
      setBusyId(null);
    }
  }

  async function handleConvert(booking: Booking) {
    if (!centerId) return;
    setBusyId(booking.id);
    try {
      const vehSnap = await getDoc(doc(db, "servicecenters", centerId, "vehicles", booking.vehicleId));
      if (!vehSnap.exists()) return;
      const vehicle = { id: vehSnap.id, ...vehSnap.data() } as Vehicle;

      const tech = technicians.find((t) => t.id === booking.assignedTechnicianId);
      const jobId = await createServiceJob({
        centerId,
        customerId: booking.customerId,
        customerName: booking.customerName,
        customerPhone: booking.customerPhone,
        vehicle,
        mileageIn: vehicle.currentMileageKm ?? 0,
        crew: tech ? [{ id: tech.id, name: staffDisplayName(tech) }] : [],
        departmentId: tech?.departmentId ?? null,
        departmentName: tech?.departmentName ?? null,
        services: booking.serviceIds.map(serviceName),
        customServices: booking.customServiceNotes ? [booking.customServiceNotes] : [],
        catalog,
      });

      await safeUpdateDoc(doc(db, "servicecenters", centerId, "bookings", booking.id), {
        status: "converted",
        linkedJobId: jobId,
        updatedAt: Timestamp.now(),
      });
    } finally {
      setBusyId(null);
    }
  }

  if (!centerId) return null;

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<CalendarClock className="w-5 h-5" />}
        title="Bookings"
        actions={canCreate && (
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 bg-[#F97316] hover:bg-[#ea6c0f] text-white text-sm font-semibold px-3 py-2 rounded-lg transition"
          >
            <PlusCircle className="w-4 h-4" /> New Walk-in Booking
          </button>
        )}
      />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : grouped.length === 0 ? (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 text-center text-gray-500 text-sm">
            No booking requests for this date.
          </div>
        ) : (
          grouped.map(([date, list]) => (
            <div key={date} className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-300">{date}</h2>
              <div className="space-y-2">
                {list.sort((a, b) => a.requestedSlot.localeCompare(b.requestedSlot)).map((b) => (
                  <div key={b.id} className="bg-[#162032] border border-white/10 rounded-xl p-4 flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold">{b.plateNumber}</span>
                        <span className="text-xs text-gray-400">{b.requestedSlot}</span>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${STATUS_COLOR[b.status]}`}>
                          {STATUS_LABEL[b.status]}
                        </span>
                        <span className="text-[11px] text-gray-500 capitalize">{b.createdVia.replace("_", " ")}</span>
                      </div>
                      <p className="text-sm text-gray-300 mt-1">{b.customerName} · {b.customerPhone}</p>
                      {b.serviceIds.length > 0 && (
                        <p className="text-xs text-gray-500 mt-0.5">{b.serviceIds.map(serviceName).join(", ")}</p>
                      )}
                      {b.customServiceNotes && (
                        <p className="text-xs text-gray-500 mt-0.5">Note: {b.customServiceNotes}</p>
                      )}
                      {b.assignedTechnicianName && (
                        <p className="text-xs text-gray-500 mt-0.5">Technician: {b.assignedTechnicianName}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {b.status === "requested" && (canAssign || canCancel) && (
                        <button
                          onClick={() => setReviewing(b)}
                          disabled={busyId === b.id}
                          className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
                        >
                          Review
                        </button>
                      )}
                      {b.status === "confirmed" && canAssign && (
                        <button
                          onClick={() => handleConvert(b)}
                          disabled={busyId === b.id}
                          className="flex items-center gap-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
                        >
                          {busyId === b.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
                          Check In &amp; Start Job
                        </button>
                      )}
                      {b.status === "converted" && b.linkedJobId && (
                        <a
                          href={`/services/${b.linkedJobId}`}
                          className="flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300"
                        >
                          <Wrench className="w-3.5 h-3.5" /> View Job
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {reviewing && (
        <ReviewModal
          booking={reviewing}
          technicians={technicians}
          onClose={() => setReviewing(null)}
          onConfirm={handleConfirm}
          onReject={handleReject}
          busy={busyId === reviewing.id}
        />
      )}

      {creating && centerId && (
        <WalkInBookingModal
          centerId={centerId}
          catalog={catalog}
          schedule={schedule}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

// ── Review modal (confirm / reject) ─────────────────────────────────────────
function ReviewModal({
  booking, technicians, onClose, onConfirm, onReject, busy,
}: {
  booking: Booking;
  technicians: StaffMember[];
  onClose: () => void;
  onConfirm: (booking: Booking, technicianId: string, slot: string) => void;
  onReject: (booking: Booking, reason: string) => void;
  busy: boolean;
}) {
  const [technicianId, setTechnicianId] = useState(booking.assignedTechnicianId ?? "");
  const [slot, setSlot] = useState(booking.requestedSlot);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#162032] border border-white/10 rounded-2xl w-full max-w-md p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white">Review Booking</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-gray-300">
          {booking.customerName} · {booking.plateNumber} · {booking.requestedDate}
        </p>

        {!rejecting ? (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold block mb-1">Time</label>
              <input
                type="time"
                value={slot}
                onChange={(e) => setSlot(e.target.value)}
                className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold block mb-1">Technician (optional)</label>
              <select
                value={technicianId}
                onChange={(e) => setTechnicianId(e.target.value)}
                className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
              >
                <option value="" className="bg-[#162032]">Unassigned</option>
                {technicians.map((t) => (
                  <option key={t.id} value={t.id} className="bg-[#162032]">{staffDisplayName(t)}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setRejecting(true)}
                disabled={busy}
                className="flex-1 bg-white/10 hover:bg-white/20 text-white py-2 rounded-lg text-sm"
              >
                Reject
              </button>
              <button
                onClick={() => onConfirm(booking, technicianId, slot)}
                disabled={busy}
                className="flex-1 flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Confirm
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold block">
              Reason for rejecting (sent to the customer)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 resize-none"
            />
            <div className="flex gap-2">
              <button onClick={() => setRejecting(false)} className="flex-1 bg-white/10 hover:bg-white/20 text-white py-2 rounded-lg text-sm">
                Back
              </button>
              <button
                onClick={() => onReject(booking, reason.trim())}
                disabled={busy || !reason.trim()}
                className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium"
              >
                {busy ? "Rejecting…" : "Reject Booking"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Walk-in booking modal ────────────────────────────────────────────────────
// Front-desk-created booking: an existing customer/vehicle, created straight
// into "confirmed" — it skips the "requested" review step since staff are
// creating it themselves, on the spot.
function WalkInBookingModal({
  centerId, catalog, schedule, onClose,
}: {
  centerId: string;
  catalog: ServicePriceItem[];
  schedule: ScheduleConfig;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [takenSlots, setTakenSlots] = useState<string[]>([]);
  const [slot, setSlot] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getDocs(query(collection(db, "servicecenters", centerId, "customers"), where("isDeleted", "==", false)))
      .then((snap) => setCustomers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Customer))));
  }, [centerId]);

  useEffect(() => {
    if (!customer) return;
    getDocs(query(
      collection(db, "servicecenters", centerId, "vehicles"),
      where("customerId", "==", customer.id),
      where("isDeleted", "==", false),
    )).then((snap) => setVehicles(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Vehicle))));
  }, [customer, centerId]);

  const openDates = useMemo(() => {
    const dates: string[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < 21 && dates.length < 10; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      if (isCenterOpen(schedule, d)) dates.push(toIsoDate(d));
    }
    return dates;
  }, [schedule]);

  async function selectDate(d: string) {
    setDate(d);
    setSlot("");
    const snap = await getDocs(query(
      collection(db, "servicecenters", centerId, "bookings"),
      where("requestedDate", "==", d),
      where("status", "in", ACTIVE_STATUSES),
    ));
    setTakenSlots(snap.docs.map((d) => d.data().requestedSlot as string));
  }

  const availableSlots = date ? getAvailableSlots(schedule, date, takenSlots) : [];

  function toggleService(id: string) {
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleSubmit() {
    if (!customer || !vehicleId || !date || !slot) return;
    const vehicle = vehicles.find((v) => v.id === vehicleId);
    if (!vehicle) return;
    setSaving(true);
    setError("");
    try {
      await safeAddDoc(collection(db, "servicecenters", centerId, "bookings"), {
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        vehicleId: vehicle.id,
        plateNumber: vehicle.plateNumber,
        requestedDate: date,
        requestedSlot: slot,
        serviceIds,
        status: "confirmed",
        createdVia: "walk_in",
        centerId,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      onClose();
    } catch {
      setError("Could not create the booking. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const filteredCustomers = search.trim()
    ? customers.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()) || c.phone.includes(search.trim()))
    : customers.slice(0, 20);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#162032] border border-white/10 rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white">New Walk-in Booking</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        {!customer ? (
          <div className="space-y-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer by name or phone…"
              className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
            />
            <div className="max-h-56 overflow-y-auto space-y-1">
              {filteredCustomers.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCustomer(c)}
                  className="w-full text-left px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm"
                >
                  <span className="text-white">{c.name}</span>
                  <span className="text-xs text-gray-500 ml-2">{c.phone}</span>
                </button>
              ))}
              {filteredCustomers.length === 0 && <p className="text-xs text-gray-500 px-1">No customers found.</p>}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
              <span>{customer.name} · {customer.phone}</span>
              <button onClick={() => { setCustomer(null); setVehicleId(""); setVehicles([]); }} className="text-xs text-gray-400 hover:text-white">Change</button>
            </div>

            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold block mb-1.5">Vehicle</label>
              <div className="grid grid-cols-2 gap-2">
                {vehicles.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setVehicleId(v.id)}
                    className={`flex items-center gap-1.5 text-left text-sm px-3 py-2 rounded-lg border ${
                      vehicleId === v.id ? "bg-orange-500/10 border-orange-500 text-orange-300" : "bg-white/5 border-white/10 text-gray-300"
                    }`}
                  >
                    <Car className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="font-mono">{v.plateNumber}</span>
                  </button>
                ))}
                {vehicles.length === 0 && <p className="text-xs text-gray-500">No vehicles for this customer.</p>}
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold block mb-1.5">Services</label>
              <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                {catalog.filter((s) => s.isActive !== false).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => toggleService(s.id)}
                    className={`text-left text-sm px-3 py-2 rounded-lg border truncate ${
                      serviceIds.includes(s.id) ? "bg-orange-500/10 border-orange-500 text-orange-300" : "bg-white/5 border-white/10 text-gray-300"
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold block mb-1.5">Date</label>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {openDates.map((d) => (
                  <button
                    key={d}
                    onClick={() => selectDate(d)}
                    className={`flex-shrink-0 text-xs px-3 py-2 rounded-lg border ${
                      date === d ? "bg-orange-500 border-orange-500 text-white" : "bg-white/5 border-white/10 text-gray-300"
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {date && (
              <div className="flex flex-wrap gap-2">
                {availableSlots.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSlot(s)}
                    className={`text-xs px-3 py-1.5 rounded-lg border ${
                      slot === s ? "bg-orange-500 border-orange-500 text-white" : "bg-white/5 border-white/10 text-gray-300"
                    }`}
                  >
                    {s}
                  </button>
                ))}
                {availableSlots.length === 0 && <p className="text-xs text-gray-500">No slots available.</p>}
              </div>
            )}

            {error && <p className="text-xs text-red-400">{error}</p>}

            <button
              onClick={handleSubmit}
              disabled={saving || !vehicleId || !date || !slot}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white py-2.5 rounded-lg text-sm font-medium"
            >
              {saving ? "Creating…" : "Create Booking"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
