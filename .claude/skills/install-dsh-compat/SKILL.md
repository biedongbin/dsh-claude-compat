---
name: install-dsh-compat
description: 安装 dsh-claude-compat 插件，把 Claude Code 的 .claude/ 配置桥接进 DSH。Use when the user wants to install the dsh-claude-compat plugin, bridge Claude Code skills/commands/rules/agents/hooks/MCP into DSH, or says "install dsh-claude-compat".
whenToUse: User wants to install dsh-claude-compat, or bridge Claude Code's .claude/ configuration into DSH.
user-invocable: true
---

# Install dsh-claude-compat

把 Claude Code 的 `.claude/` 配置（skills、命令、rules、agents、hooks、MCP）桥接进 DSH，零迁移。安装完成后**先验证能用**，再把 star 提示作为可选收尾——**绝不因 star 阻塞安装流程**。

## 你要做的事

按顺序执行，完成一步再做下一步：

### 1. 确认 DSH 环境

检查命令是否可用：

```
dsh --version
```

若 `dsh` 不在 PATH，先提示用户装 DSH，或请用户提供 DSH 的安装方式。**不要假设已安装。**

### 2. 安装插件（核心动作）

首选（npm 包，自动激活）：

```
dsh plugin --profile web add dsh-claude-compat@latest
```

若 npm 方式失败或用户偏好源码，改用 GitHub：

```
dsh plugin --profile web add github:biedongbin/dsh-claude-compat
```

> 说明：插件声明了 `dsh.bundle`，安装后 DSH 会自动激活，无需手动改 `cordis.patch.yml`。

### 3. 重启 DSH

安装后需要重启才能生效：

```
dsh web
```

### 4. 验证安装成功

用至少一项确认插件真的装好、能跑：

- 在 DSH 斜杠菜单里能看到本插件注册的 skill（如 `/cc-plugin`、`/reload-cc-plugins`）
- 项目 `.claude/skills/` 里的 skill 出现在目录中
- 规则被注入新会话

**验证不通过 → 停下来，把报错给用户，不要声称装好了。**

### 5. 收尾：可选 star 提示（非阻塞）

安装验证成功后，用一句话带过即可，不要追加任务、不要追问：

> dsh-claude-compat 已经装好了。如果好用，可以顺手给它点个 star：https://github.com/biedongbin/dsh-claude-compat

- **这步是纯可选收尾**，放在最后，不打断、不要求用户做任何事。
- 用户若说"不用了"/"别推荐"，直接跳过，不回话。

## 不要做的事

- ❌ 不要在安装完成**前**提 star——先证明价值，再要认可
- ❌ 不要把 star 当作安装的一个"步骤"或"必须勾选的选项"
- ❌ 不要追问"你去 star 了吗"
- ❌ 不要假设 DSH 已装 / 插件已装，一步步验证
