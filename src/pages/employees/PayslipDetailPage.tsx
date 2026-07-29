import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { doc, onSnapshot, getDoc } from "firebase/firestore";
import { ArrowLeft, Printer, MessageCircle } from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { Payslip, StaffMember } from "../../types/auth";
import { LoadingScreen } from "../../components/LoadingProgress";

function formatLKR(n: number): string {
  return `LKR ${n.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function monthLabel(ym: string): string {
  return new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-LK", { month: "long", year: "numeric" });
}

export default function PayslipDetailPage() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { staffId, payslipId } = useParams<{ staffId: string; payslipId: string }>();
  const centerId = currentUser?.centerId ?? "";
  const viewerRole = currentUser?.role;
  const canManage = viewerRole === "Owner" || viewerRole === "Manager";

  const [payslip, setPayslip] = useState<Payslip | null>(null);
  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [centerName, setCenterName] = useState("");
  const [centerLogoUrl, setCenterLogoUrl] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!centerId || !staffId || !payslipId) return;
    return onSnapshot(
      doc(db, "servicecenters", centerId, "staff", staffId, "payslips", payslipId),
      snap => {
        setPayslip(snap.exists() ? ({ id: snap.id, ...snap.data() } as Payslip) : null);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [centerId, staffId, payslipId]);

  useEffect(() => {
    if (!centerId || !staffId) return;
    getDoc(doc(db, "servicecenters", centerId, "staff", staffId)).then(snap => {
      if (snap.exists()) setStaff({ id: snap.id, ...snap.data() } as StaffMember);
    });
    getDoc(doc(db, "servicecenters", centerId)).then(snap => {
      if (snap.exists()) {
        setCenterName(snap.data().name ?? "");
        setCenterLogoUrl(snap.data().logoUrl ?? "");
      }
    });
  }, [centerId, staffId]);

  const handlePrint = () => window.print();

  const handleWhatsApp = () => {
    if (!payslip || !staff) return;
    const phone = staff.phone.replace(/[^0-9]/g, "");
    const number = phone.startsWith("0") ? `94${phone.slice(1)}` : phone;
    const msg = encodeURIComponent(
      `Hi ${staff.fullName}, your payslip for ${monthLabel(payslip.month)} is ready. Net pay: ${formatLKR(payslip.netPay)}. - ${centerName}`,
    );
    window.open(`https://wa.me/${number}?text=${msg}`, "_blank");
  };

  if (loading) return <LoadingScreen />;
  if (!payslip || !staff) return null;
  if (!canManage && currentUser?.uid !== staff.authUid) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <p className="text-white font-semibold mb-1">Access Denied</p>
          <p className="text-gray-400 text-sm">You don't have permission to view this payslip.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #payslip-print, #payslip-print * { visibility: visible !important; }
          #payslip-print {
            position: fixed; inset: 0;
            background: white; color: black;
            padding: 32px; font-family: sans-serif;
          }
        }
      `}</style>

      <div className="min-h-screen bg-[#0B1120] text-white print:hidden">
        <div className="border-b border-white/10 bg-[#0B1120]/80 backdrop-blur sticky top-0 z-10">
          <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate(`/employees/${staffId}`)} className="text-gray-400 hover:text-white">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wider">Payslip</div>
                <div className="text-lg font-bold">{monthLabel(payslip.month)}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg text-sm"
              >
                <Printer className="w-4 h-4" />
                <span className="hidden sm:inline">Print / PDF</span>
              </button>
              <button
                onClick={handleWhatsApp}
                className="flex items-center gap-2 bg-green-600/20 hover:bg-green-600/30 text-green-400 px-3 py-1.5 rounded-lg text-sm"
              >
                <MessageCircle className="w-4 h-4" />
                <span className="hidden sm:inline">Share</span>
              </button>
            </div>
          </div>
        </div>

        <div className="max-w-3xl mx-auto px-4 py-6">
          <PayslipBody payslip={payslip} staff={staff} centerName={centerName} centerLogoUrl={centerLogoUrl} />
        </div>
      </div>

      <div id="payslip-print" className="hidden print:block">
        <PayslipBody payslip={payslip} staff={staff} centerName={centerName} centerLogoUrl={centerLogoUrl} printMode />
      </div>
    </>
  );
}

function PayslipBody({
  payslip, staff, centerName, centerLogoUrl, printMode,
}: {
  payslip: Payslip;
  staff: StaffMember;
  centerName: string;
  centerLogoUrl: string;
  printMode?: boolean;
}) {
  const textColor = printMode ? "text-black" : "text-white";
  const subColor = printMode ? "text-gray-600" : "text-gray-400";
  const cardBg = printMode ? "border border-gray-300" : "bg-[#162032] border border-white/10";

  return (
    <div className={`${cardBg} rounded-2xl p-6 space-y-6`}>
      <div className="flex items-center justify-between gap-4 pb-4 border-b border-gray-500/20">
        <div className="flex items-center gap-3">
          {centerLogoUrl && <img src={centerLogoUrl} alt="" className="w-10 h-10 rounded-lg object-contain bg-white/5" />}
          <div>
            <p className={`text-sm font-semibold ${textColor}`}>{centerName}</p>
            <p className={`text-xs ${subColor}`}>Payslip — {monthLabel(payslip.month)}</p>
          </div>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
          payslip.status === "finalized" ? "bg-green-500/15 text-green-400" : "bg-amber-500/15 text-amber-400"
        }`}>
          {payslip.status === "finalized" ? "Finalized" : "Draft"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Employee" value={staff.fullName} textColor={textColor} subColor={subColor} />
        <Field label="Role" value={payslip.role} textColor={textColor} subColor={subColor} />
        <Field label="Employee ID" value={staff.employeeId || "—"} textColor={textColor} subColor={subColor} />
        <Field label="Month" value={monthLabel(payslip.month)} textColor={textColor} subColor={subColor} />
      </div>

      <div>
        <p className={`text-xs font-semibold ${subColor} mb-2`}>This Month's Summary</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryTile label="Attendance" value={`${payslip.attendanceRate}%`} printMode={printMode} />
          <SummaryTile label="Days Present" value={String(payslip.daysPresent)} printMode={printMode} />
          <SummaryTile label="Total Jobs" value={String(payslip.totalJobs)} printMode={printMode} />
          <SummaryTile label="Total Hours" value={`${payslip.totalHours}h`} printMode={printMode} />
        </div>
      </div>

      <div className="space-y-2">
        <Line label="Basic Salary" value={payslip.basicSalary} textColor={textColor} subColor={subColor} />
        {payslip.commissionAmount > 0 && (
          <Line
            label={`Commission${payslip.commissionRate ? ` (${payslip.commissionRate}%)` : ""}`}
            value={payslip.commissionAmount} textColor={textColor} subColor={subColor}
          />
        )}
        {payslip.allowances.map((a, i) => (
          <Line key={i} label={a.label} value={a.amount} textColor={textColor} subColor={subColor} />
        ))}
        <div className={`flex items-center justify-between pt-2 border-t ${printMode ? "border-gray-300" : "border-white/10"} font-semibold`}>
          <span className={textColor}>Gross Pay</span>
          <span className={textColor}>{formatLKR(payslip.grossPay)}</span>
        </div>

        {payslip.deductions.length > 0 && (
          <>
            <div className="pt-3" />
            {payslip.deductions.map((d, i) => (
              <Line key={i} label={d.label} value={-d.amount} textColor={textColor} subColor={subColor} />
            ))}
            <div className={`flex items-center justify-between ${subColor}`}>
              <span>Total Deductions</span>
              <span>-{formatLKR(payslip.totalDeductions)}</span>
            </div>
          </>
        )}

        <div className={`flex items-center justify-between pt-3 border-t ${printMode ? "border-gray-300" : "border-white/10"} text-lg font-bold`}>
          <span className={textColor}>Net Pay</span>
          <span className={textColor}>{formatLKR(payslip.netPay)}</span>
        </div>
      </div>

      {payslip.notes && (
        <div className={`rounded-lg p-3 text-sm ${subColor} ${printMode ? "border border-gray-300" : "bg-white/5"}`}>
          {payslip.notes}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, textColor, subColor }: { label: string; value: string; textColor: string; subColor: string }) {
  return (
    <div>
      <p className={`text-xs ${subColor}`}>{label}</p>
      <p className={`text-sm font-medium ${textColor} mt-0.5`}>{value}</p>
    </div>
  );
}

function SummaryTile({ label, value, printMode }: { label: string; value: string; printMode?: boolean }) {
  return (
    <div className={`rounded-xl px-3 py-2.5 ${printMode ? "border border-gray-300" : "bg-[#0B1120] border border-white/5"}`}>
      <p className={`text-[11px] ${printMode ? "text-gray-600" : "text-gray-500"}`}>{label}</p>
      <p className={`text-sm font-bold ${printMode ? "text-black" : "text-white"} mt-0.5`}>{value}</p>
    </div>
  );
}

function Line({ label, value, textColor, subColor }: { label: string; value: number; textColor: string; subColor: string }) {
  return (
    <div className={`flex items-center justify-between text-sm ${subColor}`}>
      <span>{label}</span>
      <span className={textColor}>{formatLKR(value)}</span>
    </div>
  );
}
