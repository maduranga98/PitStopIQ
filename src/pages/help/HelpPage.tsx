import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LifeBuoy, Search, ChevronDown, Rocket, Wrench, Users, FileText, FileSignature,
  Package, ShoppingCart, Calculator, UserCog, BarChart2, Settings, WifiOff,
  Phone, MessageCircle, Mail, HelpCircle, Globe,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { SUPPORT_CONTACT, whatsappLink, hasSupportContact } from "../../lib/support";
import { SUPPORTED_LANGUAGES } from "../../i18n";

// Guide order mirrors the sidebar so the page reads like a tour of the app.
const GUIDES: { id: string; icon: React.ElementType }[] = [
  { id: "gettingStarted", icon: Rocket },
  { id: "services", icon: Wrench },
  { id: "customers", icon: Users },
  { id: "invoices", icon: FileText },
  { id: "quotations", icon: FileSignature },
  { id: "pos", icon: ShoppingCart },
  { id: "inventory", icon: Package },
  { id: "money", icon: Calculator },
  { id: "team", icon: UserCog },
  { id: "reports", icon: BarChart2 },
  { id: "settings", icon: Settings },
  { id: "offline", icon: WifiOff },
];

const FAQ_IDS = ["staffPassword", "proPlan", "addBranch", "smsNotSending", "fixInvoice", "dataSafe"];

