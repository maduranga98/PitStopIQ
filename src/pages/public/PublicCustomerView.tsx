import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  collection, doc, getDoc, getDocs, query, where, Timestamp,
} from "firebase/firestore";
import { Car, Clock, Receipt, Droplet, AlertCircle, Download } from "lucide-react";
import { Link } from "react-router-dom";
import { db } from "../../config/firebase";
import type { Customer, Vehicle, ServiceJob, Invoice } from "../../types/auth";

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
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#F97316] border-t-transparent rounded-full animate-spin" />
      </div>
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

        <p className="text-center text-xs text-gray-600 mt-4">
          Powered by PitStop IQ · View-only record
        </p>
      </div>
    </div>
  );
}
