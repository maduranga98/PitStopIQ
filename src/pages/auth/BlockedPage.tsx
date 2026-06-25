import { useAuth } from "../../contexts/AuthContext";
import { Link } from "react-router-dom";
import { ShieldOff } from "lucide-react";

const messages = [
  {
    lang: "English",
    title: "Service Suspended",
    body: "This service center has been suspended because the owner has not paid the subscription. Please contact the service center owner.",
    owner: "Dear owner: please settle your PitStopIQ subscription and contact support to restore access.",
  },
  {
    lang: "සිංහල",
    title: "සේවාව අත්හිටුවා ඇත",
    body: "හිමිකරු දායකත්ව ගෙවීම සිදු නොකළ හේතුවෙන් මෙම සේවා මධ්‍යස්ථානය අත්හිටුවා ඇත. සේවා මධ්‍යස්ථානයේ හිමිකරු අමතන්න.",
    owner: "හිමිකරු වෙත: ඔබගේ PitStopIQ දායකත්ව ගෙවීම සිදු කර ප්‍රවේශය යළි ලබා ගැනීමට සහාය සම්බන්ධ කරගන්න.",
  },
  {
    lang: "தமிழ்",
    title: "சேவை நிறுத்தப்பட்டுள்ளது",
    body: "உரிமையாளர் சந்தா கட்டணம் செலுத்தாததால் இந்த சேவை மையம் நிறுத்தப்பட்டுள்ளது. சேவை மையத்தின் உரிமையாளரை தொடர்பு கொள்ளவும்.",
    owner: "உரிமையாளருக்கு: உங்கள் PitStopIQ சந்தா கட்டணத்தை செலுத்தி அணுகலை மீட்டெடுக்க ஆதரவை தொடர்பு கொள்ளவும்.",
  },
];

export default function BlockedPage() {
  const { logout } = useAuth();

  return (
    <div className="min-h-screen bg-[#0B1120] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-red-500/15 flex items-center justify-center mb-4">
            <ShieldOff className="w-8 h-8 text-red-400" />
          </div>
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="PitStop IQ" className="h-7 w-auto" onError={(e) => (e.currentTarget.style.display = "none")} />
            <span className="text-lg font-extrabold tracking-tight text-white">
              PITSTOP <span className="text-[#F97316]">IQ</span>
            </span>
          </div>
        </div>

        <div className="space-y-4">
          {messages.map(({ lang, title, body, owner }) => (
            <div key={lang} className="bg-[#162032] border border-red-500/20 rounded-xl p-5">
              <p className="text-xs text-red-400/70 font-medium uppercase tracking-wider mb-2">{lang}</p>
              <h2 className="text-base font-bold text-red-400 mb-2">{title}</h2>
              <p className="text-sm text-gray-300 mb-3">{body}</p>
              <p className="text-xs text-gray-500 border-t border-white/5 pt-3">{owner}</p>
            </div>
          ))}
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
