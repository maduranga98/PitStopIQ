import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// English ships in the entry bundle: it is the fallback for every missing key,
// so it has to be there before the first render either way. Sinhala and Tamil
// are ~210 KB of JSON between them and are loaded on demand instead — an
// English user (the majority) no longer downloads and parses translations they
// will never see, which is most of what the startup bundle used to carry.
import en from "./locales/en/translation.json";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "si", label: "සිංහල" },
  { code: "ta", label: "தமிழ்" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

const STORAGE_KEY = "pitstopiq.lang";
const stored = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
const initialLng = SUPPORTED_LANGUAGES.some((l) => l.code === stored) ? (stored as LanguageCode) : "en";

// Vite turns each of these into its own chunk, fetched only when that language
// is actually chosen.
const LAZY_BUNDLES: Record<string, () => Promise<{ default: Record<string, unknown> }>> = {
  si: () => import("./locales/si/translation.json"),
  ta: () => import("./locales/ta/translation.json"),
};

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
    },
    lng: initialLng,
    fallbackLng: "en",
    interpolation: {
      escapeValue: false,
    },
    react: {
      // A bundle that arrives after the first render (a lazily loaded language)
      // has to re-render what is already on screen, or the page would sit in
      // English until something else happened to update it.
      bindI18nStore: "added",
    },
  });

/** Load a language's strings if they aren't in memory yet. Safe to call twice. */
export async function loadLanguage(lng: string): Promise<void> {
  if (i18n.hasResourceBundle(lng, "translation")) return;
  const load = LAZY_BUNDLES[lng];
  if (!load) return;
  try {
    const mod = await load();
    i18n.addResourceBundle(lng, "translation", mod.default, true, true);
  } catch {
    // Offline or a chunk that didn't survive a deploy — English still renders.
  }
}

/**
 * Switch languages, fetching the strings first so the screen changes in one
 * step instead of flashing English on the way.
 */
export async function changeAppLanguage(lng: string): Promise<void> {
  await loadLanguage(lng);
  await i18n.changeLanguage(lng);
}

// The Sinhala and Tamil faces are not requested on start-up (see index.html) —
// an English device should never pay for them. Switching into one of those
// languages is what pulls its font in, once.
const FONT_FAMILY: Record<string, string> = {
  si: "Noto+Sans+Sinhala",
  ta: "Noto+Sans+Tamil",
};

function ensureScriptFont(lng: string): void {
  const family = FONT_FAMILY[lng];
  if (!family || typeof document === "undefined") return;
  // index.html already asked for this script's font on the way in.
  if (document.documentElement.getAttribute("data-script-font") === lng) return;
  const href = `https://fonts.googleapis.com/css2?family=${family}:wght@400..800&display=swap`;
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
  document.documentElement.setAttribute("data-script-font", lng);
}

// Somebody calling i18n.changeLanguage directly still gets their strings; the
// screen just fills in a moment later (bindI18nStore above re-renders it).
i18n.on("languageChanged", (lng) => {
  void loadLanguage(lng);
  ensureScriptFont(lng);
  try {
    localStorage.setItem(STORAGE_KEY, lng);
    document.documentElement.lang = lng;
  } catch {
    /* ignore */
  }
});

/**
 * Resolves once the app can render in the stored language. English is already
 * in the bundle, so only a Sinhala or Tamil user waits — and only for their own
 * ~100 KB chunk, instead of everyone waiting for all three.
 */
export const i18nReady: Promise<void> = loadLanguage(initialLng);

// Apply on initial load so CSS :lang() selectors work immediately.
document.documentElement.lang = initialLng;

export default i18n;
