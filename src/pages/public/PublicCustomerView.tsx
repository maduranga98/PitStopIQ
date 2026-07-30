import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, where, Timestamp,
} from "firebase/firestore";
import { httpsCallable, type FunctionsError } from "firebase/functions";
import {
  Car, Clock, Receipt, Droplet, AlertCircle, Download, MessageSquarePlus, CheckCircle,
  CalendarClock, ChevronRight, ChevronLeft, PlusCircle, X, User,
} from "lucide-react";
import { Link } from "react-router-dom";
import { db, functions } from "../../config/firebase";
import type {
  Customer, Vehicle, ServiceJob, Invoice, CustomerFeedbackType,
  Booking, BookingStatus, WeeklyHours, CalendarOverrides,
} from "../../types/auth";
import { LoadingScreen } from "../../components/LoadingProgress";
import {
  PAYMENT_METHOD_LABEL, clearanceLabel, customerVisiblePayments, isConfirmed,
} from "../../lib/invoicePayments";
import {
  isCenterOpen, getAvailableSlots, toIsoDate, DEFAULT_WEEKLY_HOURS, DEFAULT_SLOT_DURATION_MINUTES,
  type ScheduleConfig,
} from "../../lib/scheduling";
import { DEFAULT_VEHICLE_TYPES } from "../../lib/vehicleOptions";

const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  requested: "Awaiting confirmation",
  confirmed: "Confirmed",
  rejected: "Rejected",
  checked_in: "Checked in",
  cancelled: "Cancelled",
  no_show: "No show",
  converted: "In progress",
};

const BOOKING_STATUS_COLOR: Record<BookingStatus, string> = {
  requested: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  confirmed: "bg-green-500/10 text-green-400 border-green-500/25",
  rejected: "bg-red-500/10 text-red-400 border-red-500/25",
  checked_in: "bg-blue-500/10 text-blue-400 border-blue-500/25",
  cancelled: "bg-gray-500/10 text-gray-400 border-gray-500/25",
  no_show: "bg-gray-500/10 text-gray-400 border-gray-500/25",
  converted: "bg-green-500/10 text-green-400 border-green-500/25",
};

const BOOKING_ACTIVE_STATUSES: BookingStatus[] = ["requested", "confirmed", "checked_in"];
const BOOKING_LOOKAHEAD_DAYS = 21;

