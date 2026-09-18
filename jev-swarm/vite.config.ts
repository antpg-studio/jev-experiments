import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import { createJevHandler, loadApiKey } from "./jev-proxy.mjs";

function jevProxy(): Plugin {
  const handler = createJevHandler(loadApiKey());
  return {
    name: "jev-proxy",
    configureServer(server) {
      server.middlewares.use("/api/jev", (req, res) => void handler(req, res));
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), jevProxy()],
  test: { environment: "node" },
});
