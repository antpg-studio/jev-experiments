import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { handleJev } from "./server/jev-proxy.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const port = Number(process.env.PORT ?? 4173);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/api/jev") return void handleJev(req, res);
  let file = join(root, normalize(url.pathname).replace(/^(\.\.[/\\])+/, ""));
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
  res.setHeader("content-type", types[extname(file)] ?? "application/octet-stream");
  createReadStream(file).pipe(res);
}).listen(port, "0.0.0.0", () => {
  console.log(`jev-instant-search serving dist/ on http://localhost:${port}`);
});
