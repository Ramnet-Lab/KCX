import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The single .env lives at the repo root; Next only auto-loads app-local env files.
// NOTE: this side effect runs in `next dev`/`next build`/`next start` but NOT in the
// standalone production server (which embeds the serialized config and never executes
// this file) — src/instrumentation.ts is the runtime-authoritative env bootstrap.
try {
  const file = readFileSync(resolve(import.meta.dirname, "../../.env"), "utf8");
  for (const line of file.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[1] && process.env[m[1]] === undefined) {
      let v = m[2]!.trim();
      if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
} catch {
  /* prod: env comes from the environment */
}

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@kcx/db", "@kcx/shared"],
};

export default nextConfig;
