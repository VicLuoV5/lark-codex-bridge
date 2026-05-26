import type { ChildProcessByStdio } from 'node:child_process';
import { spawn, type SpawnOptions } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { log } from '../../core/logger';
import { workspaceRoot } from '../../workspace/guard';
import type { AgentAdapter, AgentEvent, AgentRun, AgentRunOptions } from '../types';
import { translateCodexEvent } from './stream-json';

export interface CodexAdapterOptions {
  binary?: string;
}

type CodexChild = ChildProcessByStdio<Writable, Readable, Readable>;

const BRIDGE_PROMPT = `# feishu-codex-bridge 运行约定

你正在 feishu-codex-bridge 里运行：飞书/Lark 用户消息会被桥接到本地 Codex。

## bridge_context
每条 user message 顶部可能带一个 <bridge_context> 块，包含 chat_id、chat_type、sender_id、sender_name、thread_id。
这些是 bridge 注入的元数据，不要照抄到回复里；只在需要判断上下文、私聊/群聊、回调对象时使用。

## quoted_message
如果用户引用回复某条消息，bridge 会注入 <quoted_message> 块。用户真正的问题在它之后；回答时围绕被引用内容和后续问题展开。

## interactive_card
如果消息来自交互卡片，bridge 可能注入 <interactive_card> JSON。解析它来理解按钮、字段、布局，不要把 XML 标签原样回复给用户。

## 发交互卡片的回调约定
你想发一张可交互的卡片让用户点选时：

1. 用 lark-cli 把卡发到 bridge_context.chat_id。
2. 卡片用 CardKit 2.0 schema。
3. 如果希望用户点按钮后回调到你，同一按钮的 value 对象必须包含 "__codex_cb": true。
4. 用户点击后，bridge 会把 payload 去掉 "__codex_cb" 后作为 "[card-click] {...}" 消息发回给你；你的 session 会自动续上。
5. 只是展示卡片时，不要加 "__codex_cb"。

示例按钮：
\`\`\`json
{
  "tag": "button",
  "text": { "tag": "plain_text", "content": "方案 A" },
  "behaviors": [{
    "type": "callback",
    "value": { "__codex_cb": true, "choice": "a" }
  }]
}
\`\`\`

## 飞书工具约定
如果你需要操作飞书文档、表格、日历、消息等，优先使用本机已经配置的 lark-cli，并遵守当前项目和全局 AGENTS 规则。
涉及授权登录时，只能在私聊里引导用户完成，不能把授权链接发到群里。

## 安全边界
默认只在工作根目录内操作文件。除非用户明确要求且权限机制允许，不要访问或修改根目录外的路径。
`;

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex';
  readonly displayName = 'Codex';
  private readonly binary: string;

  constructor(opts: CodexAdapterOptions = {}) {
    this.binary = opts.binary ?? process.env.CODEX_BIN ?? 'codex';
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawnCodex(this.binary, ['--version'], {
        stdio: 'ignore',
      });
      child.on('error', () => resolve(false));
      child.on('exit', (code) => resolve(code === 0));
    });
  }

  run(opts: AgentRunOptions): AgentRun {
    const cwd = opts.cwd ?? workspaceRoot();
    const args = buildArgs(opts);
    const child = spawnCodex(this.binary, args, {
      cwd,
      env: { ...process.env, FEISHU_CODEX_BRIDGE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.end(`${promptFor(opts)}\n`);

    log.info('agent', 'spawn', {
      pid: child.pid ?? null,
      cwd,
      hasSession: Boolean(opts.sessionId),
      promptChars: opts.prompt.length,
      model: opts.model,
      reasoningEffort: opts.reasoningEffort,
      binary: this.binary,
    });

    const stderrChunks: Buffer[] = [];
    let stderrBuffer = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      stderrBuffer += chunk.toString('utf8');
      let nl = stderrBuffer.indexOf('\n');
      while (nl !== -1) {
        const line = stderrBuffer.slice(0, nl);
        stderrBuffer = stderrBuffer.slice(nl + 1);
        if (line.trim()) log.warn('agent', 'stderr', { line });
        nl = stderrBuffer.indexOf('\n');
      }
    });

    let runtimeError: Error | null = null;
    child.on('error', (err) => {
      runtimeError = err;
    });
    child.on('exit', (code, signal) => {
      log.info('agent', 'exit', { pid: child.pid ?? null, code, signal });
    });

    const stopGraceMs = opts.stopGraceMs ?? 5000;
    return {
      events: createEventStream(child, stderrChunks, () => runtimeError),
      async stop() {
        if (child.exitCode !== null || child.signalCode !== null) return;
        log.info('agent', 'stop-sigterm', { pid: child.pid ?? null, graceMs: stopGraceMs });
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
              log.warn('agent', 'stop-sigkill', {
                pid: child.pid ?? null,
                graceMs: stopGraceMs,
                reason: 'grace-period-expired',
              });
              child.kill('SIGKILL');
            }
            resolve();
          }, stopGraceMs);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      },
      waitForExit(timeoutMs: number): Promise<boolean> {
        if (child.exitCode !== null || child.signalCode !== null) {
          return Promise.resolve(true);
        }
        return new Promise((resolve) => {
          const onExit = (): void => {
            clearTimeout(timer);
            resolve(true);
          };
          const timer = setTimeout(() => {
            child.removeListener('exit', onExit);
            resolve(false);
          }, timeoutMs);
          child.once('exit', onExit);
        });
      },
    };
  }
}

