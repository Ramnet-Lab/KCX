#!/usr/bin/env bash
#
# KCX Docker setup — one command from a fresh clone to a running exchange.
#
#   ./docker-setup.sh              # dev stack: db + web + worker on localhost
#   ./docker-setup.sh prod         # production stack behind Caddy with TLS
#   ./docker-setup.sh down         # stop everything (data volumes survive)
#   ./docker-setup.sh reset        # stop AND delete the database volume
#   ./docker-setup.sh logs         # follow logs
#
# Safe to re-run: every step checks before it acts.

set -euo pipefail

cd "$(dirname "$0")"

# Docker on Windows/Git Bash mangles container paths like /var/... unless this is set.
export MSYS_NO_PATHCONV=1

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
YELLOW=$'\033[33m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
if [ ! -t 1 ]; then BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; CYAN=""; RESET=""; fi

step=0
say()  { step=$((step+1)); printf '\n%s[%d]%s %s\n' "$BOLD$CYAN" "$step" "$RESET" "$1"; }
ok()   { printf '    %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '    %s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
die()  { printf '\n%sFailed:%s %s\n\n' "$RED$BOLD" "$RESET" "$1" >&2; exit 1; }

MODE="${1:-dev}"
DEV_COMPOSE=(docker compose -f docker-compose.dev.yml --profile full)
PROD_COMPOSE=(docker compose)

# ---------------------------------------------------------------- prerequisites
check_prereqs() {
  say "Checking prerequisites"

  command -v docker >/dev/null 2>&1 || die \
"Docker is not installed or not on PATH.
    Windows/macOS: install Docker Desktop  →  https://docker.com/products/docker-desktop
    Linux:         curl -fsSL https://get.docker.com | sh"

  docker compose version >/dev/null 2>&1 || die \
"'docker compose' (v2) is unavailable. The legacy 'docker-compose' binary won't work here —
    update Docker, or install the Compose v2 plugin."

  # `docker --version` answers even when the engine is stopped; `docker info` doesn't.
  docker info >/dev/null 2>&1 || die \
"The Docker daemon isn't responding. Start Docker Desktop (or 'sudo systemctl start docker')
    and run this again."

  ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo 'ready')"
}

# ---------------------------------------------------------------- secrets / env
rand() {
  # Prefer openssl; fall back to urandom so this works on a bare container host.
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
  else
    LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c 48
  fi
}

# set_env KEY VALUE — insert if missing, replace only if currently blank.
set_env() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" .env 2>/dev/null; then
    local current
    current="$(grep -E "^${key}=" .env | head -1 | cut -d= -f2-)"
    if [ -z "$current" ]; then
      # Portable in-place edit: BSD and GNU sed disagree about -i.
      sed "s|^${key}=.*|${key}=${value}|" .env > .env.tmp && mv .env.tmp .env
      return 0
    fi
    return 1
  fi
  printf '%s=%s\n' "$key" "$value" >> .env
  return 0
}

get_env() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"'\r'; }

prepare_env() {
  say "Environment"

  if [ ! -f .env ]; then
    cp .env.example .env
    ok "created .env from .env.example"
  else
    ok ".env already present"
  fi

  # Generated secrets — only ever filled when blank, so re-running never rotates a
  # live password out from under the database volume.
  if set_env IP_HASH_SALT "$(rand)"; then ok "generated IP_HASH_SALT"; fi

  if [ "$MODE" = "prod" ]; then
    if set_env POSTGRES_PASSWORD "$(rand)"; then ok "generated POSTGRES_PASSWORD"; fi

    local domain origin
    domain="$(get_env KCX_DOMAIN)"
    origin="$(get_env PUBLIC_ORIGIN)"

    [ -n "$domain" ] || die \
"KCX_DOMAIN is empty in .env — Caddy needs it to request a TLS certificate.
    Set it to the domain already pointing at this server, e.g.
      KCX_DOMAIN=kestrelexchange.com"

    if [ -z "$origin" ]; then
      set_env PUBLIC_ORIGIN "https://${domain}" >/dev/null || true
      sed "s|^PUBLIC_ORIGIN=.*|PUBLIC_ORIGIN=https://${domain}|" .env > .env.tmp && mv .env.tmp .env
      ok "PUBLIC_ORIGIN set to https://${domain}"
    fi
    # Passkeys bind permanently to this value; deriving it from the domain avoids a
    # mismatch that would silently reject every existing credential.
    if [ "$(get_env RP_ID)" = "localhost" ] || [ -z "$(get_env RP_ID)" ]; then
      sed "s|^RP_ID=.*|RP_ID=${domain}|" .env > .env.tmp && mv .env.tmp .env
      ok "RP_ID set to ${domain}"
    fi
    sed "s|^ALLOW_DEV_LOGIN=.*|ALLOW_DEV_LOGIN=false|" .env > .env.tmp && mv .env.tmp .env
    ok "dev sign-in disabled"
  fi

  [ -n "$(get_env UEX_API_TOKEN)" ] || warn \
"UEX_API_TOKEN is empty — fine to start (reads work unauthenticated), but a free token
      from uexcorp.space/api/apps raises rate limits."
}

