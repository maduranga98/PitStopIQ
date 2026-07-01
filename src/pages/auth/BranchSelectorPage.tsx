import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Building2, MapPin, Phone, AlertTriangle, Upload, X, ArrowRight, MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../contexts/AuthContext";
import type { ServiceCenter } from "../../types/auth";
import type { Timestamp } from "firebase/firestore";
import { uploadPaymentSlip, monthlyAmountFor } from "../../lib/paymentSlip";

function daysLeft(ts?: Timestamp): number | null {
  if (!ts) return null;
  const ms = ts.toMillis() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

function StatusBadge({ center }: { center: ServiceCenter }) {
  if (center.status === "blocked") {
    return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">Expired — Upload Slip</span>;
  }
  if (center.status === "grace_period") {
    const d = daysLeft(center.graceDeadline);
    return (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">
        Grace period{d !== null && d >= 0 ? ` — ${d}d left` : ""}
      </span>
    );
  }
  if (center.status === "pending_payment") {
    return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400">Payment under review</span>;
  }
  const d = daysLeft(center.currentPeriodEnd);
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">
      Active{d !== null ? ` (${d} days left)` : ""}
    </span>
  );
}

export default function BranchSelectorPage() {
  const { currentUser, loading, branches, switchBranch } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [switching, setSwitching] = useState<string | null>(null);
  const [uploadFor, setUploadFor] = useState<ServiceCenter | null>(null);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0B1120]">
        <div className="w-6 h-6 border-2 border-[#F97316] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!currentUser) return <Navigate to="/login" replace />;
  if (branches.length < 2) return <Navigate to="/" replace />;

  async function handleContinue(centerId: string) {
    setSwitching(centerId);
    await switchBranch(centerId);
    navigate("/");
  }

  const totalSms = branches.reduce((s, b) => s + (b.smsQuotaUsed ?? 0), 0);
  const warnings = branches.filter((b) => {
    if (b.status === "grace_period" || b.status === "blocked") return true;
    const d = daysLeft(b.currentPeriodEnd);
    return d !== null && d <= 7 && d >= 0 && b.status === "active";
  });

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <div className="border-b border-white/10 bg-[#0B1120]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <img src="/logo.png" alt="PitStop IQ" className="h-7 w-auto" onError={(e) => (e.currentTarget.style.display = "none")} />
          <span className="text-base font-extrabold tracking-tight text-white">
            PITSTOP <span className="text-[#F97316]">IQ</span>
          </span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div>
          <h1 className="text-lg font-bold text-white">{t("branchSelector.title")}</h1>
          <p className="text-sm text-gray-400 mt-1">{t("branchSelector.subtitle", { count: branches.length })}</p>
        </div>

        {/* Aggregate overview */}
        <div className="bg-[#162032] border border-white/10 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">{t("branchSelector.overview")}</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider">{t("branchSelector.totalBranches")}</div>
              <div className="text-xl font-bold text-white mt-1">{branches.length}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider">{t("branchSelector.totalSmsThisMonth")}</div>
              <div className="text-xl font-bold text-white mt-1">{totalSms.toLocaleString()}</div>
            </div>
          </div>
          {warnings.length > 0 && (
            <div className="mt-4 space-y-1.5">
              {warnings.map((b) => (
                <div key={b.id} className="flex items-center gap-2 text-xs text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>
                    {b.branchName ?? b.name}:{" "}
                    {b.status === "blocked"
                      ? "subscription expired, access blocked"
                      : b.status === "grace_period"
                      ? "in grace period, upload a slip soon"
                      : "subscription expires soon"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Branch list */}
        <div className="space-y-3">
          {branches.map((branch) => (
            <div
              key={branch.id}
              className={`bg-[#162032] border rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                branch.status === "blocked" ? "border-red-500/20" : "border-white/10"
              }`}
            >
              <div className="flex items-start gap-3 min-w-0">
                <div className="p-2 rounded-lg mt-0.5 flex-shrink-0 bg-[#F97316]/10">
                  <Building2 className="w-4 h-4 text-[#F97316]" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-white">{branch.branchName ?? branch.name}</p>
                    {!branch.isBranch && (
                      <span className="text-xs font-bold bg-white/10 text-gray-300 px-2 py-0.5 rounded-full">MAIN</span>
                    )}
                    <StatusBadge center={branch} />
                  </div>
                  <div className="mt-1.5 space-y-1">
                    <div className="flex items-center gap-1.5 text-xs text-gray-400">
                      <MapPin className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{branch.address}{branch.district ? `, ${branch.district}` : ""}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-gray-400">
                      <Phone className="w-3 h-3 flex-shrink-0" />
                      <span>{branch.phone}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {branch.status !== "active" && (
                  <button
                    onClick={() => setUploadFor(branch)}
                    className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-gray-300 hover:text-white hover:border-white/20 transition"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {t("branchSelector.uploadSlip")}
                  </button>
                )}
                <button
                  onClick={() => handleContinue(branch.id)}
                  disabled={switching === branch.id}
                  className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white transition"
                >
                  {t("branchSelector.continue")}
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs text-gray-500 justify-center pt-2">
          <MessageSquare className="w-3.5 h-3.5" />
          <span>{t("branchSelector.contactToAdd")}</span>
        </div>
      </div>

      {uploadFor && (
        <UploadSlipModal branch={uploadFor} onClose={() => setUploadFor(null)} />
      )}
    </div>
  );
}

function UploadSlipModal({ branch, onClose }: { branch: ServiceCenter; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      await uploadPaymentSlip({
        centerId: branch.id,
        centerName: branch.branchName ?? branch.name,
        paymentCode: branch.paymentCode ?? "",
        plan: branch.plan,
        amount: monthlyAmountFor(branch),
        period: "monthly",
        file,
      });
      setDone(true);
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Upload Payment Slip</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-gray-400">
          {branch.branchName ?? branch.name} · LKR {monthlyAmountFor(branch).toLocaleString()}/mo
        </p>

        {done ? (
          <p className="text-sm text-green-400">Slip submitted — awaiting admin verification.</p>
        ) : (
          <>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-xs text-gray-300 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-[#F97316] file:text-white file:text-xs"
            />
            <button
              onClick={handleUpload}
              disabled={!file || uploading}
              className="w-full bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition text-sm"
            >
              {uploading ? "Uploading…" : "Submit Slip"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
