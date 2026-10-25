/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "#080c14",
        surface: {
          DEFAULT: "#0d131f",
          elevated: "#121a2a",
          card: "#0f172a",
          hover: "#172238",
        },
        border: {
          DEFAULT: "#1e293b",
          subtle: "#182234",
          focus: "#38bdf8",
        },
        muted: {
          DEFAULT: "#94a3b8",
          dark: "#64748b",
        },
        risk: {
          allow: "#10b981",
          review: "#f59e0b",
          block: "#ef4444",
          critical: "#dc2626",
        },
        accent: {
          cyan: "#06b6d4",
          blue: "#3b82f6",
          purple: "#a855f7",
        }
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      animation: {
        "pulse-fast": "pulse 1.2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "pulse-red": "pulseRed 1.5s infinite",
      },
      keyframes: {
        pulseRed: {
          "0%, 100%": { opacity: "1", filter: "drop-shadow(0 0 8px rgba(239, 68, 68, 0.8))" },
          "50%": { opacity: "0.4", filter: "drop-shadow(0 0 2px rgba(239, 68, 68, 0.3))" },
        }
      }
    },
  },
  plugins: [],
}
