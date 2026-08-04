#!/bin/sh
# Nightly database backup. Install on the host with:
#   (crontab -l 2>/dev/null; echo "15 4 * * * cd /srv/kcx && ./docker/backup.sh >> /var/log/kcx-backup.log 2>&1") | crontab -
#
# Price history is expensive to rebuild (UEX serves current prices, not the past), and
# reputation is the one thing that must survive a game wipe. Both live in this dump.
set -eu

cd "$(dirname "$0")/.."
STAMP=$(date -u +%Y%m%d-%H%M)
OUT="docker/backup/kcx-${STAMP}.sql.gz"
mkdir -p docker/backup

docker compose exec -T db pg_dump -U "${POSTGRES_USER:-kcx}" "${POSTGRES_DB:-kcx}" | gzip > "$OUT"
echo "$(date -u +%FT%TZ) wrote $OUT ($(du -h "$OUT" | cut -f1))"

# Keep 14 local copies; off-site is the real safety net.
ls -1t docker/backup/kcx-*.sql.gz | tail -n +15 | xargs -r rm --

# Optional off-site copy — configure rclone once, then set RCLONE_REMOTE.
if [ -n "${RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null 2>&1; then
  rclone copy "$OUT" "$RCLONE_REMOTE" && echo "copied off-site to $RCLONE_REMOTE"
fi
