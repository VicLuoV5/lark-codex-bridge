import { describe, expect, it, vi } from 'vitest';
import { isInsideWorkspaceRoot } from '../src/workspace/guard';

describe('isInsideWorkspaceRoot', () => {
  const root = 'D:\\Works\\MetaPulse\\Codexwork';

  it('allows the root and its children', () => {
    expect(isInsideWorkspaceRoot(root, root)).toBe(true);
    expect(isInsideWorkspaceRoot(`${root}\\project`, root)).toBe(true);
  });

  it('rejects sibling paths with the same prefix', () => {
    expect(isInsideWorkspaceRoot('D:\\Works\\MetaPulse\\Codexwork-old', root)).toBe(false);
    expect(isInsideWorkspaceRoot('D:\\Works\\MetaPulse\\Other', root)).toBe(false);
  });

  it('defaults to the current process cwd when no workspace root env is set', async () => {
    const original = process.env.FEISHU_CODEX_WORKSPACE_ROOT;
    delete process.env.FEISHU_CODEX_WORKSPACE_ROOT;
    vi.resetModules();

    const { workspaceRoot } = await import('../src/workspace/guard');
    expect(workspaceRoot()).toBe(process.cwd());

    if (original === undefined) {
      delete process.env.FEISHU_CODEX_WORKSPACE_ROOT;
    } else {
      process.env.FEISHU_CODEX_WORKSPACE_ROOT = original;
    }
  });
});
