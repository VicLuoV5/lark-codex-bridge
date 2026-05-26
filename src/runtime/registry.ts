import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { paths } from '../config/paths';
import type { TenantBrand } from '../config/schema';

/**
 * Tracks running `feishu-codex-bridge run` processes so we can:
 *   - Warn on duplicate `start` of the same app (open-platform routes events
 *     to one of N long-connections randomly, leaving users guessing).
 *   - Let users list (`ps` / `/ps`) and terminate (`stop <id>` / `/exit <id>`)
 *     a specific process.
 *
 * Single-machine only — entries live in a local JSON file and processes are
 * identified by OS PID. PIDs may go stale (kill -9, crash, OS reboot); every
 * read prunes entries whose PID is not alive (`process.kill(pid, 0)` throws
 * ESRCH for dead PIDs). The file is rewritten atomically (temp + rename) to
 * avoid partial reads during concurrent updates.
 */

export interface ProcessEntry {
  /** 4-char random hex, stable for this process's lifetime. */
  id: string;
  pid: number;
  appId: string;
  tenant: TenantBrand;
  configPath: string;
  startedAt: string;
  version: string;
  /** Bot's display name (e.g. "尼莫"). Filled in by startChannel after the
   * WS handshake — undefined until the connection is up, or on processes
   * registered by older versions of the bridge. */
  botName?: string;
}

interface RegistryFile {
  entries: ProcessEntry[];
}

const EMPTY: RegistryFile = { entries: [] };

function readRaw(path: string): RegistryFile {
  try {
    const text = readFileSync(path, 'utf8');
    const parsed = JSON.parse(text) as Partial<RegistryFile>;
    if (!parsed || !Array.isArray(parsed.entries)) return { entries: [] };
    return { entries: parsed.entries.filter(isValidEntry) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { entries: [] };
    return { entries: [] };
  }
}

function isValidEntry(e: unknown): e is ProcessEntry {
  if (!e || typeof e !== 'object') return false;
  const x = e as Record<string, unknown>;
  return (
    typeof x.id === 'string' &&
    typeof x.pid === 'number' &&
    typeof x.appId === 'string' &&
    (x.tenant === 'feishu' || x.tenant === 'lark') &&
    typeof x.configPath === 'string' &&
    typeof x.startedAt === 'string' &&
    typeof x.version === 'string'
  );
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Read the registry, dropping entries whose PID is no longer alive. The
 * pruned-back state is **not** persisted here — callers that mutate write
 * the full new state via `writeAtomic`. (Read-only callers like /ps don't
 * need to bother persisting the prune.)
 */
export function readAndPrune(path: string = paths.processesFile): ProcessEntry[] {
  const raw = readRaw(path);
  return raw.entries.filter((e) => isAlive(e.pid));
}

async function writeAtomic(entries: ProcessEntry[], path: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`;
  const body = `${JSON.stringify({ entries } satisfies RegistryFile, null, 2)}\n`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tmp, body, 'utf8');
  await rename(tmp, path);
}

function writeAtomicSync(entries: ProcessEntry[], path: string): void {
  const tmp = `${path}.tmp-${process.pid}`;
  const body = `${JSON.stringify({ entries } satisfies RegistryFile, null, 2)}\n`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tmp, body, 'utf8');
  renameSync(tmp, path);
}

/** Generate a short, human-typable id. Collisions are caller's problem;
 * acceptable since dead entries are pruned and same-machine fleets are
 * small. */
export function generateShortId(): string {
  return randomBytes(2).toString('hex');
}

export interface RegisterArgs {
  appId: string;
  tenant: TenantBrand;
  configPath: string;
  version: string;
}

/**
 * Atomically prune + add this process to the registry. Returns the entry
 * representing this process (so callers can stash the id for later use, e.g.
 * "is /exit <id> me?" checks).
 *
 * Caller is responsible for installing cleanup that calls `unregister`.
 */
export async function register(args: RegisterArgs): Promise<ProcessEntry> {
  const live = readAndPrune();
  const entry: ProcessEntry = {
    id: generateShortId(),
    pid: process.pid,
    appId: args.appId,
    tenant: args.tenant,
    configPath: args.configPath,
    startedAt: new Date().toISOString(),
    version: args.version,
  };
  await writeAtomic([...live, entry], paths.processesFile);
  return entry;
}

/** Remove an entry by id. Atomic + prunes dead in same write. Async. */
export async function unregister(id: string): Promise<void> {
  const live = readAndPrune();
  const next = live.filter((e) => e.id !== id);
  if (next.length === live.length) return;
  await writeAtomic(next, paths.processesFile);
}

/**
 * Replace mutable fields on the entry identified by `id`. Used after
 * /account change so `ps` reflects the current credentials. No-op when the
 * entry has already been pruned out.
 */
export async function updateEntry(
  id: string,
  patch: Partial<Pick<ProcessEntry, 'appId' | 'tenant' | 'configPath' | 'botName'>>,
): Promise<void> {
  const live = readAndPrune();
  let changed = false;
  const next = live.map((e) => {
    if (e.id !== id) return e;
    changed = true;
    return { ...e, ...patch };
  });
  if (!changed) return;
  await writeAtomic(next, paths.processesFile);
}

/**
 * Synchronous unregister — for use inside `process.on('exit')` and other
 * sync-only contexts where async file I/O doesn't run. Best-effort.
 */
export function unregisterSync(id: string): void {
  try {
    const live = readRaw(paths.processesFile).entries.filter((e) => isAlive(e.pid));
    const next = live.filter((e) => e.id !== id);
    if (next.length === live.length) return;
    writeAtomicSync(next, paths.processesFile);
    // If we just emptied the file, also remove the temp turd if any.
  } catch {
    // exit handlers must not throw.
  }
}

/** Best-effort: try to unlink any leftover tmp file we wrote. */
export function cleanupTmpFiles(): void {
  try {
    unlinkSync(`${paths.processesFile}.tmp-${process.pid}`);
  } catch {
    /* ignore */
  }
}

/**
 * Find living entries with the same appId, excluding `excludePid` (typically
 * the caller's own pid) so a process doesn't flag itself as a conflict.
 */
export function sameAppOthers(appId: string, excludePid = process.pid): ProcessEntry[] {
  return readAndPrune().filter((e) => e.appId === appId && e.pid !== excludePid);
}

/**
 * Resolve `target` (short id OR 1-based index in the current `ps` view) to
 * an entry. Index lookup uses the same prune order as `readAndPrune()`.
 */
export function resolveTarget(target: string): ProcessEntry | undefined {
  const live = readAndPrune();
  const byId = live.find((e) => e.id === target);
  if (byId) return byId;
  const n = Number.parseInt(target, 10);
  if (Number.isFinite(n) && n >= 1 && n <= live.length) {
    return live[n - 1];
  }
  return undefined;
}
