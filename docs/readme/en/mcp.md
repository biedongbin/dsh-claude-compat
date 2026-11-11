[← Project overview](../../../README.md) · [简体中文](../zh-cn/mcp.md)

# MCP servers

The plugin reads MCP servers from these sources, highest precedence first. A name in a higher source hides the same name below it, and the whole entry of the winning source is used. Plugin servers match by URL instead.

| Source | Where it is read |
|---|---|
| Managed | `managed-mcp.json` in the system Claude folder. It takes exclusive control: only this file and `managedMcpServers` load. |
| Managed settings | `managedMcpServers` in `managed-settings.json` in the system Claude folder. |
| Local | `.claude.json`, under `projects["<launch folder>"].mcpServers`. |
| Project | `<projectRoot>/.mcp.json`. |
| User | `.claude.json`, top-level `mcpServers`. The file is in `CLAUDE_CONFIG_DIR` when it is set, and in the home folder otherwise. |
| Plugin | The plugin's own `.mcp.json`, then each `mcpServers` shape in its `plugin.json` (a path, or an inline object). A later name replaces an earlier one. Only with `enablePluginMcp`. |

The system Claude folder is `/Library/Application Support/ClaudeCode` on macOS, `/etc/claude-code` on Linux, and `C:\Program Files\ClaudeCode` on Windows.

Failures fail closed where the policy is at stake:

- An unreadable `managed-settings.json` keeps every MCP server off. A symbolic link to a missing file counts as unreadable.
- An unreadable `managed-mcp.json` keeps the user, project and local servers off. `managedMcpServers` still loads.
- A managed policy that is malformed keeps every MCP server off. That covers a policy list that is not a list, a malformed entry in it (including a host that does not parse), a variable that is not set, and an `allowManagedMcpServersOnly` that is not a boolean.
- An unreadable user, project or local file is reported with what it stops. Its entries are not read.

Every warning names the file or entry, and says what stays off.

Policy comes from the settings files:

- `deniedMcpServers` blocks a server by URL, command or name. The denylist always wins. Plugin servers obey it too.
- A `serverUrl` pattern follows the managed-MCP rules for both lists: a host written out in full matches the default port of the scheme only.
To deny a host on every port and scheme, write `*://host:*`.
- `allowedMcpServers` allows only the matching servers. The lists merge from every settings file, unless managed settings set `allowManagedMcpServersOnly`. Servers from `managedMcpServers` and `managed-mcp.json` skip the allowlist.
- A malformed policy entry in a user, project or local settings file is ignored with a warning. In managed settings it keeps every MCP server off. A policy list that is not a list allows nothing (for `allowedMcpServers`) or denies nothing (for `deniedMcpServers`), with a warning.
- A URL pattern with no port covers the default port only (443 for `https`), as Claude Code documents. A pattern with `*` in the host, or `*` as the port, covers every port. A pattern path of `/` matches only the root path. Write `/*` to match every path. A `serverCommand` entry compares the command and its arguments. It does not compare `env` (as Claude Code documents), and it does not compare `cwd`.
- A policy entry that names a variable which is not set keeps the literal text, and a warning names the variable and the entry. In managed settings, that entry makes the whole managed policy fail closed.
- `disabledMcpjsonServers` in any settings file turns off project servers by name.
- `disabledMcpServers` under this project in `.claude.json` turns off user and managed servers by name.
- An entry in `managedMcpServers` must be a fixed `https://` remote server.
It has no `command`, `args`, `env`, `headersHelper` or `${VAR}`, and an entry that breaks this is skipped with a warning.
`managed-mcp.json` has its own contract and is not held to this rule.
- An entry that is not an object, such as `"bad": null`, is skipped with a warning, and the other servers still load.
- A disabled entry, and an entry that a higher source with the same name hides, are skipped with a warning that names the source.
- A plugin folder with no `plugin.json` still loads the `.mcp.json` at its root.
A path in `mcpServers` must stay inside the plugin folder, and `${CLAUDE_PLUGIN_ROOT}` is the install path.
- A `timeout` above the largest Node timer delay is cut to that delay, with a warning.

