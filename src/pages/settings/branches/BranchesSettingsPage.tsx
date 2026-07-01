import { useNavigate } from "react-router-dom";
import { ArrowLeft, Building2, MapPin, Phone, MessageSquare } from "lucide-react";
import { useAuth } from "../../../contexts/AuthContext";
import { useTranslation } from "react-i18next";

export default function BranchesSettingsPage() {
  const { currentUser, branches } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const isOwner = currentUser?.role === "Owner";

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <div className="border-b border-white/10 bg-[#0B1120]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Building2 className="w-5 h-5 text-[#F97316]" />
          <h1 className="text-lg font-bold">{t("settings.branches")}</h1>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {!isOwner || branches.length === 0 ? (
          <div className="text-center py-16">
            <Building2 className="w-14 h-14 text-gray-600 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-white mb-2">Single-branch account</h2>
            <p className="text-sm text-gray-400">
              Your account currently has one branch. Contact Madu via WhatsApp to add another.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {branches.map((branch) => (
              <div
                key={branch.id}
                className="bg-[#162032] border border-white/10 rounded-xl p-5 flex items-start justify-between gap-4"
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
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        branch.status === "active" ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-400"
                      }`}>
                        {branch.status === "active" ? "Active" : branch.status}
                      </span>
                    </div>
                    <div className="mt-1.5 space-y-1">
                      <div className="flex items-center gap-1.5 text-xs text-gray-400">
                        <MapPin className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">
                          {branch.address}{branch.district ? `, ${branch.district}` : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-gray-400">
                        <Phone className="w-3 h-3 flex-shrink-0" />
                        <span>{branch.phone}</span>
                      </div>
                      <div className="text-xs text-gray-500">
                        LKR {branch.monthlyRate?.toLocaleString() ?? "—"}/mo
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 flex items-center gap-2 text-xs text-gray-500 justify-center">
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Branches are added by Lumora Ventures. Contact Madu via WhatsApp to add a branch.</span>
        </div>
      </div>
    </div>
  );
}
