// Production/preview server: serves dist/ and proxies /api/jev with the server-side key.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createJevHandler, loadApiKey } from "./jev-proxy.mjs";

const PORT = Number(process.env.PORT ?? 4173);
const DIST = new URL("./dist/", import.meta.url).pathname;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};
const jev = createJevHandler(loadApiKey());

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/api/jev") return jev(req, res);
  const rel = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
  try {
    const data = await readFile(join(DIST, rel));
    res.setHeader("Content-Type", TYPES[extname(rel)] ?? "application/octet-stream");
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
}).listen(PORT, "0.0.0.0", () => console.log(`jev-swarm on http://localhost:${PORT}`));
