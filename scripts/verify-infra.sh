#!/usr/bin/env bash
# scripts/verify-infra.sh
set -euo pipefail

echo "Waiting for services to become healthy..."
for i in $(seq 1 30); do
  # `docker compose ps --format json` is NDJSON (one JSON object per line) on
  # some Docker Compose versions and a single JSON array on others (v2.21+
  # has been observed emitting either, depending on build). Handle both
  # shapes explicitly instead of assuming one -- silently mis-parsing the
  # other shape must never look like "0 unhealthy".
  unhealthy=$(docker compose ps --format json | bun -e '
    let s = "";
    for await (const chunk of Bun.stdin.stream()) s += Buffer.from(chunk).toString();
    const trimmed = s.trim();
    const parsed = trimmed.startsWith("[")
      ? JSON.parse(trimmed)
      : trimmed.split("\n").filter(Boolean).map(l => JSON.parse(l));
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const bad = list.filter(c => c.Health && c.Health !== "healthy");
    console.log(bad.length);
  ')
  if [ "$unhealthy" = "0" ]; then
    echo "All services healthy."
    exit 0
  fi
  sleep 2
done

echo "Timed out waiting for services to become healthy." >&2
docker compose ps
exit 1
