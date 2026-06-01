import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface LarkCliShim {
  toolsDir: string;
  commandPath: string;
}

interface LarkCliInstall {
  exePath: string;
  version?: string;
}

interface LarkCliShimManifest {
  package: '@larksuite/cli';
  version: string | null;
  source: string;
  sourceSize: number;
  sourceMtimeMs: number;
  copiedSize: number;
  copiedMtimeMs: number;
  updatedAt: string;
}

export function ensureLarkCliShim(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): LarkCliShim | undefined {
  if (platform !== 'win32') return undefined;

  const install = findLarkCliInstall(env);
  if (!install) return undefined;

  const toolsDir = join(root, '.feishu-codex-bridge-tools');
  const targetExe = join(toolsDir, 'lark-cli.exe');
  const targetCmd = join(toolsDir, 'lark-cli.cmd');
  const manifestPath = join(toolsDir, 'manifest.json');
  mkdirSync(toolsDir, { recursive: true });
  syncExe(install, targetExe, manifestPath);
  writeFileSync(targetCmd, '@echo off\r\n"%~dp0lark-cli.exe" %*\r\n', 'ascii');
  writeManifest(install, targetExe, manifestPath);
  return { toolsDir, commandPath: targetCmd };
}

function findLarkCliInstall(env: NodeJS.ProcessEnv): LarkCliInstall | undefined {
  const explicit = env.FEISHU_CODEX_LARK_CLI_EXE;
  if (explicit && existsSync(explicit)) {
    return { exePath: explicit, version: env.FEISHU_CODEX_LARK_CLI_VERSION };
  }

  const appData = trimTrailingSlashes(env.APPDATA);
  if (!appData) return undefined;
  const packageDir = join(appData, 'npm', 'node_modules', '@larksuite', 'cli');
  const exePath = join(packageDir, 'bin', 'lark-cli.exe');
  return existsSync(exePath)
    ? { exePath, version: readPackageVersion(join(packageDir, 'package.json')) }
    : undefined;
}

function syncExe(install: LarkCliInstall, target: string, manifestPath: string): void {
  if (!shouldCopy(install, target, manifestPath)) return;
  copyFileSync(install.exePath, target);
}

function shouldCopy(install: LarkCliInstall, target: string, manifestPath: string): boolean {
  if (!existsSync(target)) return true;

  const src = statSync(install.exePath);
  const dst = statSync(target);
  const manifest = readManifest(manifestPath);
  if (!manifest) return true;
  if (manifest.source !== install.exePath) return true;
  if ((manifest.version ?? undefined) !== install.version) return true;
  if (manifest.sourceSize !== src.size) return true;
  if (manifest.sourceMtimeMs !== Math.floor(src.mtimeMs)) return true;
  return src.size !== dst.size || Math.floor(src.mtimeMs) > Math.floor(dst.mtimeMs);
}

function writeManifest(install: LarkCliInstall, target: string, manifestPath: string): void {
  const sourceStat = statSync(install.exePath);
  const targetStat = statSync(target);
  const manifest: LarkCliShimManifest = {
    package: '@larksuite/cli',
    version: install.version ?? null,
    source: install.exePath,
    sourceSize: sourceStat.size,
    sourceMtimeMs: Math.floor(sourceStat.mtimeMs),
    copiedSize: targetStat.size,
    copiedMtimeMs: Math.floor(targetStat.mtimeMs),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function readManifest(path: string): LarkCliShimManifest | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<LarkCliShimManifest>;
    if (parsed.package !== '@larksuite/cli') return undefined;
    return parsed as LarkCliShimManifest;
  } catch {
    return undefined;
  }
}

function readPackageVersion(path: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

function trimTrailingSlashes(value: string | undefined): string {
  return value?.replace(/[\\/]+$/, '') ?? '';
}
