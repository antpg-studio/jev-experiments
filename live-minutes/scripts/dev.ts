// Starts the Jev proxy server and the Vite dev server together (one command: `npm run dev`).
import { spawn } from "node:child_process";

const procs = [
  spawn("node", ["--experimental-strip-types", "server/index.ts"], { stdio: "inherit", env: process.env }),
  spawn("npx", ["vite", "--host", "0.0.0.0"], { stdio: "inherit", env: process.env }),
];

const stop = () => {
  for (const p of procs) p.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) p.on("exit", (code) => code && code !== 0 && stop());
