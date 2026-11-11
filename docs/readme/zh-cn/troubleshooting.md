[← 项目首页](../../../README.zh-CN.md) · [English](../en/troubleshooting.md)

# 故障排查

### 旧式归档 CLI

独立 CLI 用于旧式历史归档，与原生文件引用接续是两条路径。创建归档时显式传入项目和自定义 Claude 配置目录：

```bash
node node_modules/dsh-claude-compat/scripts/cc-resume.mjs list --cwd /path/to/project
node node_modules/dsh-claude-compat/scripts/cc-resume.mjs import <sessionId> --cwd /path/to/project --user-claude-dir /path/to/claude-config
```

**重启后 DSH 起不来 / 3080 端口卡死。** 旧进程占着端口（日志特征 `EADDRINUSE`）。用自带重启脚本 —— 干净等待停止、SIGKILL 兜底、探活端口后才报成功：

```bash
npx dsh-claude-compat-restart        # bin 别名（装包即得）
bash node_modules/dsh-claude-compat/scripts/dsh-restart.sh   # 直接跑
bash scripts/dsh-restart.sh --no-patch   # 跳过 prompt 补丁，只重启
```

脚本同时会重新幂等打 `dsh-terminal-bash` 的 prompt 补丁（npx/npm 更新会悄悄还原它）。`DSH_RESTART_PORT` 可覆盖端口（默认 3080）。

**`/cc-plugin` 装了插件但技能没出现。** 先 `/reload-cc-plugins`。仍没有 → 重启 DSH（插件自带 MCP 服务器必须重启）。

**旧式归档 CLI 报压缩错误。** 该独立工具需要 `zstd`（macOS：`brew install zstd`）。原生 `/cc-resume` 的文件引用接续不压缩会话，无需 `zstd` 二进制。

**`/cc-plugin` 提示 claude CLI 不可用。** 安装 Claude Code（`npm install -g @anthropic-ai/claude-code`）后再变更插件或市场。仍可浏览本地目录；变更失败不会降级为直接修改注册表。
