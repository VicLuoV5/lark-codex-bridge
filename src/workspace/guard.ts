import { isAbsolute, normalize, resolve } from 'node:path';

export function workspaceRoot(): string {
  return normalize(process.env.FEISHU_CODEX_WORKSPACE_ROOT ?? process.cwd());
}

export function resolveWorkspacePath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return workspaceRoot();
  return normalize(isAbsolute(trimmed) ? trimmed : resolve(workspaceRoot(), trimmed));
}

export function isInsideWorkspaceRoot(path: string, root = workspaceRoot()): boolean {
  const normalizedPath = normalize(path);
  const normalizedRoot = normalize(root);
  const rootWithSep = normalizedRoot.endsWith('\\') || normalizedRoot.endsWith('/')
    ? normalizedRoot
    : `${normalizedRoot}\\`;
  const lowerPath = normalizedPath.toLowerCase();
  const lowerRoot = normalizedRoot.toLowerCase();
  const lowerRootWithSep = rootWithSep.toLowerCase();
  return lowerPath === lowerRoot || lowerPath.startsWith(lowerRootWithSep);
}