function BookingSection({
  centerId, customerId, vehicles, schedule,
}: {
  centerId: string;
  customerId: string;
  vehicles: Vehicle[];
  schedule: ScheduleConfig;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [bookings, setBookings] = useState<Booking[]>([]);

  const [vehicleId, setVehicleId] = useState("");
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [newPlate, setNewPlate] = useState("");
  const [newMake, setNewMake] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newVehicleType, setNewVehicleType] = useState("");

  const [notes, setNotes] = useState("");

  const [selectedDate, setSelectedDate] = useState("");
  const [takenSlots, setTakenSlots] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [loadingSlots, setLoadingSlots] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const selectedVehicle = vehicles.find((v) => v.id === vehicleId);

  // Live status of this customer's own bookings — visible whether or not the
  // booking flow itself is open.
  useEffect(() => {
    const unsub = onSnapshot(
      query(
        collection(db, "servicecenters", centerId, "bookings"),
        where("customerId", "==", customerId),
        orderBy("createdAt", "desc"),
      ),
      (snap) => setBookings(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Booking))),
      () => setBookings([]),
    );
    return unsub;
  }, [centerId, customerId]);

  const openDates = useMemo(() => {
    const dates: string[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < BOOKING_LOOKAHEAD_DAYS && dates.length < 10; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      if (isCenterOpen(schedule, d)) dates.push(toIsoDate(d));
    }
    return dates;
  }, [schedule]);

  async function selectDate(date: string) {
    setSelectedDate(date);
    setSelectedSlot("");
    setLoadingSlots(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, "servicecenters", centerId, "bookings"),
          where("requestedDate", "==", date),
          where("status", "in", BOOKING_ACTIVE_STATUSES),
        ),
      );
      setTakenSlots(snap.docs.map((d) => d.data().requestedSlot as string));
    } catch {
      setTakenSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }

  const availableSlots = selectedDate ? getAvailableSlots(schedule, selectedDate, takenSlots) : [];

  function resetFlow() {
    setStep(1); setVehicleId(""); setAddingVehicle(false);
    setNewPlate(""); setNewMake(""); setNewModel(""); setNewVehicleType("");
    setNotes(""); setSelectedDate(""); setSelectedSlot("");
    setSubmitted(false); setSubmitError("");
  }

  async function handleSubmit() {
    if (!selectedDate || !selectedSlot) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const fn = httpsCallable(functions, "submitBooking");
      await fn({
        centerId,
        customerId,
        vehicleId: addingVehicle ? undefined : vehicleId,
        newVehicle: addingVehicle
          ? { plateNumber: newPlate, make: newMake, model: newModel, vehicleType: newVehicleType }
          : undefined,
        serviceIds: [],
        customServiceNotes: notes,
        requestedDate: selectedDate,
        requestedSlot: selectedSlot,
      });
      setSubmitted(true);
    } catch (err) {
      setSubmitError((err as FunctionsError)?.message || "Could not submit your booking. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const canGoStep2 = addingVehicle ? newPlate.trim().length > 0 : Boolean(vehicleId);
  const canSubmit = Boolean(selectedDate && selectedSlot);

  return (
    <div className="bg-[#162032] border border-white/10 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <CalendarClock className="w-4 h-4 text-[#F97316]" />
        <h2 className="font-semibold">Bookings</h2>
      </div>

      {/* Existing booking status */}
      {bookings.length > 0 && (
        <div className="space-y-2 mb-4">
          {bookings.slice(0, 3).map((b) => (
            <div key={b.id} className="bg-[#0B1120] border border-white/5 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-medium">{b.plateNumber} · {b.requestedDate} at {b.requestedSlot}</p>
                {b.rejectionReason && b.status === "rejected" && (
                  <p className="text-xs text-gray-500 mt-0.5">Reason: {b.rejectionReason}</p>
                )}
              </div>
              <span className={`text-[11px] px-2 py-0.5 rounded-full border ${BOOKING_STATUS_COLOR[b.status]}`}>
                {BOOKING_STATUS_LABEL[b.status]}
              </span>
            </div>
          ))}
        </div>
      )}

      {!open && (
        <button
          onClick={() => { resetFlow(); setOpen(true); }}
          className="w-full flex items-center justify-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition"
        >
          <PlusCircle className="w-4 h-4" /> Book a Service
        </button>
      )}

      {open && !submitted && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              {["Vehicle", "Date & Time", "Confirm"].map((label, i) => (
                <span key={label} className={`px-2 py-1 rounded-full ${step === i + 1 ? "bg-orange-500/20 text-orange-300" : ""}`}>
                  {label}
                </span>
              ))}
            </div>
            <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Step 1: Vehicle */}
          {step === 1 && (
            <div className="space-y-3">
              {!addingVehicle && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {vehicles.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => setVehicleId(v.id)}
                      className={`text-left text-sm px-3 py-2.5 rounded-lg border transition-colors ${
                        vehicleId === v.id
                          ? "bg-orange-500/10 border-orange-500 text-orange-300"
                          : "bg-white/5 border-white/10 text-gray-300 hover:border-white/30"
                      }`}
                    >
                      <span className="font-mono font-bold block">{v.plateNumber}</span>
                      <span className="text-xs text-gray-500">{[v.make, v.model].filter(Boolean).join(" ")}</span>
                    </button>
                  ))}
                  <button
                    onClick={() => setAddingVehicle(true)}
                    className="flex items-center justify-center gap-1.5 text-sm px-3 py-2.5 rounded-lg border border-dashed border-white/20 text-gray-400 hover:text-white hover:border-white/40"
                  >
                    <PlusCircle className="w-4 h-4" /> Add a new vehicle
                  </button>
                </div>
              )}
              {addingVehicle && (
                <div className="space-y-2">
                  <input
                    value={newPlate}
                    onChange={(e) => setNewPlate(e.target.value.toUpperCase())}
                    placeholder="Plate number"
                    className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={newMake}
                      onChange={(e) => setNewMake(e.target.value)}
                      placeholder="Make"
                      className="bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                    />
                    <input
                      value={newModel}
                      onChange={(e) => setNewModel(e.target.value)}
                      placeholder="Model"
                      className="bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                    />
                  </div>
                  <select
                    value={newVehicleType}
                    onChange={(e) => setNewVehicleType(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                  >
                    <option value="" className="bg-[#162032]">Vehicle type…</option>
                    {DEFAULT_VEHICLE_TYPES.map((t) => (
                      <option key={t} value={t} className="bg-[#162032] capitalize">{t}</option>
                    ))}
                  </select>
                  <button onClick={() => setAddingVehicle(false)} className="text-xs text-gray-400 hover:text-white">
                    ← Choose an existing vehicle instead
                  </button>
                </div>
              )}
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Describe the issue or anything the workshop should know… (optional)"
                className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 resize-none"
              />
              <button
                onClick={() => setStep(2)}
                disabled={!canGoStep2}
                className="w-full flex items-center justify-center gap-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white py-2 rounded-lg text-sm font-medium"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Step 2: Date & time */}
          {step === 2 && (
            <div className="space-y-3">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {openDates.map((date) => (
                  <button
                    key={date}
                    onClick={() => selectDate(date)}
                    className={`flex-shrink-0 text-xs px-3 py-2 rounded-lg border transition-colors ${
                      selectedDate === date
                        ? "bg-orange-500 border-orange-500 text-white"
                        : "bg-white/5 border-white/10 text-gray-300 hover:border-white/30"
                    }`}
                  >
                    {date}
                  </button>
                ))}
                {openDates.length === 0 && (
                  <p className="text-xs text-gray-500">No open dates in the next {BOOKING_LOOKAHEAD_DAYS} days.</p>
                )}
              </div>

              {selectedDate && (
                <div>
                  {loadingSlots ? (
                    <p className="text-xs text-gray-500">Loading times…</p>
                  ) : availableSlots.length === 0 ? (
                    <p className="text-xs text-gray-500">No slots available on this date — try another day.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {availableSlots.map((slot) => (
                        <button
                          key={slot}
                          onClick={() => setSelectedSlot(slot)}
                          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                            selectedSlot === slot
                              ? "bg-orange-500 border-orange-500 text-white"
                              : "bg-white/5 border-white/10 text-gray-300 hover:border-white/30"
                          }`}
                        >
                          {slot}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => setStep(1)} className="flex-1 bg-white/10 hover:bg-white/20 text-white py-2 rounded-lg text-sm flex items-center justify-center gap-1.5">
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={!canSubmit}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white py-2 rounded-lg text-sm font-medium"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Confirm */}
          {step === 3 && (
            <div className="space-y-3">
              <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm space-y-1">
                <p><span className="text-gray-500">Vehicle:</span> {addingVehicle ? newPlate : selectedVehicle?.plateNumber}</p>
                <p><span className="text-gray-500">Date:</span> {selectedDate} at {selectedSlot}</p>
                {notes && <p><span className="text-gray-500">Notes:</span> {notes}</p>}
              </div>
              {submitError && <p className="text-xs text-red-400">{submitError}</p>}
              <div className="flex gap-2">
                <button onClick={() => setStep(2)} className="flex-1 bg-white/10 hover:bg-white/20 text-white py-2 rounded-lg text-sm flex items-center justify-center gap-1.5">
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium"
                >
                  {submitting ? "Sending request…" : "Request Booking"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {open && submitted && (
        <div className="text-center py-4 space-y-3">
          <CheckCircle className="w-8 h-8 text-green-400 mx-auto" />
          <p className="text-sm font-medium">Booking requested!</p>
          <p className="text-xs text-gray-400">We've received your request. You'll be notified once the workshop confirms it.</p>
          <button
            onClick={() => { setOpen(false); resetFlow(); }}
            className="text-xs text-[#F97316] hover:text-[#fb923c]"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}

const FEEDBACK_MAX_LEN = 1000;

function FeedbackForm({ centerId, customerId }: { centerId: string; customerId: string }) {
  const [type, setType] = useState<CustomerFeedbackType>("suggestion");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    const trimmed = message.trim();
    if (!trimmed) {
      setError("Enter a message before sending.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const fn = httpsCallable<
        { centerId: string; customerId: string; type: CustomerFeedbackType; message: string },
        { success: boolean; feedbackId: string }
      >(functions, "submitCustomerFeedback");
      await fn({ centerId, customerId, type, message: trimmed });
      setMessage("");
      setSent(true);
    } catch (err) {
      const msg = (err as FunctionsError)?.message;
      setError(msg || "Could not send your message. Please try again.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="bg-[#162032] border border-white/10 rounded-2xl p-5">
        <div className="flex items-center gap-2 text-green-400">
          <CheckCircle className="w-5 h-5" />
          <p className="text-sm font-medium">Thank you — your message has been sent.</p>
        </div>
        <button
          onClick={() => setSent(false)}
          className="text-xs text-[#F97316] hover:text-[#fb923c] mt-3"
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <div className="bg-[#162032] border border-white/10 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <MessageSquarePlus className="w-4 h-4 text-[#F97316]" />
        <h2 className="font-semibold">Complaints &amp; Suggestions</h2>
      </div>
      <div className="flex gap-2 mb-3">
        {(["suggestion", "complaint"] as CustomerFeedbackType[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setType(v)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition border ${
              type === v
                ? "bg-orange-500/20 text-orange-400 border-orange-500/40"
                : "bg-white/5 text-gray-400 border-white/10 hover:text-white"
            }`}
          >
            {v}
          </button>
        ))}
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value.slice(0, FEEDBACK_MAX_LEN))}
        rows={4}
        placeholder={type === "complaint" ? "Tell us what went wrong…" : "Tell us how we can do better…"}
        className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 resize-none"
      />
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-xs text-gray-500">{message.length}/{FEEDBACK_MAX_LEN}</span>
      </div>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      <button
        onClick={handleSubmit}
        disabled={sending || !message.trim()}
        className="mt-3 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm transition"
      >
        {sending ? "Sending…" : "Send"}
      </button>
    </div>
  );
}

function formatPhone(phone: string) {
  if (phone.startsWith("+94") && phone.length === 12) {
    const local = "0" + phone.slice(3);
    return local.slice(0, 3) + " " + local.slice(3, 6) + " " + local.slice(6);
  }
  return phone;
}

function formatDate(ts?: Timestamp | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

interface CenterInfo {
  name: string;
  phone?: string;
  logoUrl?: string;
  weeklyHours?: WeeklyHours;
  slotDurationMinutes?: number;
  calendarOverrides?: CalendarOverrides;
}

type TabId = "details" | "history" | "invoices" | "bookings" | "feedback";

const TABS: { id: TabId; label: string; icon: typeof Car }[] = [
  { id: "details", label: "Details", icon: User },
  { id: "history", label: "Service History", icon: Clock },
  { id: "invoices", label: "Invoices", icon: Receipt },
  { id: "bookings", label: "Bookings", icon: CalendarClock },
  { id: "feedback", label: "Complaints & Suggestions", icon: MessageSquarePlus },
];

export default function PublicCustomerView() {
  const { centerId, customerId } = useParams<{ centerId: string; customerId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as TabId) ?? "details";
  function setTab(id: TabId) { setSearchParams({ tab: id }, { replace: true }); }
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [center, setCenter] = useState<CenterInfo | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [jobs, setJobs] = useState<ServiceJob[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  useEffect(() => {
    if (!centerId || !customerId) return;
    (async () => {
      try {
        const [custSnap, centerSnap, vehSnap, jobsSnap, invSnap] = await Promise.all([
          getDoc(doc(db, "servicecenters", centerId, "customers", customerId)),
          getDoc(doc(db, "servicecenters", centerId)),
          getDocs(query(
            collection(db, "servicecenters", centerId, "vehicles"),
            where("customerId", "==", customerId),
          )),
          getDocs(query(
            collection(db, "servicecenters", centerId, "jobs"),
            where("customerId", "==", customerId),
          )),
          getDocs(query(
            collection(db, "servicecenters", centerId, "invoices"),
            where("customerId", "==", customerId),
          )),
        ]);

        if (!custSnap.exists() || custSnap.data()?.isDeleted) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        setCustomer({ id: custSnap.id, ...custSnap.data() } as Customer);
        if (centerSnap.exists()) {
          const d = centerSnap.data();
          setCenter({
            name: d.name, phone: d.phone, logoUrl: d.logoUrl,
            weeklyHours: d.weeklyHours, slotDurationMinutes: d.slotDurationMinutes,
            calendarOverrides: d.calendarOverrides,
          });
        }
        setVehicles(vehSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Vehicle)).filter((v) => !v.isDeleted));
        const sortByCreated = <T extends { createdAt?: Timestamp | null }>(arr: T[]) =>
          arr.sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
        setJobs(sortByCreated(jobsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ServiceJob))));
        setInvoices(sortByCreated(invSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Invoice))));
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [centerId, customerId]);

  if (loading) {
    return (
      <LoadingScreen />
    );
  }

  if (notFound || !customer) {
    return (
      <div className="min-h-screen bg-[#0B1120] text-white flex flex-col items-center justify-center gap-3 p-6">
        <AlertCircle className="w-10 h-10 text-gray-500" />
        <p className="text-gray-400 text-center">Record not found or no longer available.</p>
      </div>
    );
  }

  const oilsUsed = Array.from(new Set(vehicles.flatMap((v) => [
    v.oilBrand && v.oilGrade ? `${v.oilBrand} ${v.oilGrade}` : v.oilBrand || v.oilGrade,
  ].filter(Boolean) as string[])));

  return (
    <div className="min-h-screen bg-[#0B1120] text-white pb-16">
      {/* Header */}
      <div className="border-b border-white/10 bg-[#162032]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 flex items-center gap-4">
          {center?.logoUrl
            ? <img src={center.logoUrl} alt="" className="w-10 h-10 rounded-lg object-contain bg-white/5" />
            : <div className="w-10 h-10 rounded-lg bg-[#F97316]/20 flex items-center justify-center">
                <Car className="w-5 h-5 text-[#F97316]" />
              </div>
          }
          <div>
            <p className="text-xs text-gray-400">{center?.name ?? "Service Center"}</p>
            <h1 className="text-lg font-bold">{customer.name}</h1>
          </div>
        </div>
        <div className="max-w-3xl mx-auto px-2 sm:px-6 overflow-x-auto">
          <div className="flex min-w-max border-t border-white/5">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 sm:px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? "border-[#F97316] text-white"
                      : "border-transparent text-gray-400 hover:text-gray-200"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {activeTab === "details" && (
          <>
            {/* Profile */}
            <div className="bg-[#162032] border border-white/10 rounded-2xl p-5">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Contact</p>
              <p className="text-sm text-gray-200">{formatPhone(customer.phone)}</p>
              <p className="text-xs text-gray-500 mt-3">
                Customer since {formatDate(customer.createdAt)}
              </p>
            </div>

            {/* Vehicles */}
            <div className="bg-[#162032] border border-white/10 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Car className="w-4 h-4 text-[#F97316]" />
                <h2 className="font-semibold">Vehicles ({vehicles.length})</h2>
              </div>
              {vehicles.length === 0 ? (
                <p className="text-sm text-gray-500">No vehicles registered.</p>
              ) : (
                <div className="space-y-2">
                  {vehicles.map((v) => (
                    <div key={v.id} className="bg-[#0B1120] border border-white/5 rounded-xl px-4 py-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-mono font-bold">{v.plateNumber}</span>
                        <span className="text-xs text-gray-400">
                          {[v.make, v.model].filter(Boolean).join(" ")}
                          {v.vehicleType ? ` · ${v.vehicleType}` : ""}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-gray-500 flex gap-3 flex-wrap">
                        <span>Current: {v.currentMileageKm?.toLocaleString() ?? "—"} km</span>
                        <span>Next service: {v.nextServiceMileageKm?.toLocaleString() ?? "—"} km</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Oils */}
            {oilsUsed.length > 0 && (
              <div className="bg-[#162032] border border-white/10 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Droplet className="w-4 h-4 text-[#F97316]" />
                  <h2 className="font-semibold">Oils Used</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {oilsUsed.map((o) => (
                    <span key={o} className="text-xs bg-white/5 border border-white/10 rounded-full px-3 py-1">
                      {o}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === "history" && (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-[#F97316]" />
              <h2 className="font-semibold">Service History</h2>
            </div>
            {jobs.length === 0 ? (
              <p className="text-sm text-gray-500">No services recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {jobs.map((j) => {
                  const all = [...(j.services ?? []), ...(j.customServices ?? [])];
                  return (
                    <div key={j.id} className="border-l-2 border-[#F97316]/40 pl-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-sm font-medium">{j.plateNumber}</span>
                        <span className="text-xs text-gray-500">{formatDate(j.createdAt)}</span>
                      </div>
                      {all.length > 0 && (
                        <p className="text-xs text-gray-400 mt-0.5">{all.join(", ")}</p>
                      )}
                      {j.mileageOut != null && (
                        <p className="text-xs text-gray-500 mt-0.5">Mileage out: {j.mileageOut.toLocaleString()} km</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === "invoices" && (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Receipt className="w-4 h-4 text-[#F97316]" />
              <h2 className="font-semibold">Invoices</h2>
            </div>
            {(() => {
              // Only show invoices that have been finalized (SMS-sent) or paid — drafts stay private.
              const visibleInvoices = invoices.filter((i) => i.finalized || i.smsSent || i.status === "paid" || i.status === "partial");
              if (visibleInvoices.length === 0) {
                return <p className="text-sm text-gray-500">No invoices yet.</p>;
              }
              return (
                <div className="space-y-2">
                  {visibleInvoices.map((inv) => (
                    <div key={inv.id} className="bg-[#0B1120] border border-white/5 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{inv.invoiceNumber}</p>
                        <p className="text-xs text-gray-500">{inv.plateNumber} · {formatDate(inv.createdAt)}</p>
                        {/* Only cheques and credit are worth surfacing here — the
                            customer knows they handed over cash. */}
                        {customerVisiblePayments(inv.payments).length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {customerVisiblePayments(inv.payments).map((p) => (
                              <span
                                key={p.id}
                                className={`text-[11px] px-2 py-0.5 rounded-full border ${
                                  isConfirmed(p)
                                    ? "bg-green-500/10 text-green-400 border-green-500/25"
                                    : "bg-amber-500/10 text-amber-400 border-amber-500/25"
                                }`}
                              >
                                {PAYMENT_METHOD_LABEL[p.method]} · {clearanceLabel(p)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-sm font-semibold">LKR {inv.grandTotal?.toLocaleString() ?? "0"}</p>
                          <p className={`text-xs capitalize ${
                            inv.status === "paid" ? "text-green-400" :
                            inv.status === "partial" ? "text-amber-400" : "text-gray-400"
                          }`}>{inv.status}</p>
                        </div>
                        <Link
                          to={`/c/${centerId}/${customerId}/invoice/${inv.id}`}
                          className="flex items-center gap-1.5 bg-[#F97316]/10 hover:bg-[#F97316]/20 border border-[#F97316]/20 text-[#F97316] text-xs px-3 py-2 rounded-lg transition"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {activeTab === "bookings" && (
          <BookingSection
            centerId={centerId!}
            customerId={customerId!}
            vehicles={vehicles}
            schedule={{
              weeklyHours: center?.weeklyHours ?? DEFAULT_WEEKLY_HOURS,
              slotDurationMinutes: center?.slotDurationMinutes ?? DEFAULT_SLOT_DURATION_MINUTES,
              calendarOverrides: center?.calendarOverrides ?? {},
            }}
          />
        )}

        {activeTab === "feedback" && (
          <FeedbackForm centerId={centerId!} customerId={customerId!} />
        )}

        <div className="flex flex-col items-center gap-1.5 mt-6 pt-6 border-t border-white/5">
          <div className="flex items-center gap-2 text-gray-400">
            <div className="w-7 h-7 rounded-lg bg-[#F97316]/20 flex items-center justify-center">
              <Car className="w-4 h-4 text-[#F97316]" />
            </div>
            <span className="text-sm">
              Powered by <span className="text-[#F97316] font-bold tracking-wide">PitStop IQ</span>
            </span>
          </div>
          <p className="text-[11px] text-gray-600">Smart service center management · View-only record</p>
        </div>
      </div>
    </div>
  );
}
