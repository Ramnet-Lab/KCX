import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Loads the repo-root .env into process.env (existing values win). Call before anything else. */
export function loadRootEnv(): void {
  try {
    const file = readFileSync(resolve(import.meta.dirname, "../../../.env"), "utf8");
    for (const line of file.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && m[1] && process.env[m[1]] === undefined) {
        let v = m[2]!.trim();
        // dotenv-conventional: strip one pair of surrounding quotes.
        if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    }
  } catch {
    // no .env — rely on the process environment (prod)
  }
}
