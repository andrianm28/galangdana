#!/usr/bin/env bash
# scripts/verify-infra.sh
set -euo pipefail

echo "Waiting for services to become healthy..."
for i in $(seq 1 30); do
  unhealthy=$(docker compose ps --format json | bun -e '
    let s = "";
    for await (const chunk of Bun.stdin.stream()) s += Buffer.from(chunk).toString();
    const lines = s.trim().split("\n").filter(Boolean);
    const bad = lines.map(l => JSON.parse(l)).filter(c => c.Health && c.Health !== "healthy");
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
