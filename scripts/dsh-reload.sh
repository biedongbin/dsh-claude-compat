#!/usr/bin/env bash
# dsh-reload.sh — load plugin changes WITHOUT restarting the DeepSeek Harness app.
#
# Why this works (verified against @deepseek-ai/dsh-hmr's package reference):
#   "Profile recompositions run by HMR's profile watches and by Plugin Manager
#    also replace plugins whose loaded files below the profile directory changed
#    on disk. This covers installed packages below node_modules ... therefore
#    takes effect without a restart at the next such recomposition; source
#    watching through root is not required."
#
# So: deploy the files, then make a REAL content change to the profile patch file
# (mtime-only `touch` does not reliably emit a change event), and HMR recomposes
# the profile: the host half re-imports, the session keeps running.
#
# The browser half (src/client.js) has its own separate loader, so a page
# refresh is still required for UI changes — but never an app restart.
#
# Usage: bash scripts/dsh-reload.sh            # deploy + recompose
#        bash scripts/dsh-reload.sh --no-deploy   # only recompose
set -uo pipefail

PROFILE="${DSH_PROFILE:-desktop}"
PATCH="$DSH_HOME/profiles/$PROFILE/cordis.patch.yml"
[ -f "$PATCH" ] || PATCH="$HOME/.dsh/profiles/$PROFILE/cordis.patch.yml"

if [ "${1:-}" != "--no-deploy" ]; then
  bash "$(dirname "$0")/deploy-local.sh" --no-backup || exit 1
fi

if [ ! -f "$PATCH" ]; then
  echo "✗ profile patch not found: $PATCH" >&2
  exit 1
fi

# One managed marker line, rewritten in place so the file never grows. Its value
# changes on every run, which is what HMR needs to see.
python3 - "$PATCH" <<'PY'
import io, re, sys, time
path = sys.argv[1]
text = io.open(path, encoding='utf-8').read()
marker = re.compile(r'^# dsh-claude-compat reload trigger: .*$\n?', re.M)
line = f'# dsh-claude-compat reload trigger: {int(time.time() * 1000)}\n'
if marker.search(text):
    text = marker.sub(line, text, count=1)
else:
    if not text.endswith('\n'):
        text += '\n'
    text += line
io.open(path, 'w', encoding='utf-8').write(text)
print(f'· recomposition trigger written to {path}')
PY

# HMR debounces 100 ms and awaits write stability, so give it a moment.
sleep 6
echo
echo "✓ 宿主侧已热重载（App 未重启，会话未中断）"
echo "  UI 改动还需要：刷新页面（Cmd+R）"
