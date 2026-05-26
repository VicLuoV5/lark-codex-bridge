import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, normalize } from 'node:path';
import { createInterface } from 'node:readline';

export interface SessionSummary {
  sessionId: string;
  mtime: number;
  preview: string;
  lineCount: number;
}

function codexHome(): string {
  return process.env.CODEX_HOME ?? join(homedir(), '.codex');
}

/** Return the most recent `limit` Codex jsonl sessions for the given cwd, newest first. */
export async function listRecentSessions(cwd: string, limit = 5): Promise<SessionSummary[]> {
  const dir = join(codexHome(), 'sessions');
  let files: string[];
  try {
    files = await collectJsonlFiles(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const withStats = await Promise.all(
    files.map(async (path) => {
      try {
        const st = await stat(path);
        return { path, mtime: st.mtimeMs };
      } catch {
        return null;
      }
    }),
  );

  const sorted = withStats
    .filter((x): x is { path: string; mtime: number } => x !== null)
    .sort((a, b) => b.mtime - a.mtime);

  const out: SessionSummary[] = [];
  for (const entry of sorted) {
    const sessionId = sessionIdFromPath(entry.path);
    if (!sessionId) continue;
    const summary = await summarize(entry.path);
    if (summary.cwd && normalize(summary.cwd).toLowerCase() !== normalize(cwd).toLowerCase()) {
      continue;
    }
    out.push({
      sessionId,
      mtime: entry.mtime,
      preview: summary.preview,
      lineCount: summary.lineCount,
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function collectJsonlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectJsonlFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(path);
    }
  }
  return files;
}

function sessionIdFromPath(path: string): string | undefined {
  const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(path);
  return m?.[1];
}

async function summarize(path: string): Promise<{ preview: string; lineCount: number; cwd?: string }> {
  const stream = createReadStream(path, { encoding: 'utf8' });
  const rl = createInterface({ input: stream });
  let preview = '';
  let cwd: string | undefined;
  let lineCount = 0;
  try {
    for await (const line of rl) {
      lineCount++;
      try {
        const obj = JSON.parse(line) as {
          type?: string;
          payload?: { cwd?: unknown; type?: unknown; message?: unknown };
        };
        if (!cwd && obj.type === 'turn_context' && typeof obj.payload?.cwd === 'string') {
          cwd = obj.payload.cwd;
        }
        if (
          !preview &&
          obj.type === 'event_msg' &&
          obj.payload?.type === 'user_message' &&
          typeof obj.payload.message === 'string'
        ) {
          const text = obj.payload.message.trim();
          if (text) preview = text.slice(0, 80);
        }
      } catch {
        /* malformed line */
      }
      // reading the whole file is fine — sessions are usually under 10k lines
      if (lineCount > 20_000) break;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return { preview: preview || '(空会话)', lineCount, cwd };
}

/** Format a relative time like "3 小时前", "昨天", "3 天前". */
export function formatRelTime(mtime: number): string {
  const diffMs = Date.now() - mtime;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return '昨天';
  if (day < 30) return `${day} 天前`;
  const mo = Math.floor(day / 30);
  return `${mo} 个月前`;
}
