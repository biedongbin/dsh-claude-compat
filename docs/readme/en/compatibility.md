[← Project overview](../../../README.md) · [简体中文](../zh-cn/compatibility.md)

# 1.2.1: DSH compatibility, native management and session handoff

The sidebar Plugins page includes a **Claude Code** tab with installed plugins, discovery and marketplaces, plus conversation history and bridge status. Version 1.2.1 supports **DSH 0.2.1-rc.2 and 0.2.2-rc.1**; **Node.js 24** is the recommended runtime. Compatibility maintenance follows a rolling two-version policy: each upgrade explicitly lists and tests the two supported DSH releases, replacing the older entry rather than promising support for unknown future releases. See the [1.2.1 changelog](../../../CHANGELOG.md#121--2026-11-08) for the hook service-access and tool-execution fixes.

- **Manage plugins and marketplaces:** install new plugins, add marketplaces, search their catalogs, and enable, disable, update or uninstall entries. Lists start at 10 items per page, with 10/20/50/100 selectable.
- **Submit independent operations:** each item has its own queued/running state, result and cancellation. Other items stay usable; writes to the same Claude configuration and cache execute in sequence. Mutations use the Claude CLI in user scope, report real failures and refresh the skill catalog after successful changes. Seed and inline sources are read-only.
- **Use commands from a blank conversation:** `/cc-plugin` and `/cc-resume` open interactive managers without a model round trip. If the first input is a management command, its result appears above the composer; the regular chat view takes over when the conversation starts.
- **Read Claude history in DSH:** search and preview sessions, then send only the selected source file's path and a short reading request. DSH reads as needed and summarizes the background, current task state and next-step plan; transcript bodies are not inlined. A management-page click creates a normal DSH conversation in the source project's Workspace. A `/cc-resume` card inside a conversation uses that current session, preserving its messages, directory and model.
- **Export and refresh:** `/cc-export` uses the Session's effective directory and resolves a real Node interpreter on Desktop. Both reload aliases wait for catalog invalidation and expose failures.

Management pages, commands and the `claude_compat` tool share the operation service. UI operations require the authenticated owner; tool access to user-level Claude configuration and history requires full access or approval. Version changes are recorded in the [full changelog](../../../CHANGELOG.md).

### Upgrading existing configurations

1. Give HTTP MCP entries an explicit `"type": "http"` (or `"streamable-http"`). URL-only, SSE and WebSocket entries are skipped with a warning.
2. Keep `mcpTrustProjectConfig: false` unless you trust the project. Project helpers do not run and credential references stay literal by default; see [MCP servers](mcp.md#mcp-servers).
3. Review project hooks before enabling them: there is no workspace-trust prompt. Restart DSH after the update to reload MCP and hooks from the launch workspace.

Earlier configuration and legacy-archive migration details are in the [1.1.0 changelog](../../../CHANGELOG.md#110--2026-11-05).
