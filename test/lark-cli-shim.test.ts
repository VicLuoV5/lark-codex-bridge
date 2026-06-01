import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureLarkCliShim } from '../src/runtime/lark-cli-shim';

describe('lark-cli workspace shim', () => {
  it('copies the lark-cli exe and creates a workspace-local cmd wrapper', () => {
    const temp = mkdtempSync(join(tmpdir(), 'lark-cli-shim-'));
    try {
      const source = join(temp, 'source.exe');
      writeFileSync(source, 'fake exe');

      const shim = ensureLarkCliShim(
        join(temp, 'workspace'),
        { FEISHU_CODEX_LARK_CLI_EXE: source },
        'win32',
      );

      expect(shim?.toolsDir).toBe(join(temp, 'workspace', '.feishu-codex-bridge-tools'));
      expect(shim?.commandPath).toBe(join(temp, 'workspace', '.feishu-codex-bridge-tools', 'lark-cli.cmd'));
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('writes a manifest with the installed lark-cli version', () => {
    const temp = mkdtempSync(join(tmpdir(), 'lark-cli-shim-'));
    try {
      const appData = createGlobalLarkCli(temp, '1.0.28', 'fake exe');

      const shim = ensureLarkCliShim(
        join(temp, 'workspace'),
        { APPDATA: appData },
        'win32',
      );

      const manifest = JSON.parse(
        readFileSync(join(shim!.toolsDir, 'manifest.json'), 'utf8'),
      ) as { package: string; version: string; source: string };
      expect(manifest.package).toBe('@larksuite/cli');
      expect(manifest.version).toBe('1.0.28');
      expect(manifest.source).toContain('lark-cli.exe');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('refreshes the workspace shim when the global package version changes', () => {
    const temp = mkdtempSync(join(tmpdir(), 'lark-cli-shim-'));
    try {
      const appData = createGlobalLarkCli(temp, '1.0.28', 'old111');
      const workspace = join(temp, 'workspace');

      const first = ensureLarkCliShim(workspace, { APPDATA: appData }, 'win32');
      const targetExe = join(first!.toolsDir, 'lark-cli.exe');
      const targetStat = statSync(targetExe);

      createGlobalLarkCli(temp, '1.0.29', 'new222');
      const sourceExe = join(appData, 'npm', 'node_modules', '@larksuite', 'cli', 'bin', 'lark-cli.exe');
      utimesSync(sourceExe, new Date(targetStat.atimeMs - 10_000), new Date(targetStat.mtimeMs - 10_000));

      ensureLarkCliShim(workspace, { APPDATA: appData }, 'win32');

      expect(readFileSync(targetExe, 'utf8')).toBe('new222');
      const manifest = JSON.parse(
        readFileSync(join(first!.toolsDir, 'manifest.json'), 'utf8'),
      ) as { version: string };
      expect(manifest.version).toBe('1.0.29');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('returns undefined when no Windows lark-cli exe is available', () => {
    const temp = mkdtempSync(join(tmpdir(), 'lark-cli-shim-'));
    try {
      expect(ensureLarkCliShim(join(temp, 'workspace'), {}, 'win32')).toBeUndefined();
      expect(ensureLarkCliShim(join(temp, 'workspace'), {}, 'linux')).toBeUndefined();
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});

function createGlobalLarkCli(root: string, version: string, exeContent: string): string {
  const appData = join(root, 'AppData', 'Roaming');
  const packageDir = join(appData, 'npm', 'node_modules', '@larksuite', 'cli');
  mkdirSync(join(packageDir, 'bin'), { recursive: true });
  writeFileSync(join(packageDir, 'bin', 'lark-cli.exe'), exeContent);
  writeFileSync(
    join(packageDir, 'package.json'),
    JSON.stringify({ name: '@larksuite/cli', version }, null, 2),
  );
  return appData;
}