# ---------------------------------------------------------------- build and run
compose() { if [ "$MODE" = "prod" ]; then "${PROD_COMPOSE[@]}" "$@"; else "${DEV_COMPOSE[@]}" "$@"; fi; }

build_and_start() {
  say "Building images (first run pulls the Node base image — a few minutes)"
  compose build
  ok "images built"

  say "Starting the stack"
  compose up -d
  ok "containers started"
}

wait_healthy() {
  say "Waiting for the database"
  local tries=0
  until compose exec -T db pg_isready -U "$(get_env POSTGRES_USER || echo kcx)" >/dev/null 2>&1; do
    tries=$((tries+1))
    [ "$tries" -lt 60 ] || die "Postgres never became ready. Check: ./docker-setup.sh logs"
    sleep 2
  done
  ok "database accepting connections"

  # The worker applies migrations at boot, so the web app is only truly usable after it.
  say "Waiting for the worker to migrate the schema"
  tries=0
  until compose logs server 2>/dev/null | grep -q "schema up to date\|KCX server up"; do
    tries=$((tries+1))
    if [ "$tries" -ge 60 ]; then
      warn "worker hasn't reported readiness yet — it may still be pulling UEX data"
      break
    fi
    sleep 2
  done
  ok "schema applied"
}

smoke_test() {
  say "Smoke test"
  local url tries=0
  url="$([ "$MODE" = "prod" ] && echo "http://127.0.0.1:80" || echo "http://127.0.0.1:3000")/api/health"

  until curl -fsS -o /dev/null -w '' "$url" 2>/dev/null; do
    tries=$((tries+1))
    if [ "$tries" -ge 30 ]; then
      warn "health endpoint not answering yet at ${url}"
      warn "the site may still be warming up — check ./docker-setup.sh logs"
      return 0
    fi
    sleep 2
  done
  ok "health check passed"
}

seed_prices() {
  say "Loading market data from UEX"
  if compose exec -T server node --import tsx apps/server/src/scripts/ingest.ts; then
    ok "commodities, terminals and prices loaded"
  else
    warn "ingest failed — the scheduled poller will retry within 30 minutes"
  fi
}

finish() {
  local url
  url="$([ "$MODE" = "prod" ] && echo "https://$(get_env KCX_DOMAIN)" || echo "http://localhost:3000")"
  cat <<EOF

${GREEN}${BOLD}KCX is running.${RESET}

  ${BOLD}${url}${RESET}

  ${DIM}logs${RESET}     ./docker-setup.sh logs
  ${DIM}stop${RESET}     ./docker-setup.sh down
  ${DIM}wipe db${RESET}  ./docker-setup.sh reset

EOF
  if [ "$MODE" != "prod" ]; then
    cat <<EOF
${DIM}Dev notes: sign-in over plain http falls back to RSI handle verification —
passkeys need https, which the prod stack provides via Caddy.${RESET}

EOF
  fi
}

# ---------------------------------------------------------------- subcommands
case "$MODE" in
  dev|prod)
    printf '%sKCX Docker setup%s (%s)\n================\n' "$BOLD" "$RESET" "$MODE"
    check_prereqs
    prepare_env
    build_and_start
    wait_healthy
    smoke_test
    seed_prices
    finish
    ;;
  down)
    check_prereqs
    say "Stopping containers (volumes preserved)"
    "${DEV_COMPOSE[@]}" down 2>/dev/null || true
    "${PROD_COMPOSE[@]}" down 2>/dev/null || true
    ok "stopped"
    ;;
  reset)
    check_prereqs
    printf '\n%sThis deletes the database volume — every order, contract and price row.%s\n' "$RED$BOLD" "$RESET"
    printf 'Type %sDELETE%s to confirm: ' "$BOLD" "$RESET"
    read -r answer
    [ "$answer" = "DELETE" ] || die "cancelled"
    "${DEV_COMPOSE[@]}" down -v 2>/dev/null || true
    "${PROD_COMPOSE[@]}" down -v 2>/dev/null || true
    ok "containers and volumes removed"
    ;;
  logs)
    check_prereqs
    if "${PROD_COMPOSE[@]}" ps --status running 2>/dev/null | grep -q kcx; then
      "${PROD_COMPOSE[@]}" logs -f --tail=100
    else
      "${DEV_COMPOSE[@]}" logs -f --tail=100
    fi
    ;;
  -h|--help|help)
    # Print the header comment block, stopping at the first non-comment line.
    awk 'NR>1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "$0"
    ;;
  *)
    die "Unknown command '${MODE}'. Try: dev | prod | down | reset | logs | help"
    ;;
esac
