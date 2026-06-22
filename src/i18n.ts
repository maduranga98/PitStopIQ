import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en/translation.json";
import si from "./locales/si/translation.json";
import ta from "./locales/ta/translation.json";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "si", label: "සිංහල" },
  { code: "ta", label: "தமிழ்" },
] as const;

const STORAGE_KEY = "pitstopiq.lang";
const stored = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
const initialLng = SUPPORTED_LANGUAGES.some((l) => l.code === stored) ? stored! : "en";

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      si: { translation: si },
      ta: { translation: ta },
    },
    lng: initialLng,
    fallbackLng: "en",
    interpolation: {
      escapeValue: false,
    },
  });

// Persist the chosen language so it survives reloads.
i18n.on("languageChanged", (lng) => {
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    /* ignore */
  }
});

export default i18n;
