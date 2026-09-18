import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { handleJev } from "./proxy.mjs";

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
  build: { chunkSizeWarningLimit: 1200 },
});
