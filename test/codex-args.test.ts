import { describe, expect, it } from 'vitest';
import { buildArgs, extraSandboxDirsForPermissionMode } from '../src/agent/codex/adapter';
import {
  getCodexPermissionMode,
  getCodexReasoningEffort,
  type AppConfig,
} from '../src/config/schema';

describe('Codex run options', () => {
  it('passes configured reasoning effort to codex exec', () => {
    const args = buildArgs({
      prompt: 'hi',
      reasoningEffort: 'high',
    });

    expect(args).toContain('-c');
    expect(args).toContain('model_reasoning_effort="high"');
  });

  it('ignores unsupported reasoning effort values in config', () => {
    const cfg = {
      accounts: {
        app: { id: 'cli_test', secret: 'secret', tenant: 'feishu' },
      },
      preferences: {
        codexReasoningEffort: 'loud',
      },
    } as unknown as AppConfig;

    expect(getCodexReasoningEffort(cfg)).toBeUndefined();
  });

  it('uses configured permission mode to allow workspace writes', () => {
    const cfg = {
      accounts: {
        app: { id: 'cli_test', secret: 'secret', tenant: 'feishu' },
      },
      preferences: {
        codexPermissionMode: 'acceptEdits',
      },
    } as unknown as AppConfig;

    const args = buildArgs({
      prompt: 'create a folder',
      permissionMode: getCodexPermissionMode(cfg),
    });

    expect(args).toContain('--sandbox');
    expect(args).toContain('workspace-write');
  });

  it('does not expose the user npm bin directly for editable runs', () => {
    expect(
      extraSandboxDirsForPermissionMode(
        'acceptEdits',
        { APPDATA: 'C:\\Users\\Me\\AppData\\Roaming' },
        'win32',
      ),
    ).toEqual([]);
  });

  it('adds runtime tool shims to the Codex sandbox when provided', () => {
    const args = buildArgs(
      {
        prompt: 'hi',
        permissionMode: 'acceptEdits',
      },
      ['D:\\workspace\\.feishu-codex-bridge-tools'],
    );

    expect(args).toContain('--add-dir');
    expect(args).toContain('D:\\workspace\\.feishu-codex-bridge-tools');
  });

  it('maps bypass permission mode to Codex danger-full-access', () => {
    const args = buildArgs({
      prompt: 'hi',
      permissionMode: 'bypassPermissions',
    });

    expect(args).toContain('--sandbox');
    expect(args).toContain('danger-full-access');
    expect(args).not.toContain('--add-dir');
  });
});
