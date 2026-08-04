import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Runs at server start in ALL runtimes — including the standalone production server,
 * which never executes next.config.ts (it embeds the serialized config). This is the
 * authoritative env bootstrap; next.config.ts keeps a copy only for build-time needs.
 */
export function register(): void {
  try {
    const file = readFileSync(resolve(process.cwd(), "../../.env"), "utf8");
    for (const line of file.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && m[1] && process.env[m[1]] === undefined) {
        let v = m[2]!.trim();
        if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    }
  } catch {
    /* no .env — prod supplies env externally (compose env_file) */
  }
  if (!process.env.DATABASE_URL) {
    console.warn("[env] DATABASE_URL is not set — pages will render empty states");
  }
}
