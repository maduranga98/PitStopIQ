import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { BarChart2, TrendingUp, Users, MessageSquare } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { ServiceCenter } from "../../types/auth";
import DateRangePicker from "./components/DateRangePicker";
import RevenueReport from "./RevenueReport";
import ServicesReport from "./ServicesReport";
import CustomerReport from "./CustomerReport";
import SmsAnalytics from "./SmsAnalytics";
import { useTranslation } from "react-i18next";
import { usePermission } from "../../contexts/PermissionsContext";

type Tab = "revenue" | "services" | "customers" | "sms";

function thisMonthRange(): [Date, Date] {
  const now = new Date();
  return [
    new Date(now.getFullYear(), now.getMonth(), 1),
    new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
  ];
}

export default function AnalyticsPage() {
  const { currentUser } = useAuth();
  const { t } = useTranslation();
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
    }).catch(() => setLoadingCenter(false));
  }, [currentUser?.centerId]);

  const canViewRevenue     = usePermission("analytics.viewRevenue");
  const canViewServices    = usePermission("analytics.viewServiceFrequency");
  const canViewCustomers   = usePermission("analytics.viewRevenue"); // reuse revenue perm for customer report
  const canViewSmsAnalytics = usePermission("analytics.viewSmsAnalytics");
  const canViewAny = canViewRevenue || canViewServices || canViewSmsAnalytics;

  if (loadingCenter) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    );
  }

  if (!canViewAny) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <BarChart2 className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to view Analytics.</p>
        </div>
      </div>
    );
  }

  type TabDef = { id: Tab; label: string; icon: React.ReactNode; show: boolean };
  const allTabs: TabDef[] = [
    { id: "revenue",   label: "Revenue",   icon: <TrendingUp className="h-4 w-4" />,    show: canViewRevenue },
    { id: "services",  label: "Services",  icon: <BarChart2 className="h-4 w-4" />,     show: canViewServices },
    { id: "customers", label: "Customers", icon: <Users className="h-4 w-4" />,         show: canViewCustomers },
    { id: "sms",       label: "SMS",       icon: <MessageSquare className="h-4 w-4" />, show: canViewSmsAnalytics },
  ];

  const tabs = allTabs.filter(t => t.show);

  const centerId = currentUser!.centerId ?? "";

  return (
    <div className="min-h-screen bg-[#0B1120]">
      <PageHeader
        icon={<BarChart2 className="w-5 h-5" />}
        title={t("analytics.title")}
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

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
