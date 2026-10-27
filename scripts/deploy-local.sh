#!/usr/bin/env bash
# Deploy this checkout into the local DSH profile.
#
# Editing ~/src/dsh-claude-compat does NOT change what DSH runs: DSH imports the
# copy under the profile's node_modules, and only at process start. This script
# copies the source over that copy and reminds you to restart.
#
#   bash scripts/deploy-local.sh                 # default profile: desktop
#   bash scripts/deploy-local.sh --profile web
#   bash scripts/deploy-local.sh --no-backup
#
# Environment: DSH_HOME (default ~/.dsh), DSH_PROFILE (default desktop).
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${DSH_PROFILE:-desktop}"
BACKUP=1

usage() {
  sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)   PROFILE="${2:?--profile 需要参数}"; shift 2 ;;
    --no-backup) BACKUP=0; shift ;;
    -h|--help)   usage; exit 0 ;;
    *) echo "未知参数: $1（用 --help 看用法）" >&2; exit 1 ;;
  esac
done

TARGET="$DSH_HOME/profiles/$PROFILE/node_modules/dsh-claude-compat"
if [[ ! -d "$TARGET" ]]; then
  cat >&2 <<EOF
找不到已安装的插件：
  $TARGET

先把它装进 profile：
  "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \\
    plugin --profile $PROFILE add dsh-claude-compat@latest
EOF
  exit 1
fi

# A deployed copy older than the checkout is the exact failure this script
# exists to prevent; say what is being overwritten so it is recoverable.
if [[ $BACKUP -eq 1 ]]; then
  BK="$DSH_HOME/backups/dsh-claude-compat-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BK"
  cp -a "$TARGET"/. "$BK"/
  echo "备份 → $BK"
fi

# --delete keeps the deployed src an exact mirror (stale modules would otherwise
# linger and get imported).
rsync -a --delete "$SRC_DIR/src/" "$TARGET/src/"
for f in README.md README.zh-CN.md CHANGELOG.md CHANGELOG.zh-CN.md; do
  [[ -f "$SRC_DIR/$f" ]] && cp -a "$SRC_DIR/$f" "$TARGET/"
done

if diff -r "$SRC_DIR/src" "$TARGET/src" >/dev/null; then
  echo "✓ src 已同步 → $TARGET"
else
  echo "✗ 复制后校验不一致，请检查权限" >&2
  exit 1
fi

echo
echo "⚠ 插件在 DSH 启动时 import，改完必须重启 DSH 进程才生效（不是刷新窗口）。"
echo "  配置项（cordis.patch.yml）同理。"
