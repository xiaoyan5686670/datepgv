import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        app: {
          bg: "var(--bg)",
          aside: "var(--aside)",
          surface: "var(--surface)",
          "surface-hover": "var(--surface-hover)",
          input: "var(--input-bg)",
          border: "var(--border)",
          text: "var(--text)",
          "text-secondary": "var(--text-secondary)",
          muted: "var(--muted)",
          subtle: "var(--subtle)",
          accent: "rgb(var(--accent-rgb) / <alpha-value>)",
          "accent-hover": "var(--accent-hover)",
        },
        brand: {
          50: "#f0f9ff",
          100: "#e0f2fe",
          500: "#0ea5e9",
          600: "#0284c7",
          700: "#0369a1",
          900: "#0c4a6e",
        },
      },
      accentColor: {
        app: "rgb(var(--accent-rgb) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};
export default config;
