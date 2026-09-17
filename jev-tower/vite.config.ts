import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readJevBody, forwardToJev } from "./jev-proxy.mjs";

function jevProxy(): Plugin {
  return {
    name: "jev-proxy",
    configureServer(server) {
      server.middlewares.use("/api/jev", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const body = await readJevBody(req);
        const out = await forwardToJev(body, process.env.TYPESAFE_API_KEY);
        res.statusCode = out.status;
        res.setHeader("content-type", "application/json");
        res.end(out.body);
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), jevProxy()],
  test: { include: ["src/**/*.test.ts"] },
});
