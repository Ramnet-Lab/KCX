#!/bin/sh
# Nightly database backup for the KCX host.
#
# Install (Unraid keeps no persistent crontab, so this goes in the User Scripts plugin or
# /boot/config/go — a plain `crontab -e` entry does NOT survive a reboot):
#
#   0 4 * * *  /mnt/user/Dockerfiles/KCX/scripts/backup-db.sh >> /mnt/user/Dockerfiles/KCX/backups/backup.log 2>&1
#
# Deliberately boring: pg_dump into a gzip, keep N days, delete the rest. No incremental
# scheme, no WAL shipping — the dataset is small and the failure mode we actually care about
# is "a migration or a bad deploy ate the data", which a nightly logical dump covers.
set -eu

KCX_DIR="${KCX_DIR:-/mnt/user/Dockerfiles/KCX}"
DB_CONTAINER="${DB_CONTAINER:-kcx-dev-db-1}"
DB_USER="${DB_USER:-kcx}"
DB_NAME="${DB_NAME:-kcx}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"
OUT_DIR="$KCX_DIR/backups"

stamp() { date -u +%Y%m%dT%H%M%SZ; }
log() { echo "[backup $(date -u +%H:%M:%S)] $*"; }

mkdir -p "$OUT_DIR"

if ! docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null | grep -q true; then
  log "FAILED: container $DB_CONTAINER is not running"
  exit 1
fi

TARGET="$OUT_DIR/kcx-$(stamp).sql.gz"
TMP="$TARGET.partial"

# Write to .partial and rename only on success. A dump interrupted midway would otherwise
# leave a truncated file with a legitimate-looking name — the kind of backup you discover is
# useless at the exact moment you need it.
if ! docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip -9 > "$TMP"; then
  log "FAILED: pg_dump errored"
  rm -f "$TMP"
  exit 1
fi

# gzip -t proves the stream is complete and readable, not merely non-empty.
if ! gzip -t "$TMP" 2>/dev/null; then
  log "FAILED: archive did not verify"
  rm -f "$TMP"
  exit 1
fi

SIZE=$(wc -c < "$TMP")
if [ "$SIZE" -lt 100000 ]; then
  log "FAILED: archive is only ${SIZE} bytes — refusing to accept it or rotate against it"
  rm -f "$TMP"
  exit 1
fi

mv "$TMP" "$TARGET"
log "ok: $(basename "$TARGET") ($((SIZE / 1024)) KiB)"

# Rotate only AFTER a good backup exists, so a run of failures can never leave us with none.
DELETED=$(find "$OUT_DIR" -name 'kcx-*.sql.gz' -type f -mtime "+$RETAIN_DAYS" -print -delete | wc -l)
[ "$DELETED" -gt 0 ] && log "rotated out $DELETED archive(s) older than $RETAIN_DAYS days"

log "held: $(find "$OUT_DIR" -name 'kcx-*.sql.gz' -type f | wc -l) archive(s), $(du -sh "$OUT_DIR" | cut -f1) total"
exit 0
