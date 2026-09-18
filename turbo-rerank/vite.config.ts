import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
  },
  test: {
    include: ["shared/**/*.test.ts", "server/**/*.test.ts", "src/**/*.test.ts"],
  },
});
