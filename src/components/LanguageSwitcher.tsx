import { useState } from "react";
import { Globe, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "../i18n";

interface Props {
  /** Compact icon-only trigger (e.g. collapsed sidebar / mobile bar). */
  compact?: boolean;
  /** Open the menu upward (for triggers anchored near the bottom). */
  dropUp?: boolean;
}

export default function LanguageSwitcher({ compact = false, dropUp = false }: Props) {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);

  const current = SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language)
    ?? SUPPORTED_LANGUAGES[0];

  function choose(code: string) {
    i18n.changeLanguage(code);
    document.documentElement.lang = code;
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Language"
        className={`flex items-center gap-2 text-sm text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition ${
          compact ? "p-2" : "w-full px-3 py-2"
        }`}
      >
        <Globe className="h-4 w-4 flex-shrink-0" />
        {!compact && <span className="flex-1 text-left">{current.label}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={`absolute right-0 left-auto sm:left-0 z-50 min-w-[140px] bg-[#1e2d42] border border-white/10 rounded-lg shadow-xl overflow-hidden ${
            dropUp ? "bottom-full mb-1" : "top-full mt-1"
          }`}>
            {SUPPORTED_LANGUAGES.map((l) => (
              <button
                key={l.code}
                onClick={() => choose(l.code)}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm transition hover:bg-white/5 ${
                  l.code === current.code ? "text-[#F97316] font-medium" : "text-gray-300"
                }`}
              >
                {l.label}
                {l.code === current.code && <Check className="h-3.5 w-3.5" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
