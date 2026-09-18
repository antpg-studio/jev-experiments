import { defineConfig } from "vitest/config";

// Live measurement harness: hits the real TypeSafe API. Run with `npm run measure`, never part of `npm test`.
export default defineConfig({ test: { include: ["measure/**/*.live.ts"], testTimeout: 0, hookTimeout: 0 } });
