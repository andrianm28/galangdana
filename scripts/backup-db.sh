#!/usr/bin/env bash
# scripts/backup-db.sh
#
# Nightly Postgres backup. This project had NO backup mechanism of any kind
# until this script -- a disk failure, a bad migration, or one destructive
# command would have been total, permanent loss of the donation ledger and
# every KYC document reference. A co-hosted, non-production project on the
# same host already had a nightly pg_dump + retention policy; this platform,
# live and taking donations, did not.
#
# Runs pg_dump INSIDE the postgres container via `docker exec`, not against
# the host-published port -- this works regardless of host-side pg_dump
# version/availability (confirmed the host itself has none installed) and
# is unaffected by the port now being bound to 127.0.0.1 only.
#
# Install on the host with (crontab -e):
#   0 3 * * * /home/ubuntu/galangdana/scripts/backup-db.sh >> /home/ubuntu/fundforindonesia-backups/backup.log 2>&1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/home/ubuntu/fundforindonesia-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-35}"
CONTAINER="${POSTGRES_CONTAINER:-fundforindonesia-postgres-1}"
DB_USER="${POSTGRES_USER:-fundforindonesia}"
DB_NAME="${POSTGRES_DB:-fundforindonesia}"

mkdir -p "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
outfile="$BACKUP_DIR/fundforindonesia-$timestamp.sql.gz"

echo "[$timestamp] starting backup -> $outfile"

# --clean --if-exists so a restore onto an existing database drops and
# recreates cleanly rather than erroring on already-present objects.
docker exec "$CONTAINER" pg_dump -U "$DB_USER" --clean --if-exists "$DB_NAME" \
  | gzip -9 > "$outfile.tmp"
mv "$outfile.tmp" "$outfile"

size="$(du -h "$outfile" | cut -f1)"
echo "[$timestamp] backup complete: $outfile ($size)"

# Prune anything older than RETENTION_DAYS. Runs every invocation, not on a
# separate schedule, so retention stays correct even if the pruning step is
# ever temporarily disabled and re-enabled.
find "$BACKUP_DIR" -name 'fundforindonesia-*.sql.gz' -mtime "+$RETENTION_DAYS" -print -delete
