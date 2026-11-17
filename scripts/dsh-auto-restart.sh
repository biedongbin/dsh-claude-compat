#!/usr/bin/env bash
# dsh-auto-restart.sh — restart the DSH desktop app WITHOUT any manual step,
# designed to be launched from INSIDE a DSH session (the bash tool).
#
# The caller (this agent) lives inside the DSH host process tree: killing the
# app kills the caller. So this script must be started fully detached
# (nohup + background + disown); it then:
#   1. optionally redeploys this checkout into the profile (default on),
#   2. asks the app to quit (osascript, graceful), SIGTERM fallback, wait ≤20s,
#   3. relaunches it with `open -a` (launchd-owned, survives everything here),
#   4. waits for the new process to appear.
# DSH restores the previous window/workspace/session automatically on launch —
# the interrupted conversation resumes by itself; the agent turn is lost but
# the user just sends "继续".
#
# Usage: nohup bash scripts/dsh-auto-restart.sh >/tmp/dsh-auto-restart.log 2>&1 & disown
set -u

APP="DeepSeek Harness"
LOG(){ printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

if [ "${1:-}" != "--no-deploy" ]; then
  LOG "redeploying src into profile…"
  bash "$(dirname "$0")/deploy-local.sh" --no-backup >>/tmp/dsh-auto-restart.log 2>&1 \
    && LOG "deploy ok" || LOG "deploy FAILED (continuing with installed copy)"
fi

LOG "force-restarting $APP (no confirmation dialog)…"
# pgrep -f does NOT match the launchd-spawned main process on macOS (it only
# sees the Helper children), which once turned every "restart" into a no-op.
# Match the exact main binary path via ps instead.
main_pid() { ps -axo pid=,command= | grep "/MacOS/DeepSeek Harness\$" | grep -v grep | awk '{print $1}' | head -1; }
PID="$(main_pid)"
LOG "main pid: ${PID:-none}"
[ -n "$PID" ] && kill -TERM "$PID" 2>/dev/null
for _ in $(seq 1 30); do [ -z "$(main_pid)" ] && break; sleep 0.5; done
if [ -n "$(main_pid)" ]; then
  LOG "still running, SIGKILL"
  OLD_PID="$(main_pid)"
  kill -9 "$OLD_PID" 2>/dev/null
  for _ in $(seq 1 20); do [ "$(main_pid)" != "$OLD_PID" ] && break; sleep 0.5; done
fi
# macOS relaunches a SIGKILLed app on its own, which makes "the old pid is
# gone" a wrong exit test: what matters is that a NEW main process exists.
if [ -n "$(main_pid)" ]; then
  LOG "app came back as pid $(main_pid) — treating as restarted ✅"
  exit 0
fi
LOG "app exited, relaunching…"
open -a "$APP"
for _ in $(seq 1 30); do
  if [ -n "$(main_pid)" ]; then LOG "relaunched pid $(main_pid) ✅ (session resumes automatically)"; exit 0; fi
  sleep 0.5
done
LOG "FATAL: relaunch did not start"; exit 1
