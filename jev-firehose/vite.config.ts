import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { attachJevSocket, handleJev } from "./jevProxy.mjs";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "jev-proxy",
      configureServer(server) {
        if (server.httpServer) attachJevSocket(server.httpServer);
        server.middlewares.use("/api/jev", (req, res) => {
          void handleJev(req, res);
        });
      },
    },
  ],
});
