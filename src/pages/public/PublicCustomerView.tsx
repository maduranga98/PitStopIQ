import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  collection, doc, getDoc, getDocs, query, where, Timestamp,
} from "firebase/firestore";
import { httpsCallable, type FunctionsError } from "firebase/functions";
import { Car, Clock, Receipt, Droplet, AlertCircle, Download, MessageSquarePlus, CheckCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { db, functions } from "../../config/firebase";
import type { Customer, Vehicle, ServiceJob, Invoice, CustomerFeedbackType } from "../../types/auth";
import { LoadingScreen } from "../../components/LoadingProgress";
import {
  PAYMENT_METHOD_LABEL, clearanceLabel, customerVisiblePayments, isConfirmed,
} from "../../lib/invoicePayments";

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
}

export default function PublicCustomerView() {
  const { centerId, customerId } = useParams<{ centerId: string; customerId: string }>();
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
          setCenter({ name: d.name, phone: d.phone, logoUrl: d.logoUrl });
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
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
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

        {/* Service history */}
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

        {/* Invoices */}
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

        {/* Complaints & Suggestions */}
        <FeedbackForm centerId={centerId!} customerId={customerId!} />

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
