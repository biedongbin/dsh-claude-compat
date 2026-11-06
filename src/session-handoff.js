// Hand off read-only Claude history through ordinary DSH Session admission.
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

const RECEIPT_HISTORY = 20;
const REQUEST_FIELDS = new Set(['action', 'cwd', 'sessionId', 'limitTurns', 'targetSessionId']);
const serviceOf = (ctx, name) => typeof ctx.get === 'function' ? ctx.get(name) : ctx[name];
const check = (signal) => signal.throwIfAborted();
function textField(value, name, required = false) {
  if (value === undefined && !required) return;
  if (typeof value !== 'string' || !value.trim() || value.length > 8192 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`${name} must be a nonempty string without control characters`);
  }
}
function snapshotRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Handoff request must be an object');
  for (const key of Object.keys(request)) if (!REQUEST_FIELDS.has(key)) throw new Error(`Unknown handoff request field: ${key}`);
  textField(request.sessionId, 'sessionId', true);
  textField(request.cwd, 'cwd');
  textField(request.targetSessionId, 'targetSessionId');
  textField(request.action, 'action');
  if (request.limitTurns !== undefined && (!Number.isSafeInteger(request.limitTurns) || request.limitTurns < 1)) {
    throw new Error('limitTurns must be a positive safe integer');
  }
  return Object.freeze(Object.fromEntries(['cwd', 'sessionId', 'limitTurns', 'targetSessionId']
    .filter((key) => request[key] !== undefined).map((key) => [key, request[key]])));
}
function progress(callback, message) {
  // A display observer cannot change native Session admission ownership.
  try {
    const observed = callback?.(message);
    if (observed && typeof observed.then === 'function') void Promise.resolve(observed).catch(() => {});
  } catch { /* observer failure is isolated */ }
}
function contextPrompt(source, request) {
  const range = request.limitTurns ? `，重点关注最近 ${request.limitTurns} 轮用户对话` : '';
  return `请阅读并理解 Claude Code 会话文件 ${JSON.stringify(source.sourcePath)}${range}，简述背景、当前任务状态和下一步计划。文件较大时请分段读取或按需检索。\n来源项目：${JSON.stringify(source.cwd)}`;
}

