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
        query: 'Search by name or description', empty: 'No matching items', enabled: 'Enabled', disabled: 'Disabled',
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
        source: 'Claude configuration', pluginRoot: 'Plugin directory', version: 'Bridge version',
        noSessions: 'No Claude Code sessions in this project. Choose another directory or refresh.',
        next: 'Next page', previous: 'Previous page', archiveNote: 'Send the conversation file path to DSH and ask for its background, current task state and next steps. DSH reads the file as needed.',
        userScope: 'User scope', result: 'Operation details', noCli: 'Installation and updates use the Claude CLI.',
        partial: 'Some content could not be imported', statusUnavailable: 'Cannot read bridge status',
        available: 'Available', unavailable: 'Unavailable', nativeSessions: 'History archive', contextHandoff: 'Context handoff',
        skills: 'Skills', rules: 'Rules', hooks: 'Hooks', mcp: 'MCP', pluginMcp: 'Plugin MCP',
        commandResults: 'Command results', show: 'Show manager', hide: 'Collapse manager', permissions: 'Only the DSH owner can manage Claude Code configuration.',
      },
      zh: {
        title: 'Claude Code', plugins: '已安装插件', search: '发现插件', find: '搜索', markets: '插件市场',
        sessions: '历史会话', status: '桥接状态', loading: '正在加载…', retry: '重试', refresh: '刷新',
        query: '搜索名称或描述', empty: '没有匹配的内容', enabled: '已启用', disabled: '已禁用',
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
        source: 'Claude 配置目录', pluginRoot: '插件目录', version: '兼容插件版本',
        noSessions: '此项目没有 Claude Code 会话，可选择其他目录或刷新。',
        next: '下一页', previous: '上一页', archiveNote: '只发送会话文件路径，请 DSH 阅读后简述背景、当前任务状态和下一步计划；文件内容由 DSH 按需读取。',
        userScope: '用户级', result: '操作详情', noCli: '安装与更新通过 Claude CLI 执行。',
        partial: '部分内容未能导入', statusUnavailable: '无法读取桥接状态',
        available: '可用', unavailable: '不可用', nativeSessions: '历史归档', contextHandoff: '上下文接续',
        skills: '技能', rules: '规则', hooks: 'Hooks', mcp: 'MCP', pluginMcp: '插件 MCP',
        commandResults: '命令结果', show: '展开管理界面', hide: '收起管理界面', permissions: '仅 DSH 所有者可管理 Claude Code 配置。',
      },
    };
    const css = `
.dcc{font:inherit;color:var(--dsw-alias-label-primary);min-width:0;width:100%;box-sizing:border-box;padding:20px 0;line-height:1.5}
.dcc *{box-sizing:border-box}.dcc h2{font-size:18px;line-height:1.4;margin:0}.dcc h3{font-size:14px;margin:0}.dcc p{margin:6px 0}.dcc header,.dcc-toolbar,.dcc-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dcc header{justify-content:space-between;margin-bottom:16px}.dcc-nav{display:flex;gap:4px;flex-wrap:wrap;padding-bottom:14px;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:18px}.dcc button,.dcc input,.dcc select{font:inherit;font-size:13px;min-height:34px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;color:inherit;background:var(--dsw-alias-bg-layer-1);padding:6px 10px}.dcc button{cursor:pointer}.dcc button:hover{background:var(--dsw-alias-bg-layer-2)}.dcc button:disabled{opacity:.5;cursor:default}.dcc button:focus-visible,.dcc input:focus-visible,.dcc select:focus-visible,.dcc summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dcc button[aria-pressed=true]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}.dcc .dcc-primary{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);border-color:var(--dsw-alias-brand-primary)}.dcc .dcc-danger{color:var(--dsw-alias-state-error-primary)}.dcc-toolbar{margin:12px 0}.dcc-toolbar input{flex:1;min-width:160px}.dcc-list{list-style:none;padding:0;margin:0}.dcc-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.dcc-main{min-width:0;flex:1}.dcc-title{font-weight:600;overflow-wrap:anywhere}.dcc-subtle{font-size:12px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}.dcc-tag{display:inline-block;border:1px solid var(--dsw-alias-border-l1);border-radius:5px;padding:1px 6px;margin:4px 6px 0 0;font-size:11px;color:var(--dsw-alias-label-secondary)}.dcc-notice{padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-wrap:anywhere}.dcc-error{color:var(--dsw-alias-state-error-primary)}.dcc-ok{color:var(--dsw-alias-state-success-primary)}.dcc pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;font-size:12px;max-height:260px;overflow:auto;padding:12px;background:var(--dsw-alias-bg-layer-1);border-radius:8px}.dcc-field{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}.dcc-field>span{font-size:12px;color:var(--dsw-alias-label-secondary)}.dcc-field input:not([type=checkbox]){flex:1;min-width:160px}.dcc-field input[type=checkbox]{min-height:20px;width:18px;height:18px;accent-color:var(--dsw-alias-brand-primary)}.dcc dl{margin:0}.dcc dl>div{display:grid;grid-template-columns:150px minmax(0,1fr);gap:12px;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.dcc dt{color:var(--dsw-alias-label-secondary);font-size:12px}.dcc dd{margin:0;overflow-wrap:anywhere;font-size:13px}.dcc-empty{padding:30px 0;color:var(--dsw-alias-label-secondary);font-size:13px}.dcc-card{padding:12px 0}.dcc-session-item{display:block;padding:14px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.dcc-session-item>.dcc-row{padding:0;border:0}.dcc-session-title{display:block;text-align:left;width:100%;background:none!important;border:0!important;padding:0!important;min-height:32px!important}.dcc-selected{border-left:2px solid var(--dsw-alias-brand-primary);padding-left:10px}.dcc-confirm{padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}.dcc summary{cursor:pointer;font-size:12px}.dcc-progress{width:100%;height:4px;accent-color:var(--dsw-alias-brand-primary)}
.dcc-command-dock{max-height:min(58vh,640px);overflow:auto;overscroll-behavior:contain;margin-bottom:8px}.dcc-command-dock>.dcc-card{margin:0 0 8px}
@media(max-width:600px){.dcc{padding:12px 0}.dcc-row{align-items:flex-start;flex-direction:column;gap:8px}.dcc-actions{width:100%}.dcc dl>div{grid-template-columns:1fr;gap:4px}.dcc-nav button{flex:1}.dcc input,.dcc select{font-size:16px}.dcc-toolbar{align-items:stretch}.dcc-toolbar button{flex-shrink:0}}
`;
    // Item identity is the Host operationKey wire contract; actions on one row
    // share identity, while independent plugin/marketplace targets stay usable.
    function operationKey(request) {
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
      return a[0] === b[0] && ['marketplace', 'plugin'].includes(a[0]) && (a[1] === '*' || b[1] === '*');
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
        function Button({ children, ...props }) { return h('button', { type: 'button', ...props }, children); }
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
                setError('');
                delay = jobsRef.current.some(pendingJob) || pending.current.size ? 700 : 5000;
              } catch (failure) { if (!controller.signal.aborted) setError(failure.message); }
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
            if (busyFor(request)) return;
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
            error, run, cancel, busyFor, forItem, reportError: setError,
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
        function OperationNotice({ operation }) {
          const { jobs, error } = operation;
          const active = jobs.filter(pendingJob).length;
          return h(React.Fragment, null,
            h(Notice, { error: true }, error),
            jobs.length > 0 && h('details', { className: 'dcc-notice' },
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
            h('div', { className: 'dcc-toolbar' }, h(Button, { disabled: operation.busyFor({ action: 'reload' }), onClick: () => operation.run({ action: 'reload' }) }, t('refresh'))),
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
