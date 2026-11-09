/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        ink: "#17211d",
        muted: "#77817c",
        line: "#e9eeeb",
        brand: "#1d8b63",
        "brand-dark": "#126b4b",
        canvas: "#f7f8f6",
      },
      boxShadow: {
        card: "0 2px 12px rgba(20, 38, 29, .035)",
      },
    },
  },
  plugins: [],
};
