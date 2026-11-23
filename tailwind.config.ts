import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#09090b",
        panel: "#111113",
        panel2: "#17171a",
        line: "#232328",
        muted: "#8b8b94",
        ice: { DEFAULT: "#7dd3fc", strong: "#38bdf8", soft: "#0c2a3a" },
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
      keyframes: { fadein: { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } } },
      animation: { fadein: "fadein .25s ease-out" },
    },
  },
  plugins: [],
} satisfies Config;
