#!/usr/bin/env node
/**
 * One-command bootstrap: `pnpm setup`
 *
 * Takes a fresh clone to a running exchange with live market data. Every step is
 * idempotent, so re-running after a failure resumes rather than duplicating work.
 *
 * Database strategy, in order of preference:
 *   1. An already-running Postgres on the configured URL — leave it alone.
 *   2. Docker, if the daemon is actually responding.
 *   3. Portable Postgres downloaded into tools/ — no admin rights, no Docker Desktop.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const isWindows = process.platform === "win32";

const DEFAULT_URL = "postgres://kcx:kcx@localhost:5433/kcx";
const PG_VERSION = "17.7-1";

let step = 0;
const say = (msg) => console.log(`\n[${++step}] ${msg}`);
const ok = (msg) => console.log(`    ✓ ${msg}`);
const warn = (msg) => console.log(`    ! ${msg}`);

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: isWindows, ...opts });
  if (res.status !== 0 && !opts.allowFailure) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${res.status}`);
  }
  return res.status === 0;
}

function quiet(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: root, encoding: "utf8", shell: isWindows, ...opts });
  return { ok: res.status === 0, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

const portOpen = (host, port) =>
  new Promise((done) => {
    const sock = net.createConnection({ host, port });
    const finish = (v) => {
      sock.destroy();
      done(v);
    };
    sock.setTimeout(1200);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
  });

/* ---------- 1. env ---------- */
function ensureEnv() {
  say("Environment file");
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) {
    const example = join(root, ".env.example");
    writeFileSync(envPath, existsSync(example) ? readFileSync(example, "utf8") : `DATABASE_URL=${DEFAULT_URL}\n`);
    ok("created .env from .env.example");
  } else {
    ok(".env already present");
  }

  let env = readFileSync(envPath, "utf8");
  const need = [
    ["DATABASE_URL", DEFAULT_URL],
    ["UEX_API_BASE", "https://api.uexcorp.uk/2.0"],
    ["WS_PORT", "4000"],
    ["WEB_ORIGINS", "http://localhost:3000"],
    ["NEXT_PUBLIC_WS_URL", "http://localhost:4000"],
    ["ALLOW_DEV_LOGIN", "true"],
    // Salts sessions' stored IP hashes; random per install so it's never a shared secret.
    ["IP_HASH_SALT", `dev-${Math.random().toString(36).slice(2, 12)}`],
  ];
  let added = 0;
  for (const [key, value] of need) {
    if (!new RegExp(`^${key}=`, "m").test(env)) {
      env += `${env.endsWith("\n") ? "" : "\n"}${key}=${value}\n`;
      added++;
    }
  }
  if (added) writeFileSync(envPath, env);
  if (added) ok(`added ${added} missing variable(s)`);

  const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? DEFAULT_URL;
  return url;
}

/* ---------- 2. dependencies ---------- */
function installDeps() {
  say("Workspace dependencies");
  if (!quiet("pnpm", ["--version"]).ok) {
    throw new Error("pnpm not found. Install it with:  npm install -g pnpm");
  }
  run("pnpm", ["install"]);
  ok("dependencies installed");
}

/* ---------- 3. database ---------- */
function dockerUsable() {
  // `docker --version` succeeds even when the daemon is down; `docker info` doesn't.
  return quiet("docker", ["info", "--format", "{{.ServerVersion}}"]).ok;
}

async function startPortablePostgres(port) {
  const pgDir = join(root, "tools", "pgsql");
  const dataDir = join(root, ".pgdata");
  const bin = (name) => join(pgDir, "bin", isWindows ? `${name}.exe` : name);

  if (!existsSync(bin("pg_ctl"))) {
    if (!isWindows) {
      throw new Error(
        "No Postgres reachable and no Docker. On macOS/Linux install Postgres 17 or start Docker, then re-run.",
      );
    }
    say("Downloading portable PostgreSQL (~350 MB, one time)");
    mkdirSync(join(root, "tools"), { recursive: true });
    const zip = join(root, "tools", "pgsql.zip");
    const url = `https://get.enterprisedb.com/postgresql/postgresql-${PG_VERSION}-windows-x64-binaries.zip`;
    run("powershell", ["-NoProfile", "-Command", `Invoke-WebRequest -Uri '${url}' -OutFile '${zip}'`]);
    run("powershell", ["-NoProfile", "-Command", `Expand-Archive -Path '${zip}' -DestinationPath '${join(root, "tools")}' -Force`]);
    ok("extracted to tools/pgsql");
  }

  if (!existsSync(dataDir)) {
    say("Initialising the database cluster");
    run(bin("initdb"), ["-D", dataDir, "-U", "kcx", "-A", "trust", "-E", "UTF8", "--locale=C"]);
    ok("cluster created");
  }

  say(`Starting PostgreSQL on :${port}`);
  run(bin("pg_ctl"), ["-D", dataDir, "-l", join(dataDir, "pg.log"), "-o", `-p ${port}`, "start"], {
    allowFailure: true,
  });
  for (let i = 0; i < 30 && !(await portOpen("localhost", port)); i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!(await portOpen("localhost", port))) throw new Error(`Postgres did not come up on :${port}`);
  quiet(bin("createdb"), ["-p", String(port), "-U", "kcx", "kcx"]); // fine if it exists
  ok("PostgreSQL running");
}

async function ensureDatabase(url) {
  say("Database");
  const parsed = new URL(url);
  const port = Number(parsed.port || 5432);
  const host = parsed.hostname || "localhost";

  if (await portOpen(host, port)) {
    ok(`something is already serving ${host}:${port} — using it`);
    return;
  }

  if (dockerUsable()) {
    ok("Docker is running — starting the db service");
    run("docker", ["compose", "-f", "docker-compose.dev.yml", "up", "-d", "db"]);
    for (let i = 0; i < 60 && !(await portOpen(host, port)); i++) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!(await portOpen(host, port))) throw new Error("Docker Postgres did not become reachable");
    ok("PostgreSQL running in Docker");
    return;
  }

  warn("no running Postgres and no Docker daemon — falling back to portable Postgres");
  await startPortablePostgres(port);
}

/* ---------- 4. schema + data ---------- */
function applySchema() {
  say("Applying schema");
  // drizzle-kit push is interactive on ambiguity; migrations are deterministic.
  run("pnpm", ["--filter", "@kcx/db", "exec", "drizzle-kit", "migrate"], { allowFailure: true }) ||
    run("pnpm", ["db:push"]);
  ok("schema applied");
}

function seedMarketData() {
  say("Fetching live market data from UEX (this takes a minute)");
  run("pnpm", ["ingest"]);
  ok("commodities, terminals and prices loaded");
}

/* ---------- go ---------- */
(async () => {
  console.log("KCX setup\n=========");
  try {
    const url = ensureEnv();
    installDeps();
    await ensureDatabase(url);
    applySchema();
    seedMarketData();

    console.log(`
Done. Start it with:

  pnpm dev          # web on http://localhost:3000, worker + socket.io alongside

Useful:
  pnpm db:stop      # stop portable Postgres
  pnpm ingest       # pull fresh prices now
  pnpm seed:demo    # populate a demo order book

Note: passkeys need https, so sign-in over a LAN IP falls back to RSI handle
verification. That is expected — see docs/auth-reference.md.
`);
  } catch (err) {
    console.error(`\nSetup failed: ${err instanceof Error ? err.message : err}\n`);
    console.error("Fix the problem above and re-run `pnpm setup` — completed steps are skipped.");
    process.exit(1);
  }
})();
