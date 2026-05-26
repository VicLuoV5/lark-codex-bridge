import { mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { legacyPaths, paths } from '../../config/paths';
import { isComplete, type AppCredentials, type AppConfig } from '../../config/schema';
import { saveConfig } from '../../config/store';

export interface MigrateOptions {
  config?: string;
}

interface LegacyShape {
  app?: AppCredentials;
}

/**
 * One-shot migrator for two pre-0.1.11 changes:
 *
 *  1. Path: ~/.config/lark-channel-bridge/ + ~/.cache/lark-channel-bridge/
 *     → ~/.feishu-codex-bridge/
 *  2. Shape: { app: {...} } → { accounts: { app: {...} } }
 *
 * Idempotent — running on an already-migrated setup is a no-op.
 */
export async function runMigrate(opts: MigrateOptions): Promise<void> {
  await migrateLegacyPaths();
  await migrateConfigShape(opts.config ?? paths.configFile);
}

async function migrateLegacyPaths(): Promise<void> {
  const legacyConfig = await pathExists(legacyPaths.appDir);
  const legacyCache = await pathExists(legacyPaths.cacheDir);

  if (!legacyConfig && !legacyCache) return;

  await mkdir(paths.appDir, { recursive: true });

  if (legacyConfig) {
    await moveDirContents(legacyPaths.appDir, paths.appDir);
    await rmIfEmpty(legacyPaths.appDir);
    console.log(`✓ 已搬迁配置：${legacyPaths.appDir} → ${paths.appDir}`);
  }
  if (legacyCache) {
    // Move media subdirectory if present.
    const legacyMedia = join(legacyPaths.cacheDir, 'media');
    if (await pathExists(legacyMedia)) {
      await moveDirContents(legacyMedia, paths.mediaDir);
      await rmIfEmpty(legacyMedia);
    }
    // Move anything else at the top level too.
    await moveDirContents(legacyPaths.cacheDir, paths.appDir);
    await rmIfEmpty(legacyPaths.cacheDir);
    console.log(`✓ 已搬迁缓存：${legacyPaths.cacheDir} → ${paths.appDir}`);
  }
}

async function migrateConfigShape(path: string): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log('  config.json 不存在，跳过结构迁移');
      return;
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`✗ config 不是合法 JSON (${path}):`, err);
    process.exit(1);
  }

  const obj = parsed as Partial<AppConfig> & LegacyShape;

  if (isComplete(obj)) {
    console.log(`✓ config 结构已是新格式：${path}`);
    return;
  }

  if (obj.app?.id && obj.app.secret && obj.app.tenant) {
    const next: AppConfig = { accounts: { app: obj.app } };
    await saveConfig(next, path);
    console.log(`✓ 已升级 config 结构：${path}`);
    console.log('  { app: ... } → { accounts: { app: ... } }');
    return;
  }

  console.error(`✗ 无法识别的 config 格式：${path}`);
  console.error('  期望 { app: { id, secret, tenant } } 或 { accounts: { app: ... } }');
  process.exit(1);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function moveDirContents(from: string, to: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(from);
  } catch {
    return;
  }
  await mkdir(to, { recursive: true });
  for (const name of entries) {
    const src = join(from, name);
    const dst = join(to, name);
    if (await pathExists(dst)) {
      console.log(`  · 跳过 ${name}（目标已存在）`);
      continue;
    }
    await rename(src, dst);
  }
}

async function rmIfEmpty(p: string): Promise<void> {
  try {
    const remaining = await readdir(p);
    if (remaining.length === 0) await rm(p, { recursive: false });
  } catch {
    /* best effort */
  }
}