function Accordion({
  icon: Icon, title, open, onToggle, children,
}: {
  icon: React.ElementType; title: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="border border-white/10 rounded-xl bg-[#162032] overflow-hidden">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition"
      >
        <Icon className={`w-4 h-4 flex-shrink-0 ${open ? "text-[#F97316]" : "text-gray-400"}`} />
        <span className="flex-1 text-sm font-medium text-white">{title}</span>
        <ChevronDown className={`w-4 h-4 text-gray-500 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-4 pb-4 pt-1 border-t border-white/5">{children}</div>}
    </div>
  );
}

export default function HelpPage() {
  const { t, i18n } = useTranslation();
  const [queryText, setQueryText] = useState("");
  const [openId, setOpenId] = useState<string | null>("gettingStarted");

  // Steps/answers live in the translation files as arrays so each language can
  // phrase them naturally instead of forcing one sentence shape on all three.
  const list = (key: string): string[] => {
    const value = t(key, { returnObjects: true });
    return Array.isArray(value) ? (value as string[]) : [];
  };

  const guides = useMemo(
    () => GUIDES.map(g => ({
      ...g,
      title: t(`help.guides.${g.id}.title`),
      steps: list(`help.guides.${g.id}.steps`),
    })),
    // Re-read whenever the language changes.
    [i18n.language], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const faqs = useMemo(
    () => FAQ_IDS.map(id => ({
      id,
      question: t(`help.faq.${id}.q`),
      answer: t(`help.faq.${id}.a`),
    })),
    [i18n.language], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const q = queryText.trim().toLowerCase();
  const matches = (...parts: string[]) => !q || parts.some(p => p.toLowerCase().includes(q));
  const shownGuides = guides.filter(g => matches(g.title, ...g.steps));
  const shownFaqs = faqs.filter(f => matches(f.question, f.answer));
  const nothingFound = q !== "" && shownGuides.length === 0 && shownFaqs.length === 0;

  const supportMessage = t("help.support.waMessage");

  return (
    <div className="min-h-full">
      <PageHeader icon={<LifeBuoy className="w-5 h-5" />} title={t("help.title")} />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <p className="text-sm text-gray-400">{t("help.intro")}</p>

        {/* Search */}
        <div className="flex items-center gap-2 bg-[#162032] border border-white/10 rounded-xl px-3">
          <Search className="w-4 h-4 text-gray-500 flex-shrink-0" />
          <input
            type="text"
            value={queryText}
            onChange={e => setQueryText(e.target.value)}
            placeholder={t("help.searchPlaceholder")}
            className="flex-1 bg-transparent py-3 text-sm text-white placeholder-gray-500 focus:outline-none"
          />
        </div>

        {nothingFound && (
          <p className="text-sm text-gray-500 text-center py-6">{t("help.noResults")}</p>
        )}

        {/* How-to guides */}
        {shownGuides.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
              {t("help.guidesTitle")}
            </h2>
            {shownGuides.map(({ id, icon, title, steps }) => (
              <Accordion
                key={id}
                icon={icon}
                title={title}
                open={openId === id}
                onToggle={() => setOpenId(openId === id ? null : id)}
              >
                <ol className="mt-2 space-y-2">
                  {steps.map((step, i) => (
                    <li key={i} className="flex gap-3 text-sm text-gray-300">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#F97316]/15 text-[#F97316] text-[11px] font-bold flex items-center justify-center mt-0.5">
                        {i + 1}
                      </span>
                      <span className="flex-1">{step}</span>
                    </li>
                  ))}
                </ol>
              </Accordion>
            ))}
          </section>
        )}

        {/* FAQ */}
        {shownFaqs.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
              {t("help.faqTitle")}
            </h2>
            {shownFaqs.map(({ id, question, answer }) => (
              <Accordion
                key={id}
                icon={HelpCircle}
                title={question}
                open={openId === id}
                onToggle={() => setOpenId(openId === id ? null : id)}
              >
                <p className="mt-2 text-sm text-gray-300 leading-relaxed">{answer}</p>
              </Accordion>
            ))}
          </section>
        )}

        {/* Support contact */}
        <section className="border border-[#F97316]/30 bg-[#F97316]/5 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <LifeBuoy className="w-4 h-4 text-[#F97316]" />
              {t("help.support.title")}
            </h2>
            <p className="text-sm text-gray-400 mt-1">{t("help.support.subtitle")}</p>
          </div>

          {hasSupportContact() ? (
            <div className="grid gap-2 sm:grid-cols-3">
              {SUPPORT_CONTACT.whatsapp && (
                <a
                  href={whatsappLink(supportMessage)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#162032] border border-white/10 hover:border-[#F97316]/50 transition text-sm text-white"
                >
                  <MessageCircle className="w-4 h-4 text-[#25D366] flex-shrink-0" />
                  <span className="truncate">{t("help.support.whatsapp")}</span>
                </a>
              )}
              {SUPPORT_CONTACT.phone && (
                <a
                  href={`tel:${SUPPORT_CONTACT.phone}`}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#162032] border border-white/10 hover:border-[#F97316]/50 transition text-sm text-white"
                >
                  <Phone className="w-4 h-4 text-[#F97316] flex-shrink-0" />
                  <span className="truncate">{SUPPORT_CONTACT.phoneDisplay || SUPPORT_CONTACT.phone}</span>
                </a>
              )}
              {SUPPORT_CONTACT.email && (
                <a
                  href={`mailto:${SUPPORT_CONTACT.email}`}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#162032] border border-white/10 hover:border-[#F97316]/50 transition text-sm text-white"
                >
                  <Mail className="w-4 h-4 text-blue-400 flex-shrink-0" />
                  <span className="truncate">{SUPPORT_CONTACT.email}</span>
                </a>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400">{t("help.support.notConfigured")}</p>
          )}

          <div className="text-xs text-gray-500 space-y-1">
            <p>{t("help.support.hours")}</p>
            <p>{t("help.support.responseTime")}</p>
            <p>{SUPPORT_CONTACT.company}</p>
          </div>
        </section>

        {/* Language reminder — the whole page is translated, so make the switch
            obvious to anyone who landed here confused by the English. */}
        <section className="border border-white/10 rounded-xl p-4">
          <p className="text-sm text-white flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#F97316]" />
            {t("help.language.title")}
          </p>
          <p className="text-xs text-gray-500 mt-1 mb-3">{t("help.language.hint")}</p>
          <div className="flex flex-wrap gap-2">
            {SUPPORTED_LANGUAGES.map(l => (
              <button
                key={l.code}
                onClick={() => { i18n.changeLanguage(l.code); document.documentElement.lang = l.code; }}
                className={`px-3 py-1.5 rounded-lg text-sm border transition ${
                  i18n.language === l.code
                    ? "border-[#F97316] text-[#F97316] bg-[#F97316]/10"
                    : "border-white/10 text-gray-400 hover:text-white hover:border-white/30"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
