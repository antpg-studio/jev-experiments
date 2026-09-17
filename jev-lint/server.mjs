// Minimal production server: serves dist/ and proxies /api/jev to TypeSafe.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { handleJev } from "./proxy.mjs";

const dist = fileURLToPath(new URL("./dist/", import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

async function serveStatic(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  if (path === "/" || path === "\\") path = "/index.html";
  const file = join(dist, path);
  if (!file.startsWith(dist)) {
    res.statusCode = 403;
    res.end();
    return;
  }
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error("not a file");
    res.setHeader("content-type", types[extname(file)] ?? "application/octet-stream");
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
}

http
  .createServer((req, res) => {
    if (req.url?.startsWith("/api/jev")) void handleJev(req, res);
    else void serveStatic(req, res);
  })
  .listen(port, "0.0.0.0", () => console.log(`jev-lint serving dist/ on http://localhost:${port}`));