Entry handling:

- `${VAR}` and `${VAR:-default}` expand in `command`, `args`, `env`, `url` and `headers`. An unset variable with no default keeps the literal text, and a warning names it.
- `timeout` sets the per-call limit in milliseconds. A value under 1000 is ignored.
- `headersHelper` runs at mount, with a 10-second limit. Its JSON output overrides the static `headers`. A helper that fails skips its server. Under an `allowedMcpServers` list, only organization servers may use a helper, because the list cannot see the helper command.
- A `headersHelper` from a project `.mcp.json` is a command that the repository supplies.
It runs only when `mcpTrustProjectConfig` is `true`, and then without the credential variables of the user.
A variable name with `TOKEN`, `SECRET`, `PASS`, `KEY`, `AUTH`, `CRED`, `COOKIE` or `DSN` in it is removed, except Git's `GIT_CONFIG_KEY_<n>`, and so are `ANTHROPIC_CUSTOM_HEADERS` and a variable whose value is a URL with a password.
The values of removed variables are replaced with `REDACTED` in the `CLAUDE_CODE_MCP_SERVER_URL` that the helper receives.
A trusted project helper is still a shell command, and it can read the files of the user.
- `${VAR}` in a project `.mcp.json` does not read a credential variable (the same names) unless `mcpTrustProjectConfig` is `true`.
The literal text stays and the log names the variable.
This keeps a repository from sending a credential to a server that it names.
While the option is `false`, the server mounts with its static `headers` and the log names the server.
A helper from the user, local or managed source keeps the environment of the user.
- `type: stdio` and `type: http` (or `streamable-http`) run. An entry with a `url` and no `type` is skipped, as Claude Code skips it.
- A field of the wrong type, such as a non-string `args` item, skips the entry. The warning names the field.
- A field that the transport never reads, such as `url` on a stdio entry, is reported as ignored.
- Stdio servers get `CLAUDE_PROJECT_DIR` in their environment.

### Gaps: what cannot run in DSH

These Claude Code features do not run here. The plugin warns when a file uses one, and the rest of the entry still loads.

| Claude Code feature | Why it cannot run |
|---|---|
| `type: sse` and `type: ws` | DSH's MCP client has stdio and streamable-http only. The entry is skipped. |
| `oauth` | DSH's MCP client has no OAuth flow. The server loads without it, and it may fail to connect. |
| `alwaysLoad` | DSH loads every tool at startup. There is no deferred tool loading. The field is ignored. |
| `headersHelper` on reconnect | DSH sets headers once, at mount. The helper does not run again on reconnect or after a 401. |
| `headersHelper` on plugin servers | Not run. A plugin server with a helper is skipped, with a warning, because it could not authenticate. |
| Server-managed settings, MDM profiles and registry policy | Only the files on disk are read. |
| `--mcp-config` and `--strict-mcp-config` | DSH has no launch flag for them. |
| claude.ai connectors | They need a claude.ai account fetch. |
| MCP bundles (`.mcpb`, `.dxt`) and URLs in a plugin's `mcpServers` | Not supported. The entry is skipped, with a warning. |
| `enableAllProjectMcpServers` and `enabledMcpjsonServers` | Ignored. Project servers always load, as `claude -p` loads them. DSH has no approval prompt. |
| `enabledMcpServers` | Opt-in list for built-in servers. DSH has no built-in MCP servers. |
| Subagent `mcpServers` in `agents/*.md` | Not read by this plugin. Upstream PR #5 (MCP in agent realms) is the related work. |
| `${VAR}` in policy entries | Expands from the live process environment. Claude Code pins that environment. |
| Default `timeout` | 60 seconds. Claude Code uses about 28 hours. |