function spawnCodex(
  binary: string,
  args: string[],
  options: SpawnOptions,
): CodexChild {
  if (process.platform !== 'win32') {
    return spawn(binary, args, options) as CodexChild;
  }
  const command = [binary, ...args].map(quoteCmdArg).join(' ');
  return spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command], {
    ...options,
    windowsHide: true,
  }) as CodexChild;
}

function quoteCmdArg(arg: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(arg)) return arg;
  return `"${arg.replace(/(["^&|<>()%])/g, '^$1')}"`;
}

export function buildArgs(opts: AgentRunOptions): string[] {
  const sandbox = sandboxForPermissionMode(opts.permissionMode);
  const base = [
    'exec',
    '--json',
    '--sandbox',
    sandbox,
    '--skip-git-repo-check',
  ];
  if (opts.model) base.push('--model', opts.model);
  if (opts.reasoningEffort) {
    base.push('-c', `model_reasoning_effort="${opts.reasoningEffort}"`);
  }
  if (opts.sessionId) {
    base.push('resume', opts.sessionId, '-');
  } else {
    base.push('-');
  }
  return base;
}

function promptFor(opts: AgentRunOptions): string {
  return `${BRIDGE_PROMPT}\n\n${opts.prompt}`;
}

function sandboxForPermissionMode(mode: AgentRunOptions['permissionMode']): string {
  if (mode === 'acceptEdits' || mode === 'bypassPermissions') return 'workspace-write';
  return 'read-only';
}

async function* createEventStream(
  child: CodexChild,
  stderrChunks: Buffer[],
  getError: () => Error | null,
): AsyncGenerator<AgentEvent> {
  if (!child.pid) {
    const err = getError();
    yield {
      type: 'error',
      message: err ? `failed to spawn codex: ${err.message}` : 'spawn returned no pid',
    };
    return;
  }

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      yield* translateCodexEvent(parsed);
    }
  } finally {
    rl.close();
  }

  const exitCode = await new Promise<number | null>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(child.exitCode);
    } else {
      child.once('exit', (code) => resolve(code));
    }
  });
  const runtimeError = getError();
  if (exitCode !== 0 && exitCode !== null) {
    const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
    const detail = stderr ? `: ${stderr.slice(0, 500)}` : '';
    yield { type: 'error', message: `codex exited with code ${exitCode}${detail}` };
  } else if (runtimeError) {
    yield { type: 'error', message: `codex runtime error: ${runtimeError.message}` };
  }
}
