import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";

const JEV_URL = "https://api.typesafe.ai/v1/systemone";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function jevProxy(apiKey: string | undefined): Plugin {
  return {
    name: "jev-proxy",
    configureServer(server) {
      server.middlewares.use("/api/jev", async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        if (!apiKey) {
          res.statusCode = 503;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "TYPESAFE_API_KEY is not set on the server" }));
          return;
        }
        try {
          const body = await readBody(req);
          const upstream = await fetch(JEV_URL, {
            method: "POST",
            headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
            body,
          });
          res.statusCode = upstream.status;
          res.setHeader("content-type", "application/json");
          res.end(await upstream.text());
        } catch (err) {
          res.statusCode = 502;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : "proxy failure" }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiKey = process.env.TYPESAFE_API_KEY ?? env.TYPESAFE_API_KEY;
  return {
    base: "./",
    plugins: [react(), jevProxy(apiKey)],
  };
});
