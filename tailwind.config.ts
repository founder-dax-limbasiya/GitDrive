import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#101828",
        muted: "#667085",
        canvas: "#f7f8fa",
        line: "#e7eaf0",
        brand: "#5b5ce2"
      },
      boxShadow: {
        soft: "0 12px 36px rgba(16, 24, 40, 0.06)"
      }
    }
  },
  plugins: []
};

export default config;
