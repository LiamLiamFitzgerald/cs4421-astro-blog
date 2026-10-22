#!/usr/bin/env bash
# Post-deploy smoke test (ADR-016). Usage: scripts/smoke-test.sh https://example.cloudfront.net
#
# Waits for /api/ready, then checks liveness, readiness, the home page, the game
# page and one static asset. Exits non-zero on the first failure, naming it.
# SMOKE_ATTEMPTS and SMOKE_WAIT (seconds) control the readiness wait.
set -euo pipefail

BASE="${1:?usage: smoke-test.sh BASE_URL}"
BASE="${BASE%/}"
ATTEMPTS="${SMOKE_ATTEMPTS:-20}"
WAIT="${SMOKE_WAIT:-15}"
BODY="$(mktemp)"
trap 'rm -f "$BODY"' EXIT

fail() {
  echo "SMOKE FAIL: $*" >&2
  exit 1
}

# get PATH: fetches into $BODY and prints the status code.
get() { curl -s -o "$BODY" -w '%{http_code}' --max-time 20 "$BASE$1" || true; }

expect() {
  local path="$1" want="$2" contains="${3:-}"
  local code
  code="$(get "$path")"
  [ "$code" = "$want" ] || fail "$path returned HTTP $code, expected $want"
  if [ -n "$contains" ]; then
    grep -q -- "$contains" "$BODY" || fail "$path did not contain: $contains"
  fi
  echo "ok   $path ($code)"
}

for i in $(seq 1 "$ATTEMPTS"); do
  code="$(get /api/ready)"
  [ "$code" = "200" ] && break
  echo "wait /api/ready attempt $i/$ATTEMPTS: HTTP $code"
  [ "$i" = "$ATTEMPTS" ] && fail "/api/ready never returned 200"
  sleep "$WAIT"
done

expect /api/live 200 '"status":"ok"'
expect /api/ready 200 '"status":"ready"'
expect /api/health 200 '"status":"ok"'
expect / 200 '<html'
expect /catan 200 'id="play"'

asset="$(grep -o '/_astro/[^"]*\.css' "$BODY" | head -1 || true)"
[ -n "$asset" ] || fail "/catan links no stylesheet under /_astro/"
expect "$asset" 200

echo "Smoke test passed for $BASE"
