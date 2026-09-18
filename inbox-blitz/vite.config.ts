import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const proxy = { "/api": { target: "http://localhost:8787", changeOrigin: true } };

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 5173, proxy },
});
