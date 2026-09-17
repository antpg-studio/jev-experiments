import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachJevSocket, handleJev } from "./jevProxy.mjs";

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
const port = Number(process.env.PORT || 4173);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

const server = http
  .createServer((req, res) => {
    if (req.url?.startsWith("/api/jev")) return void handleJev(req, res);
    const url = new URL(req.url ?? "/", "http://x");
    let file = path.join(dist, path.normalize(url.pathname));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, "index.html");
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, "0.0.0.0", () => console.log(`jev-firehose on http://localhost:${port}`));

attachJevSocket(server);
