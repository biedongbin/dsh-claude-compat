#!/usr/bin/env bash
# dsh-restart.sh — restart the DSH Web GUI safely, with an optional
# terminal-bash prompt patch.
#
# What it does:
#   1. (optional, --no-patch to skip) Patch the dsh-terminal-bash plugin's
#      hardcoded "dsh> " prompt so DSH's own placeholder prompt is honored.
#      Idempotent: skips when already patched. Re-run after every npx/npm
#      refresh of DSH (the cache overwrite reverts the patch).
#   2. Stop any running `dsh web` (graceful wait, up to 10s).
#   3. Start `dsh web` in the background (nohup), log to a temp file.
#   4. Wait until http://127.0.0.1:3080 responds (up to 30s); on timeout
#      print the last 20 log lines and exit 1.
#
# Requires: bash, curl. Works with a global `dsh`, an nvm-installed `dsh`,
# or the npx cache layout (`~/.npm/_npx/*/node_modules/.bin/dsh`).
set -euo pipefail

PORT="${DSH_RESTART_PORT:-3080}"
PATCH=1
for arg in "$@"; do
  case "$arg" in
    --no-patch) PATCH=0 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg (see --help)" >&2; exit 2 ;;
  esac
done

# ── 1. terminal-bash prompt patch (idempotent) ───────────────────────────────
if [ "$PATCH" = 1 ]; then
  OLD_PROMPT='const CONTROLLED_PROMPT = "dsh> ";'
  NEW_PROMPT='const CONTROLLED_PROMPT = "__DSH_PERSISTENT_BASH_PROMPT__ ";'
  OLD_LEN='Math.max(0, 6 - this.promptTail.length)'
  NEW_LEN='Math.max(0, CONTROLLED_PROMPT.length + 1 - this.promptTail.length)'

  # Find every installed copy of dsh-terminal-bash: npx cache + any global
  # node_modules reachable from `dsh`'s real location.
  CANDIDATES="$(ls "$HOME"/.npm/_npx/*/node_modules/@deepseek-ai/dsh-terminal-bash/lib/index.js 2>/dev/null || true)"
  DSH_ON_PATH="$(command -v dsh || true)"
  if [ -n "$DSH_ON_PATH" ]; then
    REAL="$(readlink -f "$DSH_ON_PATH" 2>/dev/null || echo "$DSH_ON_PATH")"
    ROOT="$(dirname "$(dirname "$(dirname "$(dirname "$REAL")")")")"
    [ -f "$ROOT/@deepseek-ai/dsh-terminal-bash/lib/index.js" ] && CANDIDATES="$CANDIDATES
$ROOT/@deepseek-ai/dsh-terminal-bash/lib/index.js"
  fi

  if [ -z "$CANDIDATES" ]; then
    echo "[fix] no dsh-terminal-bash installation found; skipping patch"
  else
    for FILE in $CANDIDATES; do
      if grep -qF "$NEW_PROMPT" "$FILE" && grep -qF "$NEW_LEN" "$FILE"; then
        echo "[fix] already patched: $FILE"
        continue
      fi
      echo "[fix] patching: $FILE"
      if sed -i.bak -e "s|$OLD_PROMPT|$NEW_PROMPT|" -e "s|$OLD_LEN|$NEW_LEN|" "$FILE" 2>/dev/null \
         || sed -i '' -e "s|$OLD_PROMPT|$NEW_PROMPT|" -e "s|$OLD_LEN|$NEW_LEN|" "$FILE"; then
        rm -f "$FILE.bak"
        grep -qF "$NEW_PROMPT" "$FILE" && grep -qF "$NEW_LEN" "$FILE" \
          || { echo "[fix] patch failed on $FILE"; exit 1; }
      else
        echo "[fix] cannot write $FILE (permissions?); skipping"; continue
      fi
    done
  fi
fi

# ── 2. stop running dsh web ──────────────────────────────────────────────────
echo "[restart] stopping dsh web"
pkill -f "dsh web" 2>/dev/null || true
for _ in $(seq 1 20); do pgrep -f "dsh web" >/dev/null || break; sleep 0.5; done
if pgrep -f "dsh web" >/dev/null; then
  echo "[restart] dsh web did not stop; last resort SIGKILL"
  pkill -9 -f "dsh web" 2>/dev/null || true
  sleep 1
  pgrep -f "dsh web" >/dev/null && { echo "[restart] cannot stop dsh web"; exit 1; }
fi

# ── 3. locate the dsh binary ─────────────────────────────────────────────────
DSH_BIN="$(command -v dsh || true)"
if [ -z "$DSH_BIN" ]; then
  # newest npx cache entry first (npm exec resolves to the same one)
  DSH_BIN="$(ls -t "$HOME"/.npm/_npx/*/node_modules/.bin/dsh 2>/dev/null | head -1 || true)"
fi
if [ -z "$DSH_BIN" ]; then
  echo "[restart] no dsh binary found (PATH or npx cache). Install with: npm install -g @deepseek-ai/dsh" >&2
  exit 1
fi
echo "[restart] using: $DSH_BIN"

# ── 4. start + health-check ──────────────────────────────────────────────────
LOG="$(mktemp -t dsh-web-restart)"
echo "[restart] starting dsh web on :$PORT"
nohup "$DSH_BIN" web >"$LOG" 2>&1 &
PID=$!
echo "[restart] pid=$PID log=$LOG"
for _ in $(seq 1 30); do
  if curl -sf -o /dev/null "http://127.0.0.1:$PORT"; then
    echo "[restart] http://127.0.0.1:$PORT is up ✅"
    exit 0
  fi
  kill -0 "$PID" 2>/dev/null || break
  sleep 1
done
echo "[restart] failed; last log lines:"
tail -20 "$LOG"
exit 1
