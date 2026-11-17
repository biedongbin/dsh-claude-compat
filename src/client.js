window.__ModuleLoader__.load({
  id: 'dsh-claude-compat',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef } = React;
    const dictionaries = {
      en: {
        title: 'Claude Code', plugins: 'Installed plugins', search: 'Discover', find: 'Search', markets: 'Marketplaces',
        sessions: 'Sessions', status: 'Bridge status', loading: 'Loading…', retry: 'Retry', refresh: 'Refresh',
        query: 'Search by name or description', enabled: 'Enabled', disabled: 'Disabled',
        empty: 'Nothing matches. Try another category, clear the search, or check that the project has a .claude/ directory.',
        searchAsYouType: 'Type to search — results update as you type',
        activeFilters: 'Narrowed by', removeFilter: 'Remove this filter', clearFilters: 'Clear all',
        noMatchFor: 'Nothing matches these filters:', sourceLabel: 'Source',
        enable: 'Enable', disable: 'Disable', update: 'Update', remove: 'Uninstall', install: 'Install',
        target: 'Plugin name@marketplace', marketTarget: 'Marketplace repository, URL or directory', add: 'Add marketplace',
        confirm: 'Confirm', cancel: 'Cancel', confirmRemove: 'Remove this item?', running: 'Running',
        queued: 'Queued', submitting: 'Submitting…', tasks: 'Tasks', active: 'Pending', truncated: 'Showing the end of the log; earlier output was truncated.', reset: 'Background tasks were reset after a reload; refresh to check the outcome.',
        done: 'Completed', failed: 'Operation failed', cancelled: 'Cancelled', skillsReloaded: 'Skill catalog refreshed',
        restart: 'MCP and hook changes require a DSH restart.', project: 'Project directory', choose: 'Choose directory',
        projectHistory: 'Recent projects', sessionSearch: 'Search session titles', preview: 'Preview',
        collapsePreview: 'Collapse preview', quickResume: 'Quick resume', resumeContext: 'Read history and summarize', handoffAccepted: 'Reading request sent to DSH',
        resumeCurrent: 'Continue in this DSH conversation', resumeNew: 'Continue in a new DSH conversation in the source project', noCurrentSession: 'The current DSH conversation could not be identified.',
        noPreview: 'No text preview is available; you can still resume this conversation.', previewTruncated: 'Preview is limited; resuming uses the conversation history.',
        pageSize: 'Items per page', pagination: 'Pagination', marketHint: 'Use owner/repository, an HTTP(S)/SSH URL, or an absolute directory.', pluginHint: 'Enter a plugin name or name@marketplace.',
        import: 'Import and continue', open: 'Open in DSH', imported: 'Already imported', snapshot: 'Create a separate snapshot',
        range: 'Background range', all: 'Full conversation', recent200: 'Recent 200 turns', recent50: 'Recent 50 turns',
        source: 'Claude configuration', pluginRoot: 'Plugin directory', version: 'Bridge version', pluginVersion: 'Plugin version',
        noSessions: 'No Claude Code sessions in this project. Choose another directory or refresh.',
        next: 'Next page', previous: 'Previous page', archiveNote: 'Send the conversation file path to DSH and ask for its background, current task state and next steps. DSH reads the file as needed.',
        userScope: 'User scope', result: 'Operation details', noCli: 'Installation and updates use the Claude CLI.',
        partial: 'Some content could not be imported', statusUnavailable: 'Cannot read bridge status',
        available: 'Available', unavailable: 'Unavailable', nativeSessions: 'History archive', contextHandoff: 'Context handoff',
        skills: 'Skills', rules: 'Rules', hooks: 'Hooks', mcp: 'MCP', pluginMcp: 'Plugin MCP',
        commandResults: 'Command results', show: 'Show manager', hide: 'Collapse manager', permissions: 'Only the DSH owner can manage Claude Code configuration.',
        bridge: 'Claude bridge', invTitle: 'Claude bridge inventory', invHint: 'Claude configuration discovered for this project, including plugin declarations. A declaration does not confirm runtime activation. Switches control DSH injection and persist in the project state file.',
        globalCounts: 'All project items', parentDisabled: 'Disabled by the owning plugin. Enable the plugin to use this item.', claudeDisabled: 'The owning plugin is disabled in Claude. Enable it in Claude to use this item.', declarationOnly: 'Configuration declaration only; runtime activation has not been verified.', pluginToggleScope: 'Controls DSH skill, command and agent injection; it does not change running MCP servers or hooks.', invPlugins: 'Plugins', invSkills: 'Skills', invCommands: 'Commands', invAgents: 'Agents', allKinds: 'All',
        srcProject: 'project .claude', srcUser: 'user ~/.claude', srcPlugin: 'plugin', srcMcp: 'mcp config',
        shadowed: 'Not effective — a same-name item with a higher priority wins', displayOnly: 'Display-only',
        dshState: 'In DSH', claudeState: 'In Claude', stateFile: 'State file', offCount: 'disabled',
        writeBack: 'Write back to Claude', upcoming: 'Planned for the next milestone', openInventory: 'Open inventory page',
        updateAll: 'Update all plugins', alreadyPending: 'Already pending', waitingForCapacity: 'Waiting for running tasks to finish…', sourceChanged: 'The file changed since it was opened. Reload it to view the matching translation.',
        updating: 'Queueing plugin updates…', updateQueued: 'Update tasks queued', updateProgress: 'Updates',
        trash: 'Trash', trashEmpty: 'Trash is empty.', restore: 'Restore', moveToTrash: 'Move to trash', confirmTrash: 'Move to trash? You can restore it later.',
        writeBackDisable: 'Write back to Claude: disable', writeBackEnable: 'Write back to Claude: enable',
        clear: 'Clear', uninstallPlugin: 'Uninstall plugin (Claude side)',
        ownedBy: 'Owning plugin',
        filePath: 'File path', backToDetail: 'Back to details',
        copied: 'Copied', copyFailed: 'Copy failed — select the path manually', retranslate: 'Translate again', byModel: 'translated by model', originalPane: 'Original', translatedPane: 'Translation', translate: 'Translate', showOriginal: 'Show original', translateTo: 'to', translating: 'Translating…',
        fromCache: 'cached', translateNote: 'View only — the original file is never modified; code blocks are left as-is.', viewContent: 'View content', copyPath: 'Copy path', truncated: 'Large file — only the beginning is shown.', reload: 'Reload',
        lastUpdated: 'Last updated', updateTimeUnknown: 'No update time in Claude’s install record',
        checkingTranslation: 'Checking translation task…', translationChunks: 'chunks completed', translationProgress: 'Translation progress',
        translationContinues: 'You can leave this view; translation continues. Reopening restores its progress without starting another request.',
        provides: 'What this plugin provides', providesNone: 'No supported content was found in this installation. View the plugin manifest to inspect it.',
        providesDrill: 'Show this plugin\'s items of this kind', filteredByPlugin: 'Plugin only: ', clearFilter: 'Show all',
        shadowTitle: 'Duplicate — DSH did not load this copy',
        duplicates: 'Duplicates', back: 'Back', backEmpty: 'No previous view', duplicateShort: 'Duplicate', usedKind: 'uses', usedFrom: 'uses',
        duplicatesHint: 'Show same-name copies that were not loaded (hidden by default; they change nothing)',
        shadowSamePluginA: 'The same plugin, ',
        shadowSamePluginB: ', ships two copies: the one in use is its ',
        shadowSamePluginC: ' copy; the row you opened is the ',
        shadowSamePluginD: ' copy. DSH and Claude Code both key on the name, and one name loads once, so the other copy is skipped.',
        shadowOtherPluginA: 'Another plugin, ',
        shadowOtherPluginB: ', ships a same-name item with higher priority; its ',
        shadowOtherPluginC: ' copy is in use and this one is skipped.',
        shadowDecision: 'What to do: nothing. It does not run twice and costs no extra context — it is simply an ignored copy. Only if you actually want this copy do you need to act: switch off the copy in use, or disable it inside its own plugin.',
        shadowJump: 'Go to the copy in use',
        shadowRowTitle: 'This copy is not loaded; DSH uses another same-name item (see the right pane)',
        toggleScope: 'Affects DSH only; Claude Code keeps working as before.',
        confirmTrash: 'Move to the trash? This moves a real file on disk.',
        trashHint: 'Note: this moves a real file on disk, so Claude Code loses it too — it is not hidden from DSH alone. The file goes to <project>/.dsh/trash with its original path recorded, and Restore brings it back.',
        trashNotForPlugin: 'This item belongs to a plugin and cannot be removed on its own — that would corrupt the install. Use the plugin actions above (write back to Claude: disable, or uninstall), or switch it off in the plugin page. Owning plugin: ',
        confirmWriteBack: 'Write back to Claude: ',
        pluginActionHint: 'Write-back edits Claude\'s own settings.json enabledPlugins, so it applies to Claude Code and DSH together.',
        confirmUninstall: 'Uninstall this plugin?', originalPath: 'Original path', trashedAt: 'Trashed at',
        srcLabel: 'Source', rankLabel: 'Priority', prioProject: 'high — project .claude', prioBundled: 'above user — DSH built-in',
        prioUser: 'low — user ~/.claude', prioPlugin: 'lowest — plugin', shadowedShort: 'Inactive',
        m2Note: 'Write-back and uninstall ship in the next milestone; available today: the DSH toggle and plugin update.',
        allSources: 'All', groupByPlugin: 'Group by plugin', groupProject: 'project .claude', groupUser: 'user ~/.claude', groupUngrouped: 'Other',
        notSelected: 'Select an item to see its details.', marketplace: 'Marketplace', installPath: 'Install path',
      },
      zh: {
        title: 'Claude Code', plugins: '已安装插件', search: '发现插件', find: '搜索', markets: '插件市场',
        sessions: '历史会话', status: '桥接状态', loading: '正在加载…', retry: '重试', refresh: '刷新',
        query: '搜索名称或描述', enabled: '已启用', disabled: '已禁用',
        empty: '没有匹配的内容。换个分类、清空搜索，或确认项目的 .claude/ 目录是否存在。',
        searchAsYouType: '输入即搜索，无需确认',
        activeFilters: '当前筛选', removeFilter: '移除该筛选', clearFilters: '清空全部筛选',
        noMatchFor: '没有符合以下筛选的内容：', sourceLabel: '来源',
        enable: '启用', disable: '禁用', update: '更新', remove: '卸载', install: '安装',
        target: '插件名@市场名', marketTarget: '市场仓库、地址或本地目录', add: '添加市场',
        confirm: '确认', cancel: '取消', confirmRemove: '确认移除此项？', running: '执行中',
        queued: '排队中', submitting: '正在提交…', tasks: '任务', active: '待完成', truncated: '仅显示日志末尾，较早内容已截断。', reset: '后台任务已随重载重置，请刷新确认操作结果。',
        done: '操作完成', failed: '操作失败', cancelled: '已取消', skillsReloaded: '技能目录已刷新',
        restart: 'MCP 与 Hook 变更需要重启 DSH。', project: '项目目录', choose: '选择目录',
        projectHistory: '最近项目', sessionSearch: '搜索会话标题', preview: '预览',
        collapsePreview: '收起预览', quickResume: '一键恢复', resumeContext: '阅读并总结', handoffAccepted: '已请求 DSH 读取会话',
        resumeCurrent: '将在当前 DSH 会话继续', resumeNew: '将在源项目工作区新建 DSH 会话并继续', noCurrentSession: '无法确认当前 DSH 会话，暂不能在此继续。',
        noPreview: '暂无可显示的文本预览，仍可恢复此会话。', previewTruncated: '预览内容有限，恢复时会使用会话历史。',
        pageSize: '每页条数', pagination: '分页', marketHint: '支持 owner/repository、HTTP(S)/SSH 地址或本地绝对目录。', pluginHint: '输入插件名称，或使用 插件名@市场名。',
        import: '导入并继续', open: '在 DSH 中打开', imported: '已导入', snapshot: '另建独立快照',
        range: '背景范围', all: '完整对话', recent200: '最近 200 轮', recent50: '最近 50 轮',
        source: 'Claude 配置目录', pluginRoot: '插件目录', version: '兼容插件版本', pluginVersion: '插件版本',
        noSessions: '此项目没有 Claude Code 会话，可选择其他目录或刷新。',
        next: '下一页', previous: '上一页', archiveNote: '只发送会话文件路径，请 DSH 阅读后简述背景、当前任务状态和下一步计划；文件内容由 DSH 按需读取。',
        userScope: '用户级', result: '操作详情', noCli: '安装与更新通过 Claude CLI 执行。',
        partial: '部分内容未能导入', statusUnavailable: '无法读取桥接状态',
        available: '可用', unavailable: '不可用', nativeSessions: '历史归档', contextHandoff: '上下文接续',
        skills: '技能', rules: '规则', hooks: 'Hooks', mcp: 'MCP', pluginMcp: '插件 MCP',
        commandResults: '命令结果', show: '展开管理界面', hide: '收起管理界面', permissions: '仅 DSH 所有者可管理 Claude Code 配置。',
        bridge: 'Claude 桥接', invTitle: 'Claude 桥接总览', invHint: '本项目发现的 Claude 配置及插件声明；声明不代表已经在运行。开关控制 DSH 注入，持久化在项目状态文件里。',
        globalCounts: '项目全部条目', parentDisabled: '所属插件已在 DSH 中禁用，启用该插件后才能使用此项。', claudeDisabled: '所属插件已在 Claude 中禁用，请先启用该插件。', declarationOnly: '仅展示配置声明，未验证实际运行状态。', pluginToggleScope: '只控制 DSH 技能、命令和 Agent 注入，不改变运行中的 MCP 或 Hook。', invPlugins: '插件', invSkills: '技能', invCommands: '命令', invAgents: 'Agents', allKinds: '全部',
        srcProject: '项目 .claude', srcUser: '用户 ~/.claude', srcPlugin: '插件', srcMcp: 'MCP 配置',
        shadowed: '未生效——被更高优先级的同名项覆盖', displayOnly: '仅展示',
        dshState: 'DSH 内', claudeState: 'Claude 侧', stateFile: '状态文件', offCount: '已禁用',
        writeBack: '回写 Claude', upcoming: '下一里程碑实现', openInventory: '打开总览页',
        updateAll: '一键更新插件', alreadyPending: '已在处理中', waitingForCapacity: '等待正在执行的任务释放队列容量…', sourceChanged: '文件已在打开后发生变化，请重新读取以显示对应译文。',
        updating: '正在排队插件更新任务…', updateQueued: '已排队更新任务', updateProgress: '更新进度',
        trash: '回收站', trashEmpty: '回收站为空。', restore: '恢复', moveToTrash: '移入回收站', confirmTrash: '确认移入回收站？之后可在回收站恢复。',
        writeBackDisable: '回写 Claude：禁用', writeBackEnable: '回写 Claude：启用',
        clear: '清除', uninstallPlugin: '卸载插件（Claude 侧）',
        ownedBy: '所属插件',
        filePath: '文件路径', backToDetail: '返回详情',
        copied: '已复制', copyFailed: '复制失败，请手动选择路径', retranslate: '重新翻译', byModel: '由模型翻译', originalPane: '原文', translatedPane: '译文', translate: '翻译', showOriginal: '看原文', translateTo: '译为', translating: '正在翻译…',
        fromCache: '来自缓存', translateNote: '仅用于查看，不会修改原文件；代码块保持原样。', viewContent: '查看内容', copyPath: '复制路径', truncated: '文件较大，只显示前面一部分。', reload: '重新读取',
        lastUpdated: '最后更新时间', updateTimeUnknown: 'Claude 安装记录未提供时间',
        checkingTranslation: '正在检查翻译任务…', translationChunks: '段已完成', translationProgress: '翻译进度',
        translationContinues: '可以返回详情，翻译会在后台继续；再次打开将恢复进度，不会重复发起请求。',
        provides: '这个插件提供了什么', providesNone: '当前安装目录未发现可识别的内容，可点击“查看内容”检查插件清单。',
        providesDrill: '点击查看该插件的这一类内容', filteredByPlugin: '只看插件：', clearFilter: '显示全部',
        shadowTitle: '这条是重复项，DSH 没有加载它',
        duplicates: '重复项', back: '返回', backEmpty: '没有可返回的上一步', duplicateShort: '重复项', usedKind: '已用', usedFrom: '已用',
        duplicatesHint: '显示同名但未被加载的重复条目（默认隐藏，它们不影响实际效果）',
        shadowSamePluginA: '同一个插件 ',
        shadowSamePluginB: ' 里同时提供了两种副本：生效的是 ',
        shadowSamePluginC: ' 版；你正在看的这条是 ',
        shadowSamePluginD: ' 版。DSH 与 Claude Code 都按名字识别，一个名字只能加载一份，所以另一份被跳过。',
        shadowOtherPluginA: '另一个插件 ',
        shadowOtherPluginB: ' 提供了同名条目，优先级更高，生效的是它的 ',
        shadowOtherPluginC: ' 版；你现在看的这条被跳过。',
        shadowDecision: '要不要处理：不用。它不会重复运行，也不额外占用上下文，只是一个被忽略的副本。只有当你确实想用这份副本时，才需要处理——去关掉上面说的那条生效项，或在它所属的插件里禁用。',
        shadowJump: '跳到当前生效的那条',
        shadowRowTitle: '这条不会被加载；DSH 用的是另一个同名条目（见右栏说明）',
        toggleScope: '只影响 DSH：Claude Code 里照旧可用。',
        confirmTrash: '确认移入回收站？这会移动磁盘上的真实文件。',
        trashHint: '注意：移入回收站移动的是磁盘上的真实文件，Claude Code 侧也会随之失去它（不是只在 DSH 里隐藏）。文件移入项目 .dsh/trash 并记录原路径，可随时在「回收站」恢复。',
        trashNotForPlugin: '这条属于插件，不能单独移出——那会破坏插件完整性。请用上方插件的「回写 Claude：禁用」或「卸载插件」，或在插件页关掉它的 DSH 开关。所属插件：',
        confirmWriteBack: '回写 Claude：',
        pluginActionHint: '「回写 Claude」修改的是 Claude 官方 settings.json 的 enabledPlugins，对 Claude Code 和 DSH 同时生效。',
        confirmUninstall: '确认卸载该插件？', originalPath: '原路径', trashedAt: '移入时间',
        srcLabel: '来源', rankLabel: '优先级', prioProject: '高 · 项目 .claude', prioBundled: '高于用户 · DSH 原生',
        prioUser: '低 · 用户 ~/.claude', prioPlugin: '最低 · 插件', shadowedShort: '未生效',
        m2Note: '回写 Claude 与卸载是下一版本功能；当前可用：DSH 开关、插件更新。',
        allSources: '全部', groupByPlugin: '按插件聚合', groupProject: '项目 .claude', groupUser: '用户 ~/.claude', groupUngrouped: '其他',
        notSelected: '选择一个条目查看详情。', marketplace: '市场', installPath: '安装路径',
      },
    };
    const css = `
.dcc{font:inherit;color:var(--dsw-alias-label-primary);min-width:0;width:100%;box-sizing:border-box;padding:20px 0;line-height:1.5}
.dcc *{box-sizing:border-box}.dcc h2{font-size:18px;line-height:1.4;margin:0}.dcc h3{font-size:14px;margin:0}.dcc p{margin:6px 0}.dcc header,.dcc-toolbar,.dcc-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dcc header{justify-content:space-between;margin-bottom:16px}.dcc-nav{display:flex;gap:4px;flex-wrap:wrap;padding-bottom:14px;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:18px}.dcc button,.dcc input,.dcc select{font:inherit;font-size:13px;min-height:34px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;color:inherit;background:var(--dsw-alias-bg-layer-1);padding:6px 10px}.dcc button{cursor:pointer}.dcc button:hover{background:var(--dsw-alias-bg-layer-2)}.dcc button:disabled{opacity:.5;cursor:default}.dcc button:focus-visible,.dcc input:focus-visible,.dcc select:focus-visible,.dcc summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dcc button[aria-pressed=true]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}.dcc .dcc-primary{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);font-weight:600}.dcc .dcc-danger{color:var(--dsw-alias-state-error-primary)}.dcc-toolbar{margin:12px 0}.dcc-toolbar input{flex:1;min-width:160px}.dcc-list{list-style:none;padding:0;margin:0}.dcc-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.dcc-main{min-width:0;flex:1}.dcc-title{font-weight:600;overflow-wrap:anywhere}.dcc-subtle{font-size:12px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}.dcc-tag{display:inline-block;border:1px solid var(--dsw-alias-border-l1);border-radius:5px;padding:1px 6px;margin:4px 6px 0 0;font-size:11px;color:var(--dsw-alias-label-secondary)}.dcc-notice{padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-wrap:anywhere}.dcc-error{color:var(--dsw-alias-state-error-primary)}.dcc-ok{color:var(--dsw-alias-state-success-primary)}.dcc pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;font-size:12px;max-height:260px;overflow:auto;padding:12px;background:var(--dsw-alias-bg-layer-1);border-radius:8px}.dcc-field{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}.dcc-field>span{font-size:12px;color:var(--dsw-alias-label-secondary)}.dcc-field input:not([type=checkbox]){flex:1;min-width:160px}.dcc-field input[type=checkbox]{min-height:20px;width:18px;height:18px;accent-color:var(--dsw-alias-brand-primary)}.dcc dl{margin:0}.dcc dl>div{display:grid;grid-template-columns:150px minmax(0,1fr);gap:12px;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.dcc dt{color:var(--dsw-alias-label-secondary);font-size:12px}.dcc dd{margin:0;overflow-wrap:anywhere;font-size:13px}.dcc-empty{padding:30px 0;color:var(--dsw-alias-label-secondary);font-size:13px}.dcc-card{padding:12px 0}.dcc-session-item{display:block;padding:14px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.dcc-session-item>.dcc-row{padding:0;border:0}.dcc-session-title{display:block;text-align:left;width:100%;background:none!important;border:0!important;padding:0!important;min-height:32px!important}.dcc-selected{border-left:2px solid var(--dsw-alias-brand-primary);padding-left:10px}.dcc-confirm{padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}.dcc summary{cursor:pointer;font-size:12px}.dcc-progress{width:100%;height:4px;accent-color:var(--dsw-alias-brand-primary)}
.dcc-command-dock{max-height:min(58vh,640px);overflow:auto;overscroll-behavior:contain;margin-bottom:8px}.dcc-command-dock>.dcc-card{margin:0 0 8px}
.dcc-inv-page{padding:20px 28px 28px}
.dcc-inv{position:relative;display:grid;grid-template-columns:var(--dcc-inv-nav,190px) 6px minmax(0,1fr) 6px var(--dcc-inv-det,300px);gap:0;min-height:0;flex:1;height:min(78vh,860px);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden}
.dcc-inv-split{cursor:col-resize;position:relative;background:transparent;transition:background .15s;z-index:2}
.dcc-inv-split::after{content:"";position:absolute;inset:0 -3px}
.dcc-inv-split:hover,.dcc-inv-split.dcc-dragging{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent)}
.dcc.dcc-inv-page button{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dcc.dcc-inv-page button:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 9%,var(--dsw-alias-bg-layer-2))}
.dcc.dcc-inv-page button[aria-pressed=true]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,var(--dsw-alias-bg-layer-2));border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);font-weight:600}
.dcc.dcc-inv-page .dcc-primary{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);font-weight:600}
.dcc.dcc-inv-page .dcc-primary:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 20%,var(--dsw-alias-bg-layer-2))}
.dcc.dcc-inv-page input,.dcc.dcc-inv-page select{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dcc-inv-nav{border-right:1px solid var(--dsw-alias-border-l1);overflow:auto;padding:10px 8px;background:var(--dsw-alias-bg-layer-1);min-width:0}
.dcc-inv-nav .dcc-inv-sec{font-size:11px;color:var(--dsw-alias-label-secondary);padding:8px 10px 4px}
.dcc-inv-nav button{display:flex;width:100%;justify-content:space-between;align-items:center;gap:6px;text-align:left;border:none;background:none;padding:7px 10px;border-radius:8px;min-height:34px;cursor:pointer;color:inherit;font-size:13px}
.dcc-inv-nav button:hover{background:var(--dsw-alias-bg-layer-2)}
/* Selection is a tint, never a solid brand fill: brand-primary is near-black in
the light theme, and a black slab read as heavy and broken. */
.dcc-inv-nav button[aria-pressed=true]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);color:var(--dsw-alias-brand-primary);font-weight:600;box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}
.dcc-inv-nav .dcc-inv-cnt{font-size:11px;opacity:.75;border:1px solid currentColor;border-radius:10px;padding:0 7px}
.dcc-inv-list{overflow:auto;padding:14px 16px;min-width:0;overflow-wrap:break-word}
.dcc-inv-detail{border-left:1px solid var(--dsw-alias-border-l1);overflow:auto;padding:16px;background:var(--dsw-alias-bg-layer-1);min-width:0}
.dcc-inv-item{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;margin-bottom:8px;cursor:pointer;min-width:0;max-width:100%}
.dcc-inv-item:hover{background:var(--dsw-alias-bg-layer-2)}
.dcc-inv-item.dcc-inv-sel{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}
.dcc-inv-ico{width:32px;height:32px;border-radius:8px;display:grid;place-items:center;font-size:15px;background:var(--dsw-alias-bg-layer-2);flex-shrink:0}
.dcc-inv-tx{min-width:0;flex:1;display:block}
.dcc-inv-nm{display:block;font-weight:600;font-size:13px;overflow-wrap:anywhere;line-height:1.45}
.dcc-inv-ds{display:block;font-size:12px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;line-height:1.45;margin-top:1px}
.dcc-inv-item.dcc-off .dcc-inv-nm{text-decoration:line-through;color:var(--dsw-alias-label-secondary)}
.dcc-inv-item.dcc-off .dcc-inv-ds{display:none}
.dcc-switch{position:relative;display:inline-block;width:36px;height:21px;flex-shrink:0}
.dcc-switch input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer;z-index:2}
.dcc-switch input:disabled{cursor:default}
.dcc-switch i{position:absolute;inset:0;background:var(--dsw-alias-label-secondary);opacity:.5;border-radius:20px;transition:.18s}
.dcc-switch i::after{content:"";position:absolute;width:17px;height:17px;border-radius:50%;background:var(--dsw-alias-bg-base);top:2px;left:2px;transition:.18s;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.dcc-switch input:checked+i{background:var(--dsw-alias-state-success-primary,#34a853);opacity:1}
.dcc-switch input:checked+i::after{left:17px}
.dcc-inv-kv{display:grid;grid-template-columns:104px minmax(0,1fr);gap:10px;align-items:baseline;margin:0;padding:9px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dcc-inv-kv dt{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dcc-inv-kv dd{font-size:12.5px;line-height:1.55;overflow-wrap:anywhere}
/* Actions wrap in a row at their natural width: a column stack stretched every
button into a full-width slab, which read as one giant control. */
.dcc-inv-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:14px}
.dcc-inv-actions>button{flex:0 0 auto;width:auto;padding:7px 14px;font-size:13px}
.dcc-inv-actions>p{flex:1 0 100%;margin:4px 0 0}
.dcc-header-actions{display:flex;align-items:center;gap:8px}
.dcc.dcc-inv-page .dcc-header-actions button{min-height:32px;padding:5px 12px}
.dcc-translate-note{margin:6px 0;padding:6px 10px;border-radius:7px;font-size:12px;
  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent);color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
/* File viewer covers the whole three-column area: a document is not a sidebar
   detail, and the 340px column made it unreadable. */
.dcc-file-full{position:absolute;inset:0;z-index:6;display:flex;flex-direction:column;min-height:0;
  padding:16px 22px 18px;background:var(--dsw-alias-bg-layer-1)}
.dcc-file-full .dcc-file-pre{flex:1;min-height:0;max-height:none;margin-top:10px}
.dcc-file-full header{margin-bottom:4px}
.dcc-file-full h3{font-size:16px}
/* Original beside translation: two independently scrolling columns. */
.dcc-file-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0;flex:1;min-height:0;margin-top:10px;
  border:1px solid var(--dsw-alias-border-l1);border-radius:9px;overflow:hidden}
.dcc-file-pane{display:flex;flex-direction:column;min-width:0;min-height:0}
.dcc-file-pane+.dcc-file-pane{border-left:1px solid var(--dsw-alias-border-l1)}
.dcc-file-pane h5{margin:0;padding:7px 12px;font-size:11px;font-weight:600;letter-spacing:.3px;
  color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1)}
.dcc-file-split .dcc-file-pre{margin:0;border:none;border-radius:0;flex:1;min-height:0;max-height:none;background:transparent}
@media(max-width:900px){.dcc-file-split{grid-template-columns:minmax(0,1fr)}.dcc-file-pane+.dcc-file-pane{border-left:none;border-top:1px solid var(--dsw-alias-border-l1)}}
/* In-pane file viewer: replaces the detail body rather than opening a dialog. */
.dcc-inv-filebar{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
.dcc-file-view header{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.dcc-file-pre{margin:10px 0 0;padding:16px 18px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;
  background:var(--dsw-alias-bg-layer-2);font-size:13px;line-height:1.75;white-space:pre-wrap;
  overflow-wrap:anywhere;max-height:62vh;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
/* Active-filter chips: the answer to "why is the list empty". */
.dcc-inv-filters{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 10px;margin-bottom:10px;
  border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,transparent)}
.dcc-filter-chip{font:inherit;font-size:12px;min-height:26px;padding:2px 9px;border-radius:999px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);
  max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dcc-filter-chip:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
/* What a plugin ships, as clickable counters. */
.dcc-provides{margin:12px 0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px}
.dcc-provides h4{font-size:12px;margin:0 0 8px;color:var(--dsw-alias-label-secondary);font-weight:600}
.dcc-provides-grid{display:flex;flex-wrap:wrap;gap:8px}
.dcc.dcc-inv-page .dcc-provides-item{display:flex;align-items:center;gap:6px;padding:5px 10px;min-height:0;border-radius:7px;font-size:12px}
.dcc-provides-icon{font-size:13px;line-height:1}
.dcc-provides-count{font-weight:700;font-size:13px;color:var(--dsw-alias-label-primary)}
.dcc-provides-label{color:var(--dsw-alias-label-secondary)}
.dcc-inv-filterbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 10px;padding:6px 10px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent);font-size:12px}
.dcc-inv-filterbar button{min-height:26px;padding:2px 10px;font-size:11px}
/* Explains a shadowed (not-in-effect) row in plain language. */
.dcc-shadow-note{border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 7%,transparent);border-radius:8px;padding:10px 12px;margin:10px 0}
.dcc-shadow-note strong{display:block;font-size:13px;margin-bottom:4px;color:var(--dsw-alias-state-error-primary)}
.dcc-shadow-note p{margin:4px 0;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dcc-shadow-note button{margin-top:6px}
/* Update tasks live in the DETAIL pane, not above the grid. */
.dcc-inv-tasks-panel{min-width:0}
.dcc-inv-tasks-panel h3{font-size:14px;margin-bottom:6px}
.dcc-inv-tasks-panel ul{list-style:none;margin:8px 0 0;padding:0;max-height:60vh;overflow:auto;overscroll-behavior:contain;border:1px solid var(--dsw-alias-border-l1);border-radius:8px}
.dcc-inv-tasks-panel li{display:flex;align-items:center;gap:8px;padding:5px 8px;border-top:1px solid var(--dsw-alias-border-l1);font-size:12px;min-width:0}
.dcc-inv-tasks-panel li:first-child{border-top:none}
.dcc-inv-tasks-panel li .dcc-inv-job-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.dcc-inv-tasks-panel li .dcc-tag{margin:0;flex-shrink:0}
.dcc-inv-tasks-panel li .dcc-inv-job-err{flex-basis:38%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-state-error-primary)}
.dcc-inv-tasks-panel li button{min-height:24px;padding:2px 8px;font-size:11px;flex-shrink:0}
@media(max-width:900px){.dcc-inv{grid-template-columns:1fr;height:auto}.dcc-inv-split{display:none}.dcc-inv-nav{display:flex;gap:4px;overflow-x:auto;border-right:none;border-bottom:1px solid var(--dsw-alias-border-l1)}.dcc-inv-nav .dcc-inv-sec{display:none}.dcc-inv-nav button{width:auto}.dcc-inv-detail{border-left:none;border-top:1px solid var(--dsw-alias-border-l1)}}
@media(max-width:600px){.dcc{padding:12px 0}.dcc-row{align-items:flex-start;flex-direction:column;gap:8px}.dcc-actions{width:100%}.dcc dl>div{grid-template-columns:1fr;gap:4px}.dcc-nav button{flex:1}.dcc input,.dcc select{font-size:16px}.dcc-toolbar{align-items:stretch}.dcc-toolbar button{flex-shrink:0}}
`;
    // Item identity is the Host operationKey wire contract; actions on one row
    // share identity, while independent plugin/marketplace targets stay usable.
    function operationKey(request) {
      if (request.action === 'inventory.translate') return JSON.stringify(['translation', request.cwd ?? '', request.id ?? '', request.lang || 'en']);
      if (request.action === 'inventory.toggle') return JSON.stringify(['inventory', request.cwd ?? '', request.id ?? '*']);
      if (['inventory.trash', 'inventory.restore'].includes(request.action)) return JSON.stringify(['trash', request.cwd ?? '', request.id ?? '*']);
      if (request.action.startsWith('plugins.marketplace-')) return JSON.stringify(['marketplace', request.target ?? '*']);
      if (request.action.startsWith('plugins.')) return JSON.stringify(['plugin', request.target ?? '*']);
      if (request.action === 'sessions.resume') return JSON.stringify(['handoff', request.cwd ?? '', request.sessionId ?? '', request.targetSessionId ?? 'new']);
      if (request.action === 'sessions.import') return JSON.stringify(['session', request.cwd ?? '', request.sessionId ?? '']);
      return JSON.stringify([request.action]);
    }
    const pendingJob = (job) => ['queued', 'running', 'submitting'].includes(job.state);
    function sameItem(left, right) {
      if (left === right) return true;
      const a = JSON.parse(left), b = JSON.parse(right);
      if (a[0] !== b[0]) return false;
      if (['inventory', 'trash'].includes(a[0])) return a[1] === b[1] && (a[2] === '*' || b[2] === '*');
      return ['marketplace', 'plugin'].includes(a[0]) && (a[1] === '*' || b[1] === '*');
    }
    return {
      inject: ['slots', 'connection', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register('claudeCompat', dictionaries));
        const t = ctx.locale.bind('claudeCompat');
        async function api(request, signal) {
          const result = await ctx.connection.rpc.call('/api', 'claude-compat', request, signal);
          if (!result.ok) throw new Error(result.error.message);
          if (result.value?.ok === false) throw new Error(result.value.error || result.value.text || t('failed'));
          return result.value;
        }
        // A button with no text is a mystery box in the UI, so refuse to render
        // one: this catches a missing locale key instead of showing an empty slab.
        function Button({ children, ...props }) {
          const hasContent = Array.isArray(children)
            ? children.some((child) => child !== undefined && child !== null && String(child).trim() !== '')
            : children !== undefined && children !== null && String(children).trim() !== '';
          if (!hasContent) {
            if (typeof globalThis.console !== 'undefined') {
              globalThis.console.warn('dsh-claude-compat: a button had no label (missing locale key?)', props['aria-label'] ?? '');
            }
            return null;
          }
          return h('button', { type: 'button', ...props }, children);
        }
        function Notice({ error, children }) {
          return children ? h('div', { className: `dcc-notice${error ? ' dcc-error' : ''}`, role: error ? 'alert' : 'status' }, children) : null;
        }
        function useLoad(request, revision) {
          const [state, setState] = useState({ key: '', loading: true, data: null, error: '' });
          const key = JSON.stringify(request);
          useEffect(() => {
            const controller = new AbortController();
            setState((old) => ({ key, loading: true, data: old.key === key ? old.data : null, error: '' }));
            api(JSON.parse(key), controller.signal).then(
              (data) => { if (!controller.signal.aborted) setState({ key, loading: false, data, error: '' }); },
              (error) => { if (!controller.signal.aborted) setState({ key, loading: false, data: null, error: error.message }); });
            return () => controller.abort();
          }, [key, revision]);
          return state.key === key ? state : { loading: true, data: null, error: '' };
        }
        function useOperation(onComplete, revision) {
          const [jobs, setJobs] = useState([]);
          const [starting, setStarting] = useState([]);
          const [error, setError] = useState('');
          const [pollError, setPollError] = useState('');
          const jobsRef = useRef([]), pending = useRef(new Map());
          const watched = useRef(new Set()), notified = useRef(new Set()), baselined = useRef(false);
          const latestRevision = useRef(-1), generation = useRef(null), retired = useRef(new Set());
          const latestImport = useRef(null), requests = useRef(new Set());
          const completeRef = useRef(onComplete), mounted = useRef(true);
          completeRef.current = onComplete;
          useEffect(() => {
            mounted.current = true;
            return () => { mounted.current = false; for (const controller of requests.current) controller.abort(); };
          }, []);
          function observeGeneration(next) {
            if (retired.current.has(next)) return false;
            if (generation.current && generation.current !== next) {
              retired.current.add(generation.current);
              latestRevision.current = -1;
              watched.current.clear(); notified.current.clear(); pending.current.clear(); baselined.current = false;
              latestImport.current = null; setStarting([]); setError(t('reset'));
            }
            generation.current = next;
            return true;
          }
          function commit(items) {
            jobsRef.current = items;
            setJobs(items);
            for (const job of items) {
              if (pendingJob(job)) watched.current.add(job.id);
              if (job.state !== 'done' || notified.current.has(job.id)) continue;
              notified.current.add(job.id);
              while (notified.current.size > 200) {
                const oldest = notified.current.values().next().value;
                notified.current.delete(oldest); watched.current.delete(oldest);
              }
              Promise.resolve().then(() => {
                if (mounted.current) return completeRef.current(job.result, job);
              }).catch((failure) => { if (mounted.current) setError(failure.message); });
            }
            const retained = new Set([...items.map((job) => job.id), ...[...pending.current.values()].map((job) => job.id)]);
            for (const id of watched.current) if (!retained.has(id)) watched.current.delete(id);
            for (const id of notified.current) if (!retained.has(id)) notified.current.delete(id);
          }
          function mergeJob(next) {
            if (!observeGeneration(next.generation)) return;
            latestRevision.current = Math.max(latestRevision.current, next.revision);
            const current = jobsRef.current.find((job) => job.id === next.id);
            if (current && current.revision > next.revision) { commit(jobsRef.current); return; }
            commit([...jobsRef.current.filter((job) => job.id !== next.id), next]
              .sort((a, b) => a.createdAt - b.createdAt || a.revision - b.revision || a.id.localeCompare(b.id)));
          }
          useEffect(() => {
            const controller = new AbortController();
            let timer;
            async function poll() {
              let delay = 2000;
              try {
                const snapshot = await api({ action: 'operation.list' }, controller.signal);
                if (controller.signal.aborted) return;
                if (observeGeneration(snapshot.generation) && snapshot.revision >= latestRevision.current) {
                  latestRevision.current = snapshot.revision;
                  if (!baselined.current) {
                    // One refresh reconciles historical completions with the initial
                    // inventory. Later unseen completions also refresh other open views.
                    let reconciled = false;
                    for (const job of snapshot.items) {
                      if (job.state !== 'done' || watched.current.has(job.id)) continue;
                      if (reconciled) notified.current.add(job.id);
                      reconciled = true;
                    }
                    baselined.current = true;
                  }
                  commit(snapshot.items);
                }
                setPollError('');
                delay = jobsRef.current.some(pendingJob) || pending.current.size ? 700 : 5000;
              } catch (failure) { if (!controller.signal.aborted) setPollError(failure.message); }
              finally { if (!controller.signal.aborted) timer = setTimeout(poll, delay); }
            }
            void poll();
            return () => { clearTimeout(timer); controller.abort(); };
          }, [revision]);
          function busyFor(request) {
            const key = operationKey(request);
            return [...pending.current.keys()].some((entry) => sameItem(entry, key))
              || jobsRef.current.some((job) => pendingJob(job) && sameItem(job.key, key));
          }
          function forItem(request) {
            const key = operationKey(request);
            const matching = jobsRef.current.filter((job) => sameItem(job.key, key));
            return matching.find(pendingJob) || [...pending.current.values()].find((job) => sameItem(job.key, key)) || matching.at(-1);
          }
          async function run(request) {
            if (!mounted.current || busyFor(request)) return;
            const key = operationKey(request);
            const controller = new AbortController();
            requests.current.add(controller);
            let id;
            try {
              id = globalThis.crypto.randomUUID();
              const local = { ...request, id, key, createdAt: Date.now(), state: 'submitting' };
              pending.current.set(key, local); setStarting([...pending.current.values()]);
              watched.current.add(id);
              if (request.action === 'sessions.resume') latestImport.current = id;
              setError('');
              const next = await api({ action: 'operation.start', request, id }, controller.signal);
              if (!mounted.current || !observeGeneration(next.generation)) return;
              watched.current.add(next.id);
              if (latestImport.current === id) latestImport.current = next.id;
              mergeJob(next);
              return next;
            } catch (failure) { if (mounted.current && !controller.signal.aborted) setError(failure.message); }
            finally {
              requests.current.delete(controller);
              if (id && pending.current.get(key)?.id === id) pending.current.delete(key);
              if (mounted.current) setStarting([...pending.current.values()]);
            }
          }
          async function cancel(id) {
            const controller = new AbortController();
            requests.current.add(controller);
            try {
              const next = await api({ action: 'operation.cancel', id }, controller.signal);
              if (mounted.current) mergeJob(next);
            } catch (failure) { if (mounted.current && !controller.signal.aborted) setError(failure.message); }
            finally { requests.current.delete(controller); }
          }
          return { jobs: [...jobs, ...starting.filter((local) => !jobs.some((job) => job.id === local.id))],
            error: error || pollError, run, cancel, busyFor, forItem, reportError: setError, isMounted: () => mounted.current,
            shouldOpen: (id) => latestImport.current === id, stopAutoOpen: () => { latestImport.current = null; } };
        }
        function ItemProgress({ job, operation }) {
          if (!job) return null;
          return h(React.Fragment, null,
            h('div', { className: 'dcc-actions' },
              h('span', { className: `dcc-tag${job.state === 'failed' ? ' dcc-error' : ''}`, role: 'status' }, t(job.action === 'sessions.resume' && job.result?.accepted ? 'handoffAccepted' : job.state)),
              ['queued', 'running'].includes(job.state) && h(Button, {
                onClick: () => operation.cancel(job.id), 'aria-label': `${t('cancel')} ${job.target || job.action}`,
              }, t('cancel'))),
            job.state === 'failed' && h('p', { className: 'dcc-error', role: 'alert' }, job.result?.error));
        }
        function OperationNotice({ operation, open }) {
          const { jobs, error } = operation;
          const active = jobs.filter(pendingJob).length;
          return h(React.Fragment, null,
            h(Notice, { error: true }, error),
            jobs.length > 0 && h('details', { className: 'dcc-notice', open: open || undefined },
              h('summary', null, `${t('tasks')} (${active} ${t('active')} / ${jobs.length})`),
              [...jobs].reverse().map((job) => h('div', { className: 'dcc-notice', key: job.id, 'aria-busy': pendingJob(job) },
                h('strong', null, job.target || job.action),
                h(ItemProgress, { job, operation }),
                job.state === 'running' && h('progress', { className: 'dcc-progress', 'aria-label': `${t('running')} ${job.target || job.action}` }),
                job.result?.catalogRefreshed && h('p', { className: 'dcc-subtle' }, t('skillsReloaded')),
                job.result?.restartRequired && h('p', { className: 'dcc-subtle' }, t('restart')),
                job.result?.warnings?.length > 0 && h('p', { className: 'dcc-subtle' }, job.result.warnings.join('\n')),
                (job.progress || job.result?.text) && h('details', null, h('summary', null, t('result')),
                  job.detailsTruncated && h('p', { className: 'dcc-subtle' }, t('truncated')),
                  h('pre', null, job.result?.text || job.progress))))));
        }
        function LoadState({ state, retry, empty }) {
          if (state.error) return h(Notice, { error: true }, state.error, ' ', h(Button, { onClick: retry }, t('retry')));
          if (state.loading) return h('p', { role: 'status', className: 'dcc-subtle' }, t('loading'));
          return empty ? h('p', { className: 'dcc-empty' }, empty) : null;
        }
        function Pagination({ state, offset, pageSize, changePage, changeSize }) {
          const total = state.data?.total ?? 0;
          return h('nav', { className: 'dcc-toolbar', 'aria-label': t('pagination') },
            h('label', { className: 'dcc-field' }, h('span', null, t('pageSize')),
              h('select', { value: pageSize, 'aria-label': t('pageSize'), onChange: (event) => changeSize(Number(event.target.value)) },
                [10, 20, 50, 100].map((size) => h('option', { key: size, value: size }, size)))),
            h(Button, { disabled: offset === 0 || state.loading, onClick: () => changePage(Math.max(0, offset - pageSize)) }, t('previous')),
            h(Button, { disabled: !state.data?.hasMore || state.loading, onClick: () => changePage(offset + pageSize) }, t('next')),
            h('span', { className: 'dcc-subtle' }, `${total ? offset + 1 : 0}–${Math.min(offset + pageSize, total)} / ${total}`));
        }
        function Plugins({ mode, cwd, revision, refresh, operation, pageSize, setPageSize }) {
          const [query, setQuery] = useState('');
          const [search, setSearch] = useState('');
          const [target, setTarget] = useState('');
          const [offset, setOffset] = useState(0);
          const [confirm, setConfirm] = useState(null);
          const isMarket = mode === 'markets';
          const action = isMarket ? 'plugins.marketplace-list' : mode === 'search' ? 'plugins.search' : 'plugins.list';
          const state = useLoad({ action, cwd, query: search, offset, limit: pageSize }, revision);
          const items = (state.data?.items ?? []).filter((item) => mode !== 'plugins'
            || `${item.name} ${item.marketplace} ${item.description ?? ''}`.toLowerCase().includes(query.toLowerCase()));
          function run(actionName, value) { return operation.run({ action: `plugins.${actionName}`, target: value, cwd }); }
          return h('section', null,
            h('form', { className: 'dcc-toolbar', onSubmit: (e) => { e.preventDefault(); setSearch(query); setOffset(0); refresh(); } },
              h('input', { type: 'search', value: query, onChange: (e) => setQuery(e.target.value), 'aria-label': t('query'), placeholder: t('query') }),
              h('button', { type: 'submit', disabled: state.loading }, t(mode === 'plugins' ? 'refresh' : 'find'))),
            h('h3', null, t(isMarket ? 'add' : 'install')),
            h('p', { className: 'dcc-subtle' }, t(isMarket ? 'marketHint' : 'pluginHint')),
            h('form', { className: 'dcc-toolbar', onSubmit: (e) => { e.preventDefault(); run(isMarket ? 'marketplace-add' : 'install', target.trim()); } },
              h('input', { value: target, onChange: (e) => setTarget(e.target.value), required: true,
                'aria-label': t(isMarket ? 'marketTarget' : 'target'), placeholder: t(isMarket ? 'marketTarget' : 'target') }),
              h('button', { type: 'submit', disabled: !target.trim() || operation.busyFor({ action: isMarket ? 'plugins.marketplace-add' : 'plugins.install', target: target.trim(), cwd }) }, t(isMarket ? 'add' : 'install'))),
            target.trim() && h(ItemProgress, { job: operation.forItem({ action: isMarket ? 'plugins.marketplace-add' : 'plugins.install', target: target.trim(), cwd }), operation }),
            h('p', { className: 'dcc-subtle' }, t('userScope'), ' · ', t('noCli')),
            confirm && h('div', { className: 'dcc-confirm', role: 'group', 'aria-label': t('confirmRemove') },
              h('p', null, t('confirmRemove'), ' ', confirm.target),
              h('div', { className: 'dcc-actions' },
                h(Button, { className: 'dcc-danger', disabled: operation.busyFor({ action: `plugins.${confirm.action}`, target: confirm.target, cwd }), onClick: () => { run(confirm.action, confirm.target); setConfirm(null); } }, t('confirm')),
                h(Button, { onClick: () => setConfirm(null) }, t('cancel')))),
            h(LoadState, { state, retry: refresh, empty: items.length === 0 ? t('empty') : '' }),
            h('ul', { className: 'dcc-list', 'aria-busy': state.loading }, items.map((item) => {
              const ref = item.operationTarget || item.installId || item.key || (item.marketplace ? `${item.name}@${item.marketplace}` : item.name);
              const capability = (actionName) => !item.capabilities || item.capabilities[actionName] === true;
              const source = typeof item.source === 'string' ? item.source : item.source?.repo || item.source?.url || '';
              const rowRequest = { action: isMarket ? 'plugins.marketplace-update' : 'plugins.update', target: ref, cwd };
              const busy = operation.busyFor(rowRequest);
              const job = operation.forItem(rowRequest);
              return h('li', { className: 'dcc-row', key: ref },
                h('div', { className: 'dcc-main' },
                  h('div', { className: 'dcc-title' }, item.name),
                  h('div', { className: 'dcc-subtle' }, item.description || source || item.marketplace || ''),
                  item.version && h('span', { className: 'dcc-tag' }, item.version),
                  mode === 'plugins' && h('span', { className: 'dcc-tag' }, t(item.enabled ? 'enabled' : 'disabled')),
                  item.scope && h('span', { className: 'dcc-tag' }, item.scope),
                  h(ItemProgress, { job, operation })),
                h('div', { className: 'dcc-actions' }, mode === 'search'
                  ? h(Button, { disabled: busy, onClick: () => run('install', ref) }, t('install'))
                  : h(React.Fragment, null,
                    !isMarket && h(Button, { disabled: busy || !capability(item.enabled ? 'disable' : 'enable'), onClick: () => run(item.enabled ? 'disable' : 'enable', ref) }, t(item.enabled ? 'disable' : 'enable')),
                    h(Button, { disabled: busy || !capability('update'), onClick: () => run(isMarket ? 'marketplace-update' : 'update', ref) }, t('update')),
                    h(Button, { disabled: busy || !capability('uninstall'), className: 'dcc-danger', onClick: () => setConfirm({ action: isMarket ? 'marketplace-remove' : 'uninstall', target: ref }) }, t('remove')))));
            })),
            h(Pagination, { state, offset, pageSize, changePage: (next) => { setOffset(next); setConfirm(null); },
              changeSize: (size) => { setPageSize(size); setOffset(0); setConfirm(null); } }));
        }
        function SessionPreview({ cwd, selected, revision, operation, requestFor, resume, canResume }) {
          const [range, setRange] = useState('0');
          const request = requestFor(cwd, selected.id, range === '0' ? undefined : Number(range));
          const [retry, setRetry] = useState(0);
          const state = useLoad({ action: 'sessions.preview', cwd, sessionId: selected.id, limit: 12 }, `${revision}:${retry}`);
          const data = state.data;
          const preview = data?.text ?? (data?.messages ?? []).map((m) => `${m.role}: ${m.text ?? m.content ?? ''}`).join('\n\n');
          return h('section', { className: 'dcc-notice' },
            h('h3', null, selected.title),
            h(LoadState, { state, retry: () => setRetry((value) => value + 1), empty: !preview ? t('noPreview') : '' }),
            data?.warnings?.length > 0 && h('p', { className: 'dcc-subtle' }, data.warnings.join('\n')),
            data?.truncated && h('p', { className: 'dcc-subtle' }, t('previewTruncated')),
            preview && h('pre', null, preview),
            h('label', { className: 'dcc-field' }, h('span', null, t('range')),
              h('select', { value: range, onChange: (e) => setRange(e.target.value) },
                h('option', { value: '0' }, t('all')), h('option', { value: '200' }, t('recent200')), h('option', { value: '50' }, t('recent50')))),
            h('div', { className: 'dcc-actions' },
              h(Button, { className: 'dcc-primary', disabled: !canResume || operation.busyFor(request), onClick: () => resume(request) }, t('resumeContext'))),
            h('p', { className: 'dcc-subtle' }, t('archiveNote')));
        }
        function Sessions({ cwd, setCwd, revision, refresh, operation, requestFor, resume, canResume, resumeMode, pageSize, setPageSize }) {
          const [draft, setDraft] = useState(cwd);
          const [query, setQuery] = useState('');
          const [search, setSearch] = useState('');
          const [offset, setOffset] = useState(0);
          const [selected, setSelected] = useState(null);
          const previewId = React.useId();
          const projects = useLoad({ action: 'sessions.projects' }, revision);
          const state = useLoad({ action: 'sessions.list', cwd, query: search, offset, limit: pageSize }, revision);
          const items = state.data?.items ?? [];
          async function chooseDirectory() {
            try { const dir = await ctx.get('uiWorkspace')?.pickDirectory(); if (dir) { setCwd(dir); setOffset(0); setSelected(null); } }
            catch (error) { operation.reportError(error.message); }
          }
          return h('section', null,
            !canResume && h(Notice, { error: true }, t('noCurrentSession')),
            h('form', { className: 'dcc-field', onSubmit: (e) => { e.preventDefault(); setCwd(draft.trim()); setOffset(0); setSelected(null); } },
              h('span', null, t('project')),
              h('input', { value: draft, 'aria-label': t('project'), onChange: (e) => setDraft(e.target.value) }),
              h('button', { type: 'submit', disabled: !draft.trim() }, t('confirm')),
              h(Button, { onClick: chooseDirectory }, t('choose'))),
            projects.data?.items?.length > 0 && h('label', { className: 'dcc-field' }, h('span', null, t('projectHistory')),
              h('select', { value: '', onChange: (e) => { if (e.target.value) { setCwd(e.target.value); setOffset(0); setSelected(null); } } },
                h('option', { value: '' }, t('projectHistory')), ...projects.data.items.filter((p) => p.cwd).map((p) => h('option', { key: p.cwd, value: p.cwd }, p.title || p.cwd)))),
            h('form', { className: 'dcc-toolbar', onSubmit: (e) => { e.preventDefault(); setSearch(query); setOffset(0); refresh(); } },
              h('input', { type: 'search', value: query, onChange: (e) => setQuery(e.target.value), 'aria-label': t('sessionSearch'), placeholder: t('sessionSearch') }),
              h('button', { type: 'submit' }, t('find'))),
            h(LoadState, { state, retry: refresh, empty: items.length === 0 ? t('noSessions') : '' }),
            h('ul', { className: 'dcc-list', 'aria-busy': state.loading }, items.map((item) => {
              const opened = selected?.id === item.id;
              const request = requestFor(cwd, item.id);
              const toggle = () => setSelected(opened ? null : item);
              const controls = `${previewId}-${item.id}`;
              return h('li', { className: `dcc-session-item${opened ? ' dcc-selected' : ''}`, key: item.id },
                h('div', { className: 'dcc-row' },
                  h('div', { className: 'dcc-main' },
                    h('button', { type: 'button', className: 'dcc-session-title', onClick: toggle, 'aria-expanded': opened, 'aria-controls': controls },
                      h('span', { className: 'dcc-title' }, item.title || item.id)),
                    h('div', { className: 'dcc-subtle' }, `${new Date(item.updatedAt || item.createdAt || Date.now()).toLocaleString()} · ${item.messagesExact === false ? '≥' : ''}${item.messages ?? 0} msg · ${item.id.slice(0, 8)}`),
                    h('span', { className: 'dcc-tag' }, t(resumeMode === 'current' ? 'resumeCurrent' : 'resumeNew'))),
                  h('div', { className: 'dcc-actions' },
                    h(Button, { onClick: toggle, 'aria-expanded': opened, 'aria-controls': controls }, t(opened ? 'collapsePreview' : 'preview')),
                    h(Button, { className: 'dcc-primary', disabled: !canResume || operation.busyFor(request),
                      onClick: () => resume(request),
                    }, t('quickResume')))),
                h(ItemProgress, { job: operation.forItem(request), operation }),
                opened && h('div', { id: controls }, h(SessionPreview, {
                  key: `${cwd}:${item.id}`, cwd, selected: item, revision, operation, requestFor, resume, canResume,
                })));
            })),
            h(Pagination, { state, offset, pageSize, changePage: (next) => { setOffset(next); setSelected(null); },
              changeSize: (size) => { setPageSize(size); setOffset(0); setSelected(null); } }));
        }
        const INV_KINDS = [
          ['plugin', 'invPlugins', '🧩'], ['skill', 'invSkills', '⚡'], ['command', 'invCommands', '⌨️'],
          ['agent', 'invAgents', '🤖'], ['rule', 'rules', '📜'], ['hook', 'hooks', '🪝'], ['mcp', 'mcp', '🔌'],
        ];
        const INV_SOURCE_LABEL = {
          'project-claude': 'srcProject', 'user-claude': 'srcUser', 'claude-plugin': 'srcPlugin', mcp: 'srcMcp',
        };
        function Switch({ checked, disabled, onChange, label }) {
          return h('label', { className: 'dcc-switch', onClick: (event) => event.stopPropagation(),
            onKeyDown: (event) => event.stopPropagation() },
            h('input', { type: 'checkbox', checked, disabled, onChange, 'aria-label': label }),
            h('i', { 'aria-hidden': 'true' }));
        }
        function rankText(rank) {
          if (rank === undefined) return undefined;
          if (rank <= 50) return t('prioProject');
          if (rank <= 600) return t('prioBundled');
          if (rank <= 700) return t('prioUser');
          return t('prioPlugin');
        }
        function formatBytes(bytes) {
          if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '';
          if (bytes < 1024) return `${bytes} B`;
          if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
          return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
        }
        // Clipboard needs a real fallback: `navigator.clipboard` can be missing or
        // denied in this shell, and a silently swallowed rejection is exactly why
        // "copy path" appeared to do nothing.
        async function copyText(text) {
          try {
            if (globalThis.navigator?.clipboard?.writeText) {
              await globalThis.navigator.clipboard.writeText(text);
              return true;
            }
          } catch { /* fall through to the legacy path */ }
          try {
            const area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.top = '-1000px';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(area);
            return ok === true;
          } catch { return false; }
        }
        // The main panel unmounts whenever the user visits another sidebar page,
        // so component state alone reset the whole view. Persist it: re-entering
        // the bridge page returns to the tab, filter and row last looked at.
        const VIEW_KEY = 'dcc-inv-view';
        function readStorage(key) {
          try { return localStorage.getItem(key); } catch { return null; }
        }
        function loadView() {
          try {
            const parsed = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
            return parsed !== null && typeof parsed === 'object' ? parsed : {};
          } catch { return {}; }
        }
        function saveView(view) {
          try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* storage may be full or blocked */ }
        }
        function InvTasks({ operation, batchNote, dismissed, onDismiss }) {
          // Pending and failed inventory tasks remain visible while details are selected;
          // completed tasks remain available in the selected item's progress.
          const { jobs } = operation;
          const relevant = jobs.filter((job) => (job.action.startsWith('plugins.') || job.action.startsWith('inventory.'))
            && job.action !== 'inventory.translate'
            && (pendingJob(job) || (job.state === 'failed' && !dismissed.has(job.id))));
          if (relevant.length === 0 && !batchNote) return null;
          const anyFailed = relevant.some((job) => job.state === 'failed');
          return h('section', { className: 'dcc-inv-tasks-panel' },
            h('h3', null, t('tasks'), anyFailed && ' ',
              anyFailed && h(Button, { onClick: () => onDismiss(relevant.filter((job) => job.state === 'failed').map((job) => job.id)) }, t('clear'))),
            batchNote && h('p', { className: 'dcc-subtle' }, batchNote),
            h('ul', null, relevant.map((job) => h('li', { key: job.id },
              h('span', { className: 'dcc-inv-job-name', title: job.result?.error || job.progress || '' },
                job.target || job.itemId || job.action),
              h('span', { className: `dcc-tag${job.state === 'failed' ? ' dcc-error' : ''}` }, t(job.state)),
              ['queued', 'running'].includes(job.state)
                && h(Button, { onClick: () => operation.cancel(job.id), 'aria-label': `${t('cancel')} ${job.target || job.id}` }, t('cancel')),
              job.state === 'failed' && job.result?.error
                && h('span', { className: 'dcc-inv-job-err', role: 'alert', title: job.result.error }, job.result.error)))));
        }
        // Explains a hidden duplicate in terms of what actually differs: which
        // KIND of copy won, and whether it is even a different plugin. The old
        // copy only named the plugin, so a skill shadowed by the same plugin's
        // command read as "inactive, and the active one is ... itself".
        function ShadowNotice({ item, onJump }) {
          if (!item.overriddenBy) return null;
          const winnerKind = item.overriddenByKind || '';
          const samePlugin = item.overriddenBySamePlugin === true;
          const owner = item.overriddenByName || item.pluginName || '';
          const file = item.overriddenByFile || '';
          return h('div', { className: 'dcc-shadow-note', role: 'note' },
            h('strong', null, t('shadowTitle')),
            h('p', null, samePlugin
              ? `${t('shadowSamePluginA')}${owner}${t('shadowSamePluginB')}${winnerKind}${file ? `（${file}）` : ''}${t('shadowSamePluginC')}${item.kind}${t('shadowSamePluginD')}`
              : `${t('shadowOtherPluginA')}${owner}${t('shadowOtherPluginB')}${winnerKind}${t('shadowOtherPluginC')}`),
            h('p', null, t('shadowDecision')),
            onJump && h(Button, { onClick: () => onJump(item) }, t('shadowJump')));
        }
        // The viewer is a full-area layer, so its state lives in Inventory and it
        // renders as a grid sibling — inside the scrolling detail column it would
        // be clipped to that 340px column.
        function useTranslationTask({ itemId, cwd, lang, enabled }) {
          const [task, setTask] = useState({ checking: true, job: null, error: '', now: Date.now() });
          const starting = useRef(false);
          const requestEpoch = useRef(0);
          const current = useRef('');
          const identity = JSON.stringify([enabled, cwd, itemId, lang]);
          current.current = identity;
          useEffect(() => {
            if (!enabled || !itemId) return undefined;
            let stopped = false;
            let timer;
            let cachedJob = null;
            setTask({ identity, checking: true, job: null, error: '', now: Date.now() });
            async function poll() {
              if (typeof document !== 'undefined' && document.hidden) {
                if (!stopped) timer = setTimeout(poll, 5000);
                return;
              }
              const epoch = requestEpoch.current;
              try {
                const list = await api({ action: 'operation.list' });
                const matching = (list?.items ?? []).filter((job) => job.action === 'inventory.translate'
                  && job.itemId === itemId && (job.cwd ?? '') === cwd && job.lang === lang);
                const job = matching.find(pendingJob) ?? matching.sort((a, b) => b.createdAt - a.createdAt)[0]
                  ?? (cachedJob && !pendingJob(cachedJob) ? cachedJob : null);
                // Fetch the full result only for this viewer, rather than relying
                // on the operation list's potentially abbreviated representation.
                const unchanged = job && cachedJob && !pendingJob(job) && job.id === cachedJob.id
                  && job.revision === cachedJob.revision && job.state === cachedJob.state;
                const full = job ? (unchanged ? cachedJob : await api({ action: 'operation.status', id: job.id })) : null;
                cachedJob = full;
                if (!stopped && !starting.current && epoch === requestEpoch.current) {
                  setTask({ identity, checking: false, job: full, error: '', now: Date.now() });
                }
              } catch (error) {
                if (!stopped && epoch === requestEpoch.current) setTask((old) => ({ ...old, checking: true, error: error.message, now: Date.now() }));
              } finally {
                if (!stopped) timer = setTimeout(poll, cachedJob && !pendingJob(cachedJob) ? 5000 : 1000);
              }
            }
            poll();
            return () => { stopped = true; clearTimeout(timer); };
          }, [enabled, itemId, cwd, lang]);
          async function start(force = false) {
            if (starting.current || task.checking || (task.job && pendingJob(task.job))) return;
            starting.current = true;
            requestEpoch.current += 1;
            const token = identity;
            setTask((old) => ({ ...old, checking: true, error: '' }));
            try {
              const job = await api({ action: 'operation.start', request: {
                action: 'inventory.translate', id: itemId, cwd, lang, ...(force ? { force: true } : {}),
              } });
              if (current.current === token) setTask({ identity: token, checking: false, job, error: '', now: Date.now() });
            } catch (error) {
              if (current.current === token) setTask((old) => ({ ...old, checking: false, error: error.message }));
            } finally { starting.current = false; }
          }
          return { ...(task.identity === identity ? task : { checking: true, job: null, error: '', now: Date.now() }), start };
        }
        function FileViewer({ view, onClose, onReload, onTranslate, targetLanguage }) {
          const closeRef = useRef(null);
          useEffect(() => {
            const previous = typeof document !== 'undefined' ? document.activeElement : null;
            closeRef.current?.focus();
            return () => { if (previous?.isConnected) previous.focus(); };
          }, []);
          const translated = view.translation !== undefined;
          return h('section', { className: 'dcc-file-view dcc-file-full', 'aria-label': view.name },
            h('header', null,
              h('h3', null, view.name),
              h('div', { className: 'dcc-header-actions' },
                view.data && !translated && h(Button, {
                  onClick: () => onTranslate({}), disabled: view.translating,
                  title: `${t('translateTo')} ${targetLanguage()}`,
                }, `🌐 ${t('translate')}`),
                // A bad or stale result needs a way to retry without clearing
                // anything: force re-runs the backend and rewrites the cache.
                view.data && translated && h(Button, {
                  onClick: () => onTranslate({ force: true }), disabled: view.translating,
                }, `⟳ ${t('retranslate')}`),
                view.data && translated && h(Button, {
                  onClick: () => onTranslate({ revert: true }), disabled: view.translating,
                }, `↩ ${t('showOriginal')}`),
                h(Button, { onClick: onReload, disabled: view.loading || view.translating }, t('reload')),
                h('button', { type: 'button', ref: closeRef, onClick: onClose }, t('backToDetail')))),
            h('p', { className: 'dcc-subtle' }, view.path,
              view.data && ` · ${formatBytes(view.data.bytes)} · ${new Date(view.data.mtime).toLocaleString()}`),
            // Translation is a view, never a write: say so where the button is.
            translated && h('p', { className: 'dcc-translate-note' }, t('translateNote'),
              ' · ', `${t('translateTo')} ${targetLanguage()}`,
              view.cached === true ? ` · ${t('fromCache')}` : '',
              view.backend === 'model' ? ` · ${t('byModel')}` : ''),
            view.error && h(Notice, { error: true }, view.error),
            view.translateError && h(Notice, { error: true }, view.translateError),
            view.translating && h('div', { className: 'dcc-translate-note', role: 'status', 'aria-live': 'polite' },
              h('span', null, view.checkingTranslation ? t('checkingTranslation') : t('translating'),
                view.translationProgress?.total > 0
                  ? ` ${view.translationProgress.completed}/${view.translationProgress.total} ${t('translationChunks')}` : '',
                view.elapsedSeconds > 0 ? ` · ${view.elapsedSeconds}s` : '',
                view.backend === 'model' ? ` · ${t('byModel')}` : ''),
              view.translationProgress?.total > 0 && h('progress', {
                max: view.translationProgress.total, value: view.translationProgress.completed,
                'aria-label': t('translationProgress'), style: { display: 'block', width: '100%', marginTop: 6 },
              }),
              h('div', null, t('translationContinues'))),
            view.loading && h('p', { className: 'dcc-subtle', role: 'status' }, t('loading')),
            // Translated text sits BESIDE the original, not instead of it:
            // comparing a machine translation against its source is the only way
            // to trust it, and switching back and forth lost the place.
            translated
              ? h('div', { className: 'dcc-file-split' },
                  h('div', { className: 'dcc-file-pane' },
                    h('h5', null, t('originalPane')),
                    h('pre', { className: 'dcc-file-pre' }, view.data?.content)),
                  h('div', { className: 'dcc-file-pane' },
                    h('h5', null, `${t('translatedPane')} · ${targetLanguage()}`),
                    h('pre', { className: 'dcc-file-pre' }, view.translation)))
              : view.data && h('pre', { className: 'dcc-file-pre' }, view.data.content),
            view.data?.truncated && h('p', { className: 'dcc-subtle' }, t('truncated')));
        }
        function InvDetail({ item, operation, cwd, onConfirm, onShadowJump, onDrill, onOpenFile }) {
          // Copy feedback: without a visible result the button reads as broken.
          const [copyState, setCopyState] = useState('');
          useEffect(() => { setCopyState(''); }, [item?.id]);
          if (!item) return h('p', { className: 'dcc-subtle' }, t('notSelected'));
          const copyPathNow = () => {
            Promise.resolve(copyText(item.path)).then((ok) => {
              setCopyState(ok ? 'done' : 'failed');
              setTimeout(() => setCopyState(''), ok ? 1600 : 4000);
            });
          };
          const rows = [
            [t('srcLabel'), INV_SOURCE_LABEL[item.source] ? t(INV_SOURCE_LABEL[item.source]) : item.source],
            item.pluginName && [t('ownedBy'), item.pluginName],
            item.rank !== undefined && [t('rankLabel'), `${rankText(item.rank)}（rank ${item.rank}）`],
            item.path && [t(item.kind === 'plugin' ? 'installPath' : 'filePath'), item.path],
            item.plugin?.marketplace && [t('marketplace'), item.plugin.marketplace],
            item.plugin?.version && [t('pluginVersion'), item.plugin.version],
            item.kind === 'plugin' && [t('lastUpdated'),
              item.plugin?.lastUpdated && Number.isFinite(Date.parse(item.plugin.lastUpdated))
                ? new Date(item.plugin.lastUpdated).toLocaleString() : t('updateTimeUnknown')],
            item.whenToUse && ['whenToUse', item.whenToUse],
          ].filter(Boolean);
          const kindLabel = t((INV_KINDS.find(([value]) => value === item.kind) ?? [null, 'invTitle'])[1]);
          const ownedByPlugin = Boolean(item.pluginKey);
          const PROVIDE_ROWS = [['skill', t('invSkills'), '⚡'], ['command', t('invCommands'), '⌨️'],
            ['agent', t('invAgents'), '🤖'], ['mcp', t('mcp'), '🔌'], ['hook', t('hooks'), '🪝'], ['rule', t('rules'), '📜']];
          const provides = item.provides ?? null;
          const fileBacked = ['skill', 'command', 'agent'].includes(item.kind);
          return h('section', null,
            h('h3', null, item.name, ' ', h('span', { className: 'dcc-tag' }, kindLabel)),
            item.description && h('p', { className: 'dcc-subtle' }, item.description),
            operation && h(ItemProgress, { operation, job: operation.forItem(item.kind === 'plugin'
              ? { action: 'plugins.update', target: item.plugin?.key, cwd }
              : { action: 'inventory.toggle', id: item.id, cwd }) }),
            h(ShadowNotice, {
              item,
              onJump: onShadowJump,
            }),
            provides && h('div', { className: 'dcc-provides' },
              h('h4', null, t('provides')),
              (() => {
                const listed = PROVIDE_ROWS.filter(([key]) => (provides[key] ?? 0) > 0);
                if (listed.length === 0) return h('p', { className: 'dcc-subtle' }, t('providesNone'));
                return h('div', { className: 'dcc-provides-grid' }, listed.map(([key, label, icon]) =>
                  h(Button, { key, className: 'dcc-provides-item', title: t('providesDrill'),
                    onClick: () => onDrill && onDrill(item.plugin.key, key, item.name) },
                  h('span', { className: 'dcc-provides-icon', 'aria-hidden': 'true' }, icon),
                  h('span', { className: 'dcc-provides-count' }, provides[key]),
                  h('span', { className: 'dcc-provides-label' }, label))));
              })(),
              item.mcpNames?.length > 0 && h('p', { className: 'dcc-subtle' }, `MCP: ${item.mcpNames.join(', ')}`),
              item.hookEvents?.length > 0 && h('p', { className: 'dcc-subtle' }, `Hooks: ${item.hookEvents.join(', ')}`)),
            h('dl', null, rows.map(([key, value]) => h('div', { className: 'dcc-inv-kv', key: key }, h('dt', null, key), h('dd', null, String(value))))),
            h('div', { className: 'dcc-inv-kv' }, h('dt', null, t('dshState')),
              h('dd', null, item.disabledByPlugin || item.disabledInClaude || item.disabledInDsh ? t('disabled') : item.toggleable === false ? t('displayOnly') : t('enabled')),
              item.toggleable !== false && h('dd', { className: 'dcc-subtle' }, t(item.kind === 'plugin' ? 'pluginToggleScope' : 'toggleScope'))),
            item.disabledByPlugin && h('p', { className: 'dcc-subtle' }, t('parentDisabled')),
            item.disabledInClaude && h('p', { className: 'dcc-subtle' }, t('claudeDisabled')),
            item.declarationOnly && h('p', { className: 'dcc-subtle' }, t('declarationOnly')),
            item.plugin && h('div', { className: 'dcc-inv-kv' }, h('dt', null, t('claudeState')),
              h('dd', null, t(item.plugin.enabledInClaude ? 'enabled' : 'disabled'))),
            item.path && h('div', { className: 'dcc-inv-filebar' },
              h(Button, { onClick: () => onOpenFile(item), disabled: !onOpenFile }, `📄 ${t('viewContent')}`),
              h(Button, { onClick: copyPathNow }, copyState === 'done' ? `✓ ${t('copied')}`
                : copyState === 'failed' ? t('copyFailed') : t('copyPath'))),
            h('div', { className: 'dcc-inv-actions' },
              item.kind === 'plugin' && h(React.Fragment, null,
                h(Button, { className: 'dcc-primary',
                  disabled: !operation || operation.busyFor({ action: 'plugins.update', target: item.plugin?.key, cwd }),
                  onClick: () => operation?.run({ action: 'plugins.update', target: item.plugin?.key, cwd }) }, t('update')),
                h(Button, {
                  disabled: !operation || operation.busyFor({ action: `plugins.${item.plugin?.enabledInClaude ? 'disable' : 'enable'}`, target: item.plugin?.key, cwd }),
                  onClick: () => onConfirm({ label: `${t('confirmWriteBack')}${item.name} → ${t(item.plugin?.enabledInClaude ? 'disabled' : 'enabled')}？`,
                    request: { action: `plugins.${item.plugin?.enabledInClaude ? 'disable' : 'enable'}`, target: item.plugin?.key, cwd } }) },
                t(item.plugin?.enabledInClaude ? 'writeBackDisable' : 'writeBackEnable')),
                h(Button, { className: 'dcc-danger',
                  disabled: !operation || operation.busyFor({ action: 'plugins.uninstall', target: item.plugin?.key, cwd }),
                  onClick: () => onConfirm({ label: `${t('confirmUninstall')} ${item.name}`, danger: true,
                    request: { action: 'plugins.uninstall', target: item.plugin?.key, cwd } }) }, t('uninstallPlugin')),
                h('p', { className: 'dcc-subtle' }, t('pluginActionHint'))),
              // Plugin-owned files belong to the plugin: trashing one would
              // corrupt the install, so it is not offered.
              fileBacked && !ownedByPlugin && h(React.Fragment, null,
                h(Button, { className: 'dcc-primary',
                  disabled: !operation || operation.busyFor({ action: 'inventory.trash', id: item.id, cwd }),
                  onClick: () => onConfirm({ label: `${t('confirmTrash')}（${item.name}）`, danger: true,
                    request: { action: 'inventory.trash', id: item.id, cwd } }) }, t('moveToTrash')),
                h('p', { className: 'dcc-subtle' }, t('trashHint'))),
              fileBacked && ownedByPlugin && h('p', { className: 'dcc-subtle' },
                `${t('trashNotForPlugin')}${item.pluginName || item.pluginKey}`)),
            (['mcp', 'hook'].includes(item.kind)
              || (item.kind === 'plugin' && ((item.provides?.mcp ?? 0) > 0 || (item.provides?.hook ?? 0) > 0)))
              && h('p', { className: 'dcc-subtle' }, t('restart')));
        }
        function Inventory({ sessionId }) {
          // Read once, before any state is initialised from it.
          const savedView = useRef(loadView()).current;
          const [kind, setKind] = useState(savedView.kind ?? 'plugin');
          const [source, setSource] = useState(savedView.source ?? '');
          const [groupBy, setGroupBy] = useState(savedView.groupBy === true);
          // Duplicates are hidden by default; the toolbar reveals them.
          const [showDuplicates, setShowDuplicates] = useState(savedView.showDuplicates === true);
          // Drill-down target: only items provided by this plugin key.
          // A drill-down belongs to the tab it was made in: carrying it into
          // another tab silently filtered that tab to nothing.
          const [pluginFilter, setPluginFilter] = useState(savedView.pluginFilter ?? { key: '', name: '', forKind: '' });
          const [query, setQuery] = useState(savedView.search ?? '');
          const [search, setSearch] = useState(savedView.search ?? '');
          const [offset, setOffset] = useState(savedView.offset ?? 0);
          const [pageSize, setPageSize] = useState(savedView.pageSize ?? 20);
          const [revision, setRevision] = useState(0);
          const [selectedId, setSelectedId] = useState(savedView.selectedId ?? null);
          const [cwdOverride, setCwdOverride] = useState(savedView.cwd ?? '');
          // Draggable column widths (px), persisted so the layout survives reloads.
          // Absolute caps proved wrong: a dragged 640px detail panel starves the
          // middle list at small window sizes. Cap by CONTAINER share instead —
          // at drag time AND against the persisted value once the grid measures.
          const gridRef = useRef(null);
          const [navWidth, setNavWidth] = useState(() => clamp(Number(readStorage('dcc-inv-nav')) || 190, 140, 320));
          const [detWidth, setDetWidth] = useState(() => clamp(Number(readStorage('dcc-inv-det')) || 340, 220, 640));
          const [measured, setMeasured] = useState(false);
          useEffect(() => {
            if (measured || !gridRef.current) return;
            setMeasured(true);
            const width = gridRef.current.clientWidth || 1200;
            setDetWidth((v) => clamp(v, 220, Math.max(220, Math.round(width * 0.55))));
            setNavWidth((v) => clamp(v, 140, Math.max(160, Math.round(width * 0.25))));
          }, [measured]);
          function clamp(value, min, max) { return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min; }
          const [dragging, setDragging] = useState('');
          function startResize(event, kind) {
            event.preventDefault();
            const startX = event.clientX;
            const start = kind === 'nav' ? navWidth : detWidth;
            const maxNav = Math.max(160, Math.round((gridRef.current?.clientWidth ?? 1200) * 0.25));
            const maxDet = Math.max(220, Math.round((gridRef.current?.clientWidth ?? 1200) * 0.55));
            const move = (ev) => {
              const delta = kind === 'nav' ? ev.clientX - startX : startX - ev.clientX;
              if (kind === 'nav') setNavWidth(clamp(start + delta, 140, maxNav));
              else setDetWidth(clamp(start + delta, 220, maxDet));
            };
            const up = () => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
              document.body.style.cursor = '';
              setDragging('');
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
            document.body.style.cursor = 'col-resize';
            setDragging(kind);
          }
          // Persist on release, not on every pointermove.
          useEffect(() => {
            if (dragging) return;
            try {
              localStorage.setItem('dcc-inv-nav', String(navWidth));
              localStorage.setItem('dcc-inv-det', String(detWidth));
            } catch { /* Optional layout persistence may be unavailable. */ }
          }, [dragging, navWidth, detWidth]);
          // One-click update: enqueue plugins.update for every installed plugin.
          const [updatingAll, setUpdatingAll] = useState(false);
          const [batchNote, setBatchNote] = useState('');
          const [dismissed, setDismissed] = useState(() => new Set());
          async function updateAll() {
            if (updatingAll) return;
            setUpdatingAll(true);
            setBatchNote(t('updating'));
            const activeView = () => operation.isMounted() && currentCwd.current === cwd;
            try {
              const targets = new Set();
              let offset = 0;
              while (true) {
                if (!activeView()) return;
                const page = await api({ action: 'inventory.list', cwd, kind: 'plugin', limit: 100, offset });
                for (const item of page?.items ?? []) if (item.plugin?.key) targets.add(item.plugin.key);
                if (!page?.hasMore) break;
                if (!page.items?.length) throw new Error(t('failed'));
                offset += page.items.length;
              }
              let accepted = 0, failed = 0, skipped = 0;
              const activeCount = async () => ((await api({ action: 'operation.list' })).items ?? []).filter(pendingJob).length;
              let active = await activeCount();
              for (const key of targets) {
                if (!activeView()) return;
                const request = { action: 'plugins.update', target: key, cwd };
                if (operation.busyFor(request)) { skipped++; continue; }
                // The Host admits at most 20 active jobs across all operation types.
                while (active >= 20) {
                  if (!activeView()) return;
                  setBatchNote(`${t('waitingForCapacity')} ${t('updateQueued')}: ${accepted}`);
                  await new Promise((resolve) => setTimeout(resolve, 700));
                  if (!activeView()) return;
                  active = await activeCount();
                }
                if (!activeView()) return;
                const job = await operation.run(request);
                if (job) { accepted++; if (pendingJob(job)) active++; } else failed++;
              }
              setBatchNote(`${t('updateQueued')}: ${accepted} · ${t('failed')}: ${failed} · ${t('alreadyPending')}: ${skipped}`);
            } catch (error) { setBatchNote(`${t('failed')}: ${error.message}`); }
            finally { setUpdatingAll(false); }
          }
          const status = useLoad({ action: 'status', ...(sessionId ? { sessionId } : {}) }, revision);
          const cwd = cwdOverride || status.data?.cwd || '';
          const drillActive = pluginFilter.key !== '' && pluginFilter.forKind === kind;
          // One place that answers "why is this list empty": every filter that is
          // currently narrowing it, each removable on its own.
          const activeFilters = [
            search !== '' && { key: 'search', label: `${t('query')}: ${search}`,
              clear: () => { remember(); setQuery(''); setSearch(''); setOffset(0); } },
            source !== '' && { key: 'source', label: `${t('sourceLabel')}: ${t(INV_SOURCE_LABEL[source] ?? source)}`,
              clear: () => { remember(); setSource(''); setOffset(0); setSelectedId(null); } },
            drillActive && { key: 'plugin', label: `${t('filteredByPlugin')} ${pluginFilter.name || pluginFilter.key}`,
              clear: () => { remember(); setPluginFilter({ key: '', name: '', forKind: '' }); setOffset(0); setSelectedId(null); } },

          ].filter(Boolean);
          const clearAllFilters = () => {
            remember();
            setQuery(''); setSearch(''); setSource('');
            setPluginFilter({ key: '', name: '', forKind: '' });
            setShowDuplicates(false); setOffset(0); setSelectedId(null);
          };
          // Full-area file viewer state (see FileViewer).
          const emptyView = { open: false, id: '', name: '', path: '', loading: false, data: null,
            error: '', translating: false, translation: undefined, translateError: '', cached: false, backend: '' };
          const [fileView, setFileView] = useState(emptyView);
          const targetLanguage = () => {
            try { return ctx.get('locale')?.getLocale?.()?.active ?? 'en'; } catch { return 'en'; }
          };
          const fileEpoch = useRef(0);
          const currentCwd = useRef(cwd);
          currentCwd.current = cwd;
          useEffect(() => () => { fileEpoch.current++; }, []);
          const closeFile = () => { fileEpoch.current++; setFileView(emptyView); };
          const readFile = (item, opening) => {
            const epoch = ++fileEpoch.current;
            const project = cwd;
            if (opening) setFileView({ ...emptyView, open: true, id: item.id, name: item.name, path: item.path ?? '', loading: true });
            else setFileView((v) => ({ ...v, loading: true, error: '', data: null }));
            api({ action: 'inventory.read', id: item.id, cwd: project }).then(
              (data) => { if (epoch === fileEpoch.current && project === currentCwd.current) setFileView((v) => ({ ...v, loading: false, data })); },
              (error) => { if (epoch === fileEpoch.current && project === currentCwd.current) setFileView((v) => ({ ...v, loading: false, error: error.message })); });
          };
          const openFile = (item) => readFile(item, true);
          const reloadFile = () => readFile(fileView, false);
          const translationTask = useTranslationTask({
            itemId: fileView.id, cwd, lang: targetLanguage(), enabled: fileView.open,
          });
          const translationJob = translationTask.job;
          const translationResult = translationJob?.state === 'done'
            && translationJob.result?.sourceHash === fileView.data?.contentHash
            ? translationJob.result : undefined;
          const viewer = {
            ...fileView,
            translating: translationTask.checking || Boolean(translationJob && pendingJob(translationJob)),
            checkingTranslation: translationTask.checking,
            translation: fileView.translationHidden ? undefined : translationResult?.content,
            cached: translationResult?.cached === true,
            backend: translationResult?.backend ?? translationJob?.translationProgress?.backend,
            translateError: translationTask.error || (translationJob?.state === 'done' && fileView.data && !translationResult ? t('sourceChanged') : '') || (['failed', 'cancelled'].includes(translationJob?.state)
              ? (translationJob.result?.error || t('failed')) : ''),
            translationProgress: translationJob?.translationProgress,
            elapsedSeconds: translationJob && pendingJob(translationJob)
              ? Math.max(0, Math.floor((translationTask.now - translationJob.createdAt) / 1000)) : 0,
          };
          const translateFile = (options = {}) => {
            if (options.revert === true) { setFileView((v) => ({ ...v, translationHidden: true })); return; }
            setFileView((v) => ({ ...v, translationHidden: false }));
            translationTask.start(options.force === true);
          };
          const state = useLoad(kind === 'trash'
            ? { action: 'inventory.trash-list', cwd }
            : { action: 'inventory.list', cwd, ...(drillActive ? { plugin: pluginFilter.key } : {}), kind, ...(source ? { source } : {}), ...(showDuplicates ? { duplicates: true } : {}), query: search, offset, limit: pageSize }, `${revision}:${cwd}:${showDuplicates}:${drillActive ? pluginFilter.key : ''}`);
          const operation = useOperation(() => setRevision((n) => n + 1), revision);
          // The batch note is transient: once no update job is pending or
          // failed, the panel (and its note) disappears on its own.
          useEffect(() => {
            if (!batchNote) return;
            const live = operation.jobs.some((job) => job.action === 'plugins.update'
              && (pendingJob(job) || job.state === 'failed'));
            if (live) return;
            const timer = setTimeout(() => setBatchNote(''), 4000);
            return () => clearTimeout(timer);
          }, [batchNote, operation.jobs]);
          const items = state.data?.items ?? [];
          const [confirm, setConfirm] = useState(null);
          // Jump target for "go to the copy in use": switch to that kind, then
          // select the row once it appears in the reloaded page.
          const [pendingSelect, setPendingSelect] = useState('');
          const counts = state.data?.counts;
          const selected = items.find((item) => item.id === selectedId) ?? null;
          useEffect(() => {
            saveView({ kind, source, pluginFilter, showDuplicates, search, query: search, offset, pageSize, groupBy, selectedId, cwd });
          }, [kind, source, pluginFilter, showDuplicates, search, offset, pageSize, groupBy, selectedId, cwd]);
          // A restored page offset can point past the end after the data changed.
          useEffect(() => {
            if (offset === 0 || state.loading || state.data === undefined) return;
            if (items.length === 0) setOffset(0);
          }, [offset, state.loading, state.data, items.length]);
          useEffect(() => {
            if (!pendingSelect || state.loading || !state.data) return;
            const hit = items.find((item) => item.id === pendingSelect);
            if (hit === undefined) {
              if (state.data.hasMore) setOffset((value) => value + pageSize);
              else { setPendingSelect(''); operation.reportError(t('unavailable')); }
              return;
            }
            setSelectedId(hit.id);
            setPendingSelect('');
          }, [pendingSelect, items, state.loading, state.data, pageSize]);
          // View history: every navigation (tab, drill-down, filter, page, row)
          // pushes the state it is leaving, so Back can restore it. Capped at 10.
          const historyRef = useRef([]);
          const [historyDepth, setHistoryDepth] = useState(0);
          function snapshot() {
            return { kind, source, pluginFilter, showDuplicates, search, query: search, offset, selectedId, pageSize, groupBy, cwd };
          }
          function remember() {
            setPendingSelect(''); setConfirm(null);
            const snap = snapshot();
            const last = historyRef.current[historyRef.current.length - 1];
            if (last !== undefined && JSON.stringify(last) === JSON.stringify(snap)) return;
            historyRef.current = [...historyRef.current, snap].slice(-10);
            setHistoryDepth(historyRef.current.length);
          }
          function goBack() {
            const previous = historyRef.current[historyRef.current.length - 1];
            if (previous === undefined) return;
            historyRef.current = historyRef.current.slice(0, -1);
            setHistoryDepth(historyRef.current.length);
            closeFile(); setConfirm(null); setPendingSelect('');
            setPageSize(previous.pageSize); setGroupBy(previous.groupBy); setCwdOverride(previous.cwd);
            setKind(previous.kind);
            setSource(previous.source);
            setPluginFilter(previous.pluginFilter);
            setShowDuplicates(previous.showDuplicates);
            setSearch(previous.search);
            setQuery(previous.query);
            setOffset(previous.offset);
            setSelectedId(previous.selectedId);
          }
          // Debounced live search: 220 ms is long enough to skip intermediate
          // keystrokes and short enough to feel immediate.
          useEffect(() => {
            if (query === search) return undefined;
            const timer = setTimeout(() => { remember(); setSearch(query); setOffset(0); setSelectedId(null); }, 220);
            return () => clearTimeout(timer);
          }, [query, search]);
          const refresh = () => setRevision((n) => n + 1);
          async function chooseDirectory() {
            try { const dir = await ctx.get('uiWorkspace')?.pickDirectory(); if (dir && dir !== cwd) {
              closeFile(); setConfirm(null); setPendingSelect('');
              historyRef.current = []; setHistoryDepth(0);
              setQuery(''); setSearch(''); setSource(''); setPluginFilter({ key: '', name: '', forKind: '' });
              setCwdOverride(dir); setOffset(0); setSelectedId(null);
            } }
            catch (error) { operation.reportError(error.message); }
          }
          const covered = fileView.open ? { inert: '', 'aria-hidden': true } : {};
          return h('div', { className: 'dcc dcc-inv-page' }, h('style', null, css),
            h('header', null, h('h2', null, t('invTitle')),
              h('div', { className: 'dcc-header-actions' },
                h(Button, { onClick: goBack, disabled: historyDepth === 0,
                  title: historyDepth === 0 ? t('backEmpty') : `${t('back')} (${historyDepth})` },
                `← ${t('back')}`),
                h(Button, { onClick: refresh }, t('refresh')))),
            h('div', { className: 'dcc-toolbar' },
              h('span', { className: 'dcc-subtle', style: { minWidth: 0, overflowWrap: 'anywhere' } }, t('project'), ': ', cwd || '—'),
              h(Button, { onClick: chooseDirectory }, t('choose')),
              state.data?.statePath && h('span', { className: 'dcc-subtle', style: { overflowWrap: 'anywhere' } }, ` · ${t('stateFile')}: ${state.data.statePath} · ${t('offCount')}: ${state.data.disabledCount ?? 0}`),
              kind === 'plugin' && h(Button, { className: 'dcc-primary', disabled: updatingAll, onClick: updateAll }, t('updateAll'))),
            h('p', { className: 'dcc-subtle' }, t('invHint')),
            h(Notice, { error: true }, operation.error),
            confirm && h('div', { className: 'dcc-confirm', role: 'group', 'aria-label': t('confirm') },
              h('p', null, confirm.label),
              h('div', { className: 'dcc-actions' },
                h(Button, { className: confirm.danger ? 'dcc-danger' : 'dcc-primary', disabled: operation.busyFor(confirm.request),
                  onClick: () => { operation.run(confirm.request); setConfirm(null); } }, t('confirm')),
                h(Button, { onClick: () => setConfirm(null) }, t('cancel')))),
            h('div', { ref: gridRef, className: 'dcc-inv', style: { '--dcc-inv-nav': `${navWidth}px`, '--dcc-inv-det': `${detWidth}px`, ...(fileView.open ? { height: 'min(78vh,860px)' } : {}) } },
              h('nav', { ...covered, className: 'dcc-inv-nav', 'aria-label': t('invTitle') },
                h('div', { className: 'dcc-inv-sec' }, t('globalCounts')),
                INV_KINDS.map(([value, label]) => h(Button, { key: value, 'aria-pressed': kind === value,
                  onClick: () => { remember(); setKind(value); setOffset(0); setSelectedId(null); } },
                t(label), h('span', { className: 'dcc-inv-cnt' }, counts?.[value] ?? (counts ? 0 : '—')))),
                h(Button, { key: 'trash', 'aria-pressed': kind === 'trash',
                  onClick: () => { remember(); setKind('trash'); setOffset(0); setSelectedId(null); } },
                `🗑 ${t('trash')}`)),
              h('div', { ...covered, className: `dcc-inv-split${dragging === 'nav' ? ' dcc-dragging' : ''}`, role: 'separator',
                'aria-orientation': 'vertical', 'aria-label': t('invTitle'),
                onPointerDown: (event) => startResize(event, 'nav') }),
              h('div', { ...covered, className: 'dcc-inv-list' },
                // Typing searches: there is no confirm step to forget, and no
                // stale applied query left behind after the box is cleared.
                kind !== 'trash' && h('div', { className: 'dcc-toolbar' },
                  h('input', { type: 'search', value: query, onChange: (event) => setQuery(event.target.value),
                    'aria-label': t('query'), placeholder: t('searchAsYouType') })),
                kind !== 'trash' && activeFilters.length > 0 && h('div', { className: 'dcc-inv-filters', role: 'group', 'aria-label': t('activeFilters') },
                  h('span', { className: 'dcc-subtle' }, `${t('activeFilters')}：`),
                  activeFilters.map((entry) => h('button', {
                    key: entry.key, className: 'dcc-filter-chip', onClick: entry.clear,
                    title: t('removeFilter'),
                  }, `${entry.label} ✕`)),
                  activeFilters.length > 1 && h(Button, { onClick: clearAllFilters }, t('clearFilters'))),
                h(LoadState, { state, retry: refresh,
                  empty: items.length === 0
                    ? (kind === 'trash' ? t('trashEmpty') : activeFilters.length > 0 ? `${t('noMatchFor')} ${activeFilters.map((entry) => entry.label).join(' · ')}` : t('empty'))
                    : '' }),
                kind === 'trash' && h('ul', { className: 'dcc-list', 'aria-busy': state.loading }, items.map((entry) => {
                  const request = { action: 'inventory.restore', id: entry.id, cwd };
                  return h('li', { key: `${entry.id}:${entry.trashedAt}`, className: `dcc-inv-item${selectedId === entry.id ? ' dcc-inv-sel' : ''}`,
                    role: 'button', tabIndex: 0, onClick: () => { remember(); setSelectedId(entry.id); },
                    onKeyDown: (event) => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter') { remember(); setSelectedId(entry.id); } } },
                  h('span', { className: 'dcc-inv-ico', 'aria-hidden': 'true' }, '🗑'),
                  h('span', { className: 'dcc-inv-tx' },
                    h('span', { className: 'dcc-inv-nm' }, entry.name),
                    h('span', { className: 'dcc-inv-ds' }, entry.originalPath, ' · ', entry.trashedAt)),
                  h(Button, { disabled: operation.busyFor(request), onClick: () => operation.run(request) }, t('restore')));
                })),
                kind !== 'trash' && kind !== 'plugin' && h('div', { className: 'dcc-toolbar', role: 'group', 'aria-label': t('srcLabel') },
                  [['', 'allSources'], ['claude-plugin', 'srcPlugin'], ['project-claude', 'srcProject'], ['user-claude', 'srcUser']].map(([value, label]) =>
                    h(Button, { key: value || 'all', 'aria-pressed': source === value,
                      onClick: () => { remember(); setSource(value); setOffset(0); setSelectedId(null); } }, t(label))),
                  h('span', { style: { flex: 1 } }),
                  h(Button, { 'aria-pressed': groupBy, title: t('groupByPlugin'), onClick: () => { remember(); setGroupBy((value) => !value); } },
                    `☰ ${t('groupByPlugin')}`),
                  (() => {
                    const dupCount = state.data?.shadowedCounts?.[kind] ?? 0;
                    if (dupCount === 0) return null;
                    return h(Button, { 'aria-pressed': showDuplicates, title: t('duplicatesHint'),
                      onClick: () => { remember(); setShowDuplicates((value) => !value); setOffset(0); setSelectedId(null); } },
                    `${t('duplicates')} ${dupCount}`);
                  })()),
                kind !== 'trash' && (() => {
                  const row = (item) => {
                    const icon = (INV_KINDS.find(([value]) => value === item.kind) ?? [null, null, '📄'])[2];
                    const request = { action: 'inventory.toggle', id: item.id, kind: item.kind, disabled: !item.disabledInDsh, cwd };
                    return h('li', { key: item.id, className: `dcc-inv-item${selectedId === item.id ? ' dcc-inv-sel' : ''}${item.disabledInDsh ? ' dcc-off' : ''}`,
                      role: 'button', tabIndex: 0, onClick: () => { remember(); setSelectedId(item.id); },
                      onKeyDown: (event) => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); remember(); setSelectedId(item.id); } } },
                    h('span', { className: 'dcc-inv-ico', 'aria-hidden': 'true' }, icon),
                    h('span', { className: 'dcc-inv-tx' },
                      h('span', { className: 'dcc-inv-nm' }, item.name, ' ',
                        h('span', { className: 'dcc-tag' }, INV_SOURCE_LABEL[item.source] ? t(INV_SOURCE_LABEL[item.source]) : item.source),
                        item.overriddenBy && h('span', { className: 'dcc-tag dcc-error',
                          title: t('shadowRowTitle') },
                        // Same-plugin duplicates are the common case, where naming
                        // the plugin repeats what the row already says. There the
                        // useful fact is which KIND of copy won.
                        item.overriddenBySamePlugin
                          ? `${t('duplicateShort')} · ${t('usedKind')} ${item.overriddenByKind}`
                          : `${t('duplicateShort')} · ${t('usedFrom')} ${item.overriddenByName || (item.overriddenByPath || '').split('/').slice(-2, -1)[0] || ''}`)),
                      h('span', { className: 'dcc-inv-ds' }, item.description || '')),
                    item.toggleable === false ? h('span', { className: 'dcc-tag', title: item.toggleBlockedReason },
                      t(item.disabledByPlugin || item.disabledInClaude ? 'disabled' : 'displayOnly')) : h(Switch, { checked: !item.disabledInDsh, disabled: operation.busyFor(request),
                      label: `${t(item.disabledInDsh ? 'enable' : 'disable')} ${item.name}`,
                      onChange: () => operation.run(request) }));
                  };
                  if (!groupBy || items.length === 0) return h('ul', { className: 'dcc-list', 'aria-busy': state.loading }, items.map(row));
                  const groups = new Map();
                  for (const item of items) {
                    const label = item.pluginName ?? (item.source === 'project-claude' ? t('groupProject')
                      : item.source === 'user-claude' ? t('groupUser') : t('groupUngrouped'));
                    if (!groups.has(label)) groups.set(label, []);
                    groups.get(label).push(item);
                  }
                  return h('div', { 'aria-busy': state.loading }, [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, group]) =>
                    h('details', { key: label, open: true, style: { marginBottom: 10 } },
                      h('summary', { style: { cursor: 'pointer', padding: '6px 4px', fontWeight: 600 } },
                        '🧩 ', label, ' ', h('span', { className: 'dcc-tag' }, group.length)),
                      h('ul', { className: 'dcc-list', style: { margin: '6px 0 0' } }, group.map(row)))));
                })(),
                kind !== 'trash' && h(Pagination, { state, offset, pageSize, changePage: (next) => { remember(); setOffset(next); setSelectedId(null); },
                  changeSize: (size) => { remember(); setPageSize(size); setOffset(0); setSelectedId(null); } })),
              h('div', { ...covered, className: `dcc-inv-split${dragging === 'det' ? ' dcc-dragging' : ''}`, role: 'separator',
                'aria-orientation': 'vertical', 'aria-label': t('invTitle'),
                onPointerDown: (event) => startResize(event, 'det') }),
              h('aside', { ...covered, className: 'dcc-inv-detail', 'aria-label': t('invTitle') },
                h(InvTasks, { operation, batchNote, dismissed,
                  onDismiss: (ids) => setDismissed((old) => new Set([...old, ...ids])) }),
                kind === 'trash'
                  ? (selected ? h('section', null, h('h3', null, selected.name),
                      h('dl', null, [['originalPath', selected.originalPath], ['trashedAt', selected.trashedAt]].map(([key, value]) =>
                        h('div', { className: 'dcc-inv-kv', key }, h('dt', null, t(key)), h('dd', null, value)))),
                      h('div', { className: 'dcc-inv-actions' },
                        h(Button, { className: 'dcc-primary', disabled: operation.busyFor({ action: 'inventory.restore', id: selected.id, cwd }),
                          onClick: () => operation.run({ action: 'inventory.restore', id: selected.id, cwd }) }, t('restore'))))
                    : h('p', { className: 'dcc-subtle' }, t('notSelected')))
                  : h(InvDetail, { item: selected, operation, cwd, onConfirm: setConfirm,
                    onOpenFile: openFile,
                    // The callee passes what it knows; this scope has no `item`.
                    onDrill: (pluginKey, kindName, pluginName) => {
                      remember();
                      setSource(''); setShowDuplicates(true); setOffset(0); setSelectedId(null);
                      setSearch(''); setQuery('');
                      setPluginFilter({ key: pluginKey, name: pluginName || pluginKey, forKind: kindName });
                      setKind(kindName);
                    },
                    onShadowJump: (source) => {
                      remember();
                      const winnerKind = source.overriddenByKind || String(source.overriddenBy || '').split('#')[1];
                      setSource(''); setPluginFilter({ key: '', name: '', forKind: '' }); setShowDuplicates(false);
                      setSearch(''); setQuery(''); setOffset(0); setSelectedId(null);
                      if (winnerKind && winnerKind !== kind) setKind(winnerKind);
                      setPendingSelect(source.overriddenBy);
                    } })),
              fileView.open && h(FileViewer, { view: viewer, targetLanguage,
                onClose: closeFile, onReload: reloadFile, onTranslate: translateFile })));
        }
        function BridgeStatus({ status, refresh, operation }) {
          const data = status.data;
          const rows = data ? [
            ['version', data.version], ['source', data.userClaudeDir], ['pluginRoot', data.pluginsRoot],
            ['nativeSessions', t(data.nativeSessions ? 'available' : 'unavailable')],
            ['contextHandoff', t(data.contextHandoff ? 'available' : 'unavailable')],
            ...Object.entries(data.features || {}).map(([key, enabled]) => [key, t(enabled ? 'enabled' : 'disabled')]),
          ] : [];
          return h('section', null,
            h(LoadState, { state: status, retry: refresh }),
            h('dl', null, rows.map(([key, value]) => h('div', { key }, h('dt', null, t(key)), h('dd', null, value)))),
            h('div', { className: 'dcc-toolbar' },
              h(Button, { disabled: operation.busyFor({ action: 'reload' }), onClick: () => operation.run({ action: 'reload' }) }, t('refresh')),
              h(Button, { onClick: () => { try { ctx.get('layout')?.selectPanel('claude-compat'); } catch { /* panel optional */ } } }, t('openInventory'))),
            h('p', { className: 'dcc-subtle' }, t('restart')));
        }
        function Manager({ initialMode = 'plugins', initialCwd, sessionId, resumeMode = 'new', targetSessionId }) {
          const [mode, setMode] = useState(initialMode);
          const [pageSize, setPageSize] = useState(10);
          const [cwd, setCwd] = useState(initialCwd || '');
          const [revision, setRevision] = useState(0);
          const status = useLoad({ action: 'status', ...(sessionId ? { sessionId } : {}) }, revision);
          const effectiveCwd = cwd || status.data?.cwd || '';
          const refresh = () => setRevision((n) => n + 1);
          const live = useRef(true);
          const resumeNavigation = useRef(null);
          const currentTarget = resumeMode === 'current' ? (targetSessionId || sessionId) : undefined;
          const canResume = resumeMode !== 'current' || Boolean(currentTarget);
          const requestFor = (sourceCwd, sourceId, limitTurns) => ({ action: 'sessions.resume', cwd: sourceCwd, sessionId: sourceId,
            ...(currentTarget ? { targetSessionId: currentTarget } : {}), ...(limitTurns ? { limitTurns } : {}) });
          function resume(request) {
            if (!canResume) { operation.reportError(t('noCurrentSession')); return; }
            resumeNavigation.current = resumeMode === 'new' ? ctx.get('layout')?.beginNavigation() ?? null : null;
            return operation.run(request);
          }
          useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
          async function openSession(id, jobId) {
            try {
              if (!jobId) operation.stopAutoOpen();
              const sessions = ctx.get('sessions');
              const navigation = jobId ? resumeNavigation.current : ctx.get('layout')?.beginNavigation();
              if (navigation?.aborted) return;
              if (sessions?.refresh) await sessions.refresh();
              if (!live.current || navigation?.aborted || (jobId && !operation.shouldOpen(jobId))) return;
              const workspace = ctx.get('uiWorkspace');
              if (!workspace) throw new Error(t('unavailable'));
              workspace.openSession(id);
            } catch (error) { if (live.current) operation.reportError(error.message); }
          }
          const operation = useOperation(async (result, job) => {
            refresh();
            if (result.destination === 'new' && result.accepted && result.sessionId && operation.shouldOpen(job.id)) await openSession(result.sessionId, job.id);
          }, revision);
          return h('div', { className: 'dcc' }, h('style', null, css),
            h('header', null, h('h2', null, t('title')), h(Button, { onClick: refresh }, t('refresh'))),
            h('nav', { className: 'dcc-nav', 'aria-label': t('title') }, ['plugins', 'search', 'markets', 'sessions', 'status'].map((key) =>
              h(Button, { key, 'aria-pressed': mode === key, onClick: () => setMode(key) }, t(key)))),
            h(OperationNotice, { operation }),
            mode === 'status' ? h(BridgeStatus, { status, refresh, operation })
              : mode === 'sessions' ? (effectiveCwd ? h(Sessions, { key: effectiveCwd, cwd: effectiveCwd, setCwd, revision, refresh, operation, requestFor, resume, canResume, resumeMode, pageSize, setPageSize }) : h(LoadState, { state: status, retry: refresh }))
                : (effectiveCwd ? h(Plugins, { key: mode, mode, cwd: effectiveCwd, revision, refresh, operation, pageSize, setPageSize }) : h(LoadState, { state: status, retry: refresh })));
        }
        class Boundary extends React.Component {
          constructor(props) { super(props); this.state = { error: '' }; }
          static getDerivedStateFromError(error) { return { error: error.message }; }
          render() { return this.state.error ? h('div', { className: 'dcc', role: 'alert' }, this.state.error) : this.props.children; }
        }
        function wrapped(Component) { return (props) => h(Boundary, null, h(Component, props)); }
        const commandModes = { 'cc-resume': 'sessions', 'cc-plugin': 'plugins', 'cc-export': null,
          'reload-cc-plugins': null, 'reload-skills': null };
        function CommandView({ node, sessionId, mode, forceExpanded }) {
          let payload;
          try { payload = JSON.parse(node.outcome?.text || '{}'); } catch { payload = null; }
          const manager = payload?.ui === 'claude-compat' && ['sessions', 'plugins'].includes(mode);
          const [expanded, setExpanded] = useState(forceExpanded ?? false);
          const [error, setError] = useState('');
          const initialized = useRef(false);
          useEffect(() => {
            if (initialized.current || !node.outcome) return;
            initialized.current = true;
            if (manager && (forceExpanded ?? (Date.now() - node.time < 60_000))) setExpanded(true);
          }, [node.commandId, node.outcome, node.time, manager, forceExpanded]);
          async function openImported() {
            try { await ctx.get('sessions')?.refresh(); ctx.get('uiWorkspace')?.openSession(payload.sessionId); }
            catch (failure) { setError(failure.message); }
          }
          const resultText = typeof payload?.text === 'string' ? payload.text
            : payload && typeof payload === 'object' ? JSON.stringify(payload, null, 2) : node.outcome?.text;
          const outcomeError = node.outcome?.kind === 'error'
            ? (typeof payload?.error === 'string' ? payload.error : node.outcome.text) : '';
          return h('div', { className: 'dcc dcc-card' }, h('style', null, css),
            h('div', { className: 'dcc-toolbar' }, h('strong', null, `/${node.name}`),
              manager && h(Button, { 'aria-expanded': expanded, onClick: () => setExpanded((value) => !value) }, t(expanded ? 'hide' : 'show'))),
            h(Notice, { error: true }, error || outcomeError),
            !node.outcome && h('p', { role: 'status' }, t('loading')),
            !manager && node.outcome?.kind === 'success' && h('details', { open: forceExpanded ?? true },
              h('summary', null, t('result')), h('pre', null, resultText)),
            mode === 'sessions' && payload?.sessionId && payload?.destination !== 'current' && h(Button, { onClick: openImported }, t('open')),
            manager && expanded && h(Manager, { initialMode: mode, initialCwd: payload?.cwd, sessionId,
              resumeMode: mode === 'sessions' ? 'current' : 'new', targetSessionId: mode === 'sessions' ? (sessionId || payload?.targetSessionId) : undefined }));
        }
        function BlankCommandResults(props) {
          // The native store keeps its identity; its cached values array changes
          // when command/run becomes command/done, even if order is unchanged.
          const nodes = props.useChat((snapshot) => snapshot.nodes.values());
          const active = props.useConversation((snapshot) => snapshot.activeTargets.size > 0);
          const { session } = props;
          // Match the native blank-phase gate, so the regular Chat view owns all
          // command rows as soon as another target or prompt activates it.
          if (!session.blank || session.running || session.promptAttempted || active) return null;
          const commands = Array.from(nodes).filter((node) => node.kind === 'command'
            && Object.hasOwn(commandModes, node.data?.name)).map((node) => node.data)
            .sort((a, b) => a.seq - b.seq).slice(-5).reverse();
          if (!commands.length) return null;
          return h('section', { className: 'dcc-command-dock', 'aria-label': t('commandResults') },
            commands.map((node, index) => h(CommandView, { key: `${node.commandId}:${index === 0}`, node,
              sessionId: props.sessionId || session.sessionId, mode: commandModes[node.name], forceExpanded: index === 0 })));
        }
        function FirstCommandDock(props) {
          if (!props.session?.blank || !props.useChat || !props.useConversation) return null;
          return h(BlankCommandResults, { ...props, key: props.sessionId || props.session.sessionId });
        }
        ctx.slots.inject('plugins.tab', () => ctx.slots.register({ name: 'plugins.tab', id: 'claude-compat', order: 20,
          label: () => t('title'), locale: 'claudeCompat' }, wrapped(Manager)));
        // Dedicated sidebar entry + central page (three-pane inventory). The
        // sidebar row id and the main panel key share one id, so the host wires
        // the row click to selectPanel — the same contract dshmarket uses.
        // Plain register, NOT slots.inject: `main` is a shadows-shipped-ui
        // slot and injecting into it throws at load, killing the whole package.
        ctx.slots.register({ name: 'main', key: 'claude-compat', locale: 'claudeCompat' },
          wrapped((props) => h(Inventory, { sessionId: props?.sessionId })));
        ctx.slots.register({
          name: 'sidebar.panellist', id: 'claude-compat', order: 20,
          label: () => t('bridge'), locale: 'claudeCompat',
        }, (owner = {}) => h('svg', { width: owner.size ?? 18, height: owner.size ?? 18, viewBox: '0 0 24 24',
          fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
          h('path', { d: 'M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7' })));
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: 'dsh-claude-compat',
          locale: 'claudeCompat' }, wrapped(() => h(Manager, { initialMode: 'status' }))));
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock', id: 'claude-compat-commands', order: 30, locale: 'claudeCompat',
        }, wrapped(FirstCommandDock)));
        for (const [key, mode] of Object.entries(commandModes)) {
          ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
            name: 'conversation.chat.commandview', key, locale: 'claudeCompat',
          }, wrapped((props) => h(CommandView, { ...props, mode }))));
        }
      },
    };
  },
});
