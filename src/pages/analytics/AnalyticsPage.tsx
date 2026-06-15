import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { BarChart2, TrendingUp, Users, MessageSquare, Lock } from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { UserRole, ServiceCenter } from "../../types/auth";
import DateRangePicker from "./components/DateRangePicker";
import RevenueReport from "./RevenueReport";
import ServicesReport from "./ServicesReport";
import CustomerReport from "./CustomerReport";
import SmsAnalytics from "./SmsAnalytics";

type Tab = "revenue" | "services" | "customers" | "sms";

function thisMonthRange(): [Date, Date] {
  const now = new Date();
  return [
    new Date(now.getFullYear(), now.getMonth(), 1),
    new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
  ];
}

const canAccessRevenue = (role?: UserRole) =>
  role === "Owner" || role === "Manager" || role === "Cashier";

const canAccessFull = (role?: UserRole) =>
  role === "Owner" || role === "Manager";

export default function AnalyticsPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [serviceCenter, setServiceCenter] = useState<ServiceCenter | null>(null);
  const [loadingCenter, setLoadingCenter] = useState(true);
  const [tab, setTab] = useState<Tab>("revenue");
  const [startDate, setStartDate] = useState<Date>(thisMonthRange()[0]);
  const [endDate, setEndDate] = useState<Date>(thisMonthRange()[1]);

  useEffect(() => {
    if (!currentUser?.centerId) return;
    getDoc(doc(db, "servicecenters", currentUser.centerId)).then((snap) => {
      if (snap.exists()) setServiceCenter({ id: snap.id, ...snap.data() } as ServiceCenter);
      setLoadingCenter(false);
    });
  }, [currentUser?.centerId]);

  const role = currentUser?.role;

  useEffect(() => {
    if (!loadingCenter && serviceCenter) {
      if (!canAccessRevenue(role)) navigate("/");
    }
  }, [loadingCenter, serviceCenter, role, navigate]);

  if (loadingCenter) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    );
  }

  const isPro = serviceCenter?.plan === "pro";

  if (!isPro) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center p-6">
        <div className="bg-[#162032] rounded-2xl border border-white/5 p-10 max-w-md text-center space-y-4">
          <div className="bg-[#F97316]/10 rounded-full p-4 w-16 h-16 flex items-center justify-center mx-auto">
            <Lock className="h-8 w-8 text-[#F97316]" />
          </div>
          <h2 className="text-2xl font-bold text-white">Analytics is a Pro feature</h2>
          <p className="text-gray-400 text-sm leading-relaxed">
            Upgrade to the Pro plan to unlock Revenue Reports, Service Insights, Customer Analytics,
            SMS Analytics, and CSV exports.
          </p>
          <div className="text-xs text-gray-600">Current plan: Basic (LKR 3,999/mo)</div>
          <button
            onClick={() => navigate("/")}
            className="mt-2 w-full bg-[#F97316] hover:bg-[#ea6c0a] text-white font-semibold py-2.5 rounded-xl transition"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode; allowed: boolean }[] = (
    [
      { id: "revenue" as Tab, label: "Revenue", icon: <TrendingUp className="h-4 w-4" />, allowed: canAccessRevenue(role) },
      { id: "services" as Tab, label: "Services", icon: <BarChart2 className="h-4 w-4" />, allowed: canAccessFull(role) },
      { id: "customers" as Tab, label: "Customers", icon: <Users className="h-4 w-4" />, allowed: canAccessFull(role) },
      { id: "sms" as Tab, label: "SMS", icon: <MessageSquare className="h-4 w-4" />, allowed: canAccessFull(role) },
    ] satisfies { id: Tab; label: string; icon: React.ReactNode; allowed: boolean }[]
  ).filter((t) => t.allowed);

  const centerId = currentUser!.centerId ?? "";

  return (
    <div className="min-h-screen bg-[#0B1120]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="bg-[#F97316]/10 rounded-xl p-2.5">
            <BarChart2 className="h-6 w-6 text-[#F97316]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Analytics & Reports</h1>
            <p className="text-sm text-gray-500">Business intelligence for {serviceCenter?.name}</p>
          </div>
        </div>

        {/* Date Range */}
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onChange={(s, e) => { setStartDate(s); setEndDate(e); }}
        />

        {/* Tabs */}
        <div className="flex gap-1 bg-[#162032] p-1 rounded-xl border border-white/5 w-fit">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t.id
                  ? "bg-[#F97316] text-white"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Report Content */}
        {tab === "revenue" && (
          <RevenueReport centerId={centerId} startDate={startDate} endDate={endDate} />
        )}
        {tab === "services" && (
          <ServicesReport centerId={centerId} startDate={startDate} endDate={endDate} />
        )}
        {tab === "customers" && (
          <CustomerReport centerId={centerId} startDate={startDate} endDate={endDate} />
        )}
        {tab === "sms" && (
          <SmsAnalytics centerId={centerId} startDate={startDate} endDate={endDate} smsQuotaUsed={serviceCenter?.smsQuotaUsed ?? 0} smsQuotaLimit={serviceCenter?.smsQuotaLimit ?? 200} />
        )}
      </div>
    </div>
  );
}
