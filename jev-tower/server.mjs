// Production/preview server: serves dist/ and proxies /api/jev with the server-side key.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { readJevBody, forwardToJev } from "./jev-proxy.mjs";

const PORT = Number(process.env.PORT ?? 4173);
const DIST = new URL("./dist/", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/api/jev") {
    if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
    const out = await forwardToJev(await readJevBody(req), process.env.TYPESAFE_API_KEY);
    res.writeHead(out.status, { "content-type": "application/json" });
    res.end(out.body);
    return;
  }
  let file = join(DIST, normalize(url.pathname).replace(/^(\.\.[/\\])+/, ""));
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
  } catch {
    file = join(DIST, "index.html");
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}).listen(PORT, "0.0.0.0", () => console.log(`jev-tower on http://localhost:${PORT}`));
