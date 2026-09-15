/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  // The UI is permanently dark and exposes no light/dark toggle, so `dark:`
  // variants must never key off the OS `prefers-color-scheme` setting (the
  // unset default). Pinned to the opt-in `.dark` class strategy: nothing adds
  // that class today, which is exactly the intent — no system-driven switching.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          navy: "#0B1120",
          "navy-mid": "#162032",
          orange: "#F97316",
          white: "#FFFFFF",
        },
      },
    },
  },
  plugins: [],
};
