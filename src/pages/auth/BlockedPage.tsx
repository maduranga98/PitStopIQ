import { useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { Link } from "react-router-dom";
import { AlertTriangle, Upload, X, Check } from "lucide-react";
import { doc, addDoc, collection, Timestamp, getDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../config/firebase";

export default function BlockedPage() {
  const { currentUser, logout } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [error, setError] = useState("");

  async function handleSlipUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !currentUser?.centerId) return;
    setUploading(true);
    setError("");
    try {
      const centerId = currentUser.centerId;
      const storageRef = ref(storage, `paymentSlips/${centerId}/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const slipUrl = await getDownloadURL(storageRef);

      // Read center info for the request doc
      const centerSnap = await getDoc(doc(db, "servicecenters", centerId));
      const centerData = centerSnap.data() ?? {};

      await addDoc(collection(db, "paymentSlipRequests"), {
        centerId,
        centerName: centerData.name ?? "",
        paymentCode: centerData.paymentCode ?? "",
        plan: centerData.plan ?? "basic",
        amount: centerData.plan === "pro" ? 7999 : 4999,
        slipUrl,
        status: "pending",
        uploadedAt: Timestamp.now(),
        uploadedBy: currentUser.uid,
      });

      setUploaded(true);
    } catch {
      setError("Upload failed. Please try again or contact support.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0B1120] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/15 flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
          </div>
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="PitStop IQ" className="h-7 w-auto" onError={(e) => (e.currentTarget.style.display = "none")} />
            <span className="text-lg font-extrabold tracking-tight text-white">
              PITSTOP <span className="text-[#F97316]">IQ</span>
            </span>
          </div>
        </div>

        <div className="bg-[#162032] border border-amber-500/20 rounded-2xl p-6 text-center">
          <h2 className="text-lg font-bold text-amber-400 mb-2">Subscription Expired</h2>
          <p className="text-sm text-gray-400 mb-6">
            Upload your payment slip to restore access to your account.
          </p>

          {uploaded ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-12 h-12 rounded-full bg-green-500/15 flex items-center justify-center">
                <Check className="w-6 h-6 text-green-400" />
              </div>
              <p className="text-sm font-medium text-white">Payment slip submitted</p>
              <p className="text-xs text-gray-400">
                Your slip is under review. Access will be restored once verified by the admin team.
              </p>
            </div>
          ) : (
            <>
              {error && (
                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-sm text-red-400 mb-4">
                  <X className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              <label className={`flex items-center justify-center gap-2 w-full bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold py-3 px-4 rounded-xl transition text-sm cursor-pointer ${uploading ? "opacity-60 pointer-events-none" : ""}`}>
                {uploading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Uploading…
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Upload Payment Slip
                  </>
                )}
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handleSlipUpload} disabled={uploading} />
              </label>

              <p className="text-xs text-gray-600 mt-4">
                Need help?{" "}
                <span className="text-gray-400">SMS: 077 XXX XXXX</span>
              </p>
            </>
          )}
        </div>

        <div className="mt-6 flex justify-center">
          <Link
            to="/login"
            onClick={() => logout()}
            className="text-sm text-gray-400 hover:text-white transition-colors underline underline-offset-4"
          >
            Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}
