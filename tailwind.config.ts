import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        nuckle: ["Nuckle", "Arial", "sans-serif"],
      },
      colors: {
        ink: "#111111",
        paper: "#FFFFFF",
      },
    },
  },
  plugins: [],
};
export default config;
