import { Link } from "react-router-dom";
import { ArrowLeft, Info } from "lucide-react";

export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-[#0B1120] flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-[#F97316] opacity-5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-[#F97316] opacity-5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4">
            <img src="/logo.png" alt="PitStop IQ Logo" className="h-16 w-auto" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            PITSTOP <span className="text-[#F97316]">IQ</span>
          </h1>
          <p className="text-sm text-gray-400 mt-1 tracking-wide">Service Intelligence</p>
        </div>

        <div className="bg-[#162032] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-8 pt-8 pb-2">
            <h2 className="text-xl font-semibold text-white">Get Started with PitstopIQ</h2>
            <p className="text-sm text-gray-400 mt-1">Accounts are set up by the PitstopIQ team</p>
          </div>
          <div className="px-8 pb-8 pt-4">
            <div className="bg-[#0B1120] border border-white/10 rounded-xl p-5 mb-6">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#F97316]/15 text-[#F97316] flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Info className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white mb-1">No self-registration</p>
                  <p className="text-sm text-gray-400">
                    PitstopIQ accounts are created by the admin team after payment is confirmed. Contact us via WhatsApp to sign up and we will set up your account and send you your login credentials via SMS.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3 mb-6">
              <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Contact us to get started</p>
              <div className="bg-[#0B1120] border border-white/5 rounded-lg px-4 py-3 text-sm text-gray-300">
                <span className="text-gray-500">WhatsApp: </span>
                <span className="text-white font-medium">077 XXX XXXX</span>
              </div>
              <div className="bg-[#0B1120] border border-white/5 rounded-lg px-4 py-3 text-sm text-gray-300">
                <span className="text-gray-500">Plans from: </span>
                <span className="text-white font-medium">LKR 4,999 / month</span>
              </div>
            </div>

            <Link
              to="/login"
              className="flex items-center justify-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