export function createSessionHandoffService(ctx, _config, prepareHandoff) {
  if (typeof prepareHandoff !== 'function') throw new Error('A read-only prepareHandoff function is required');
  const receipts = new Map(), completed = [];

  async function perform(record, request, signal, onProgress) {
    check(signal);
    progress(onProgress, 'Locating the Claude Code conversation file');
    const source = await prepareHandoff(request, signal);
    check(signal);
    if (!source || typeof source !== 'object') throw new Error('Claude conversation file could not be located');
    textField(source.cwd, 'Source project', true);
    textField(source.id, 'Source sessionId', true);
    textField(source.sourcePath, 'Source path', true);
    if (!isAbsolute(source.cwd) || !isAbsolute(source.sourcePath)) throw new Error('Prepared source project and path must be absolute');
    record.metadata = { ...record.metadata, sourceCwd: source.cwd, sourceSessionId: source.id,
      sourcePath: source.sourcePath, title: String(source.title || source.id).slice(0, 240),
      warnings: Array.isArray(source.warnings) ? source.warnings.filter((warning) => typeof warning === 'string').slice(0, 20) : [],
      ...(Number.isSafeInteger(source.sizeBytes) && source.sizeBytes >= 0 ? { sizeBytes: source.sizeBytes } : {}),
    };
    record.failedAt = 'services';
    const controller = serviceOf(ctx, 'sessionController');
    if (!controller || typeof controller.prompt !== 'function'
      || (record.metadata.destination === 'new' && typeof controller.create !== 'function')) {
      throw new Error('Native DSH sessionController is unavailable for conversation handoff');
    }
    if (record.metadata.destination === 'new') {
      const registry = serviceOf(ctx, 'workspaceRegistry');
      if (!registry || typeof registry.create !== 'function') throw new Error('Native DSH workspaceRegistry is unavailable for conversation handoff');
      record.failedAt = 'workspace';
      progress(onProgress, 'Opening the source project workspace');
      check(signal);
      const workspace = await registry.create(source.cwd);
      textField(workspace?.id, 'Created workspaceId', true);
      record.metadata.workspaceId = workspace.id;
      record.metadata.cwd = workspace.path || source.cwd;
      record.failedAt = 'create-session';
      progress(onProgress, 'Creating an ordinary DSH conversation');
      check(signal);
      const created = await controller.create({ workspaceId: workspace.id });
      textField(created?.sessionId, 'Created sessionId', true);
      record.metadata.sessionId = created.sessionId;
      record.createdSession = true;
    }
    const text = contextPrompt(source, request);
    record.failedAt = 'prompt';
    progress(onProgress, 'Asking DSH to read the conversation file and summarize');
    check(signal);
    record.promptStarted = true;
    const acknowledgement = await controller.prompt({ requestId: record.id,
      sessionId: record.metadata.sessionId, mode: 'queue', content: [{ type: 'text', text }],
    }, signal);
    if (acknowledgement?.accepted === false) record.delivery = 'not-accepted';
    if (acknowledgement?.accepted !== true) throw new Error('DSH did not acknowledge the handoff prompt');
    // Admission transfers ownership to the ordinary Session. Later cancellation
    // must not turn the accepted handoff into a failure or stop the target Agent.
    progress(onProgress, 'DSH accepted the conversation handoff');
    return { ...record.metadata, ok: true, accepted: true, delivery: 'accepted' };
  }

  async function resume(input, signal = new AbortController().signal, onProgress, requestId = randomUUID()) {
    textField(requestId, 'requestId', true);
    if (requestId.length > 256) throw new Error('requestId must be at most 256 characters');
    const request = snapshotRequest(input), signature = JSON.stringify(request);
    let record = receipts.get(requestId);
    if (record) {
      if (record.signature !== signature) throw new Error('Handoff requestId is already associated with different parameters');
    } else {
      record = { id: requestId, signature, createdSession: false, failedAt: 'prepare', promptStarted: false,
        metadata: { destination: request.targetSessionId ? 'current' : 'new',
          ...(request.targetSessionId ? { sessionId: request.targetSessionId } : {}), warnings: [] } };
      receipts.set(requestId, record);
      // Record the Promise before invoking adapters, including reentrant observers.
      record.promise = Promise.resolve().then(() => perform(record, request, signal, onProgress)).catch((error) => {
        const code = typeof error?.code === 'string' ? error.code : undefined;
        if (record.failedAt === 'create-session') {
          // Native create can persist the Session before workspace attachment fails.
          for (const field of ['workspaceId', 'sessionId']) {
            const value = error?.details?.[field];
            if (typeof value === 'string' && value.trim() && value.length <= 8192 && !/[\x00-\x1f\x7f]/.test(value)) record.metadata[field] = value;
          }
          if (record.metadata.sessionId) record.createdSession = true;
        }
        const unknown = record.promptStarted && record.delivery !== 'not-accepted'
          && !['session/not-found', 'gateway/bad-request'].includes(code);
        const message = error instanceof Error ? error.message : String(error);
        return { ...record.metadata, ok: false, failedAt: record.failedAt,
          ...(code ? { code } : {}),
          ...(unknown ? { delivery: 'not-confirmed', unknown: true,
            error: `${message}. Handoff delivery could not be confirmed; check target DSH conversation ${record.metadata.sessionId} before submitting again.` }
            : { accepted: false, delivery: 'not-accepted', error: message }),
          ...(signal.aborted ? { cancelled: true } : {}),
          ...(record.createdSession || record.metadata.workspaceId ? { partial: true } : {}),
        };
      }).finally(() => {
        completed.push(requestId);
        while (completed.length > RECEIPT_HISTORY) receipts.delete(completed.shift());
      });
    }
    // Callers receive detached metadata; a UI cannot corrupt a cached receipt.
    return structuredClone(await record.promise);
  }
  return { resume };
}
