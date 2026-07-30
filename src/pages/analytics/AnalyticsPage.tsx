import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { BarChart2, TrendingUp, Users, MessageSquare, Building2, Truck, PieChart } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { ServiceCenter } from "../../types/auth";
import DateRangePicker from "./components/DateRangePicker";
import RevenueReport from "./RevenueReport";
import ProfitabilityReport from "./ProfitabilityReport";
import ServicesReport from "./ServicesReport";
import CustomerReport from "./CustomerReport";
import SupplierReport from "./SupplierReport";
import DistributorReport from "./DistributorReport";
import SmsAnalytics from "./SmsAnalytics";
import { useTranslation } from "react-i18next";
import { usePermission } from "../../contexts/PermissionsContext";
import { LoadingScreen } from "../../components/LoadingProgress";

type Tab = "revenue" | "profitability" | "services" | "customers" | "suppliers" | "distributors" | "sms";

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
  // ?tab= lets the Suppliers and Distributors pages link straight at their own
  // report instead of dropping the owner on Revenue to hunt for it.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(requestedTab ?? "revenue");
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
  const canViewProfitability = usePermission("jobs.viewProfitability");
  const canViewServices    = usePermission("analytics.viewServiceFrequency");
  const canViewCustomers   = usePermission("analytics.viewRevenue"); // reuse revenue perm for customer report
  const canViewSmsAnalytics = usePermission("analytics.viewSmsAnalytics");
  // Buying and dealer analysis follow the permission that already governs the
  // underlying records, so nobody sees money through a report they couldn't see
  // on the page it came from.
  const canViewSuppliers    = usePermission("suppliers.viewSupplies");
  const canViewDistributors = usePermission("distributors.viewOrders");
  const canViewAny = canViewRevenue || canViewProfitability || canViewServices || canViewSmsAnalytics
    || canViewSuppliers || canViewDistributors;

  if (loadingCenter) {
    return (
      <LoadingScreen />
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
    { id: "revenue",      label: "Revenue",      icon: <TrendingUp className="h-4 w-4" />,    show: canViewRevenue },
    { id: "profitability", label: "Profitability", icon: <PieChart className="h-4 w-4" />,    show: canViewProfitability },
    { id: "services",     label: "Services",     icon: <BarChart2 className="h-4 w-4" />,     show: canViewServices },
    { id: "customers",    label: "Customers",    icon: <Users className="h-4 w-4" />,         show: canViewCustomers },
    { id: "suppliers",    label: "Suppliers",    icon: <Building2 className="h-4 w-4" />,     show: canViewSuppliers },
    { id: "distributors", label: "Dealers",      icon: <Truck className="h-4 w-4" />,         show: canViewDistributors },
    { id: "sms",          label: "SMS",          icon: <MessageSquare className="h-4 w-4" />, show: canViewSmsAnalytics },
  ];

  const tabs = allTabs.filter(t => t.show);
  // A ?tab= for a report this role can't see (or a stale link) falls back to
  // the first tab they can.
  const activeTab = tabs.some(t => t.id === tab) ? tab : tabs[0]?.id;

  function selectTab(next: Tab) {
    setTab(next);
    setSearchParams(next === "revenue" ? {} : { tab: next }, { replace: true });
  }

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
        <div className="flex flex-wrap gap-1 bg-[#162032] p-1 rounded-xl border border-white/5 w-fit">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => selectTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === t.id
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
        {activeTab === "revenue" && (
          <RevenueReport centerId={centerId} startDate={startDate} endDate={endDate} />
        )}
        {activeTab === "profitability" && (
          <ProfitabilityReport centerId={centerId} startDate={startDate} endDate={endDate} />
        )}
        {activeTab === "services" && (
          <ServicesReport centerId={centerId} startDate={startDate} endDate={endDate} />
        )}
        {activeTab === "customers" && (
          <CustomerReport centerId={centerId} startDate={startDate} endDate={endDate} />
        )}
        {activeTab === "suppliers" && (
          <SupplierReport centerId={centerId} startDate={startDate} endDate={endDate} />
        )}
        {activeTab === "distributors" && (
          <DistributorReport centerId={centerId} startDate={startDate} endDate={endDate} />
        )}
        {activeTab === "sms" && (
          <SmsAnalytics centerId={centerId} startDate={startDate} endDate={endDate} smsQuotaUsed={serviceCenter?.smsQuotaUsed ?? 0} smsQuotaLimit={serviceCenter?.smsQuotaLimit ?? 200} />
        )}
      </div>
    </div>
  );
}
