/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
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
