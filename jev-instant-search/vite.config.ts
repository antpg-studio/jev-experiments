import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { handleJev } from "./server/jev-proxy.mjs";

function jevProxy(): Plugin {
  return {
    name: "jev-proxy",
    configureServer(server) {
      server.middlewares.use("/api/jev", (req, res) => {
        void handleJev(req, res);
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), jevProxy()],
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
