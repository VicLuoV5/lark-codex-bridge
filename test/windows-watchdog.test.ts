import { describe, expect, it } from 'vitest';
import { buildLauncherCmd } from '../src/daemon/schtasks';

describe('Windows daemon launcher', () => {
  it('restarts crashed bridge runs after a 60 second watchdog delay', () => {
    const script = buildLauncherCmd({
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      bridgeEntryPath: 'D:\\bridge\\bin\\feishu-codex-bridge.mjs',
      envPath: 'C:\\Windows\\System32',
    });

    expect(script).toContain(':watchdog');
    expect(script).toContain('timeout /t 60 /nobreak');
    expect(script).toContain('goto watchdog');
  });

  it('does not restart when the bridge exits cleanly', () => {
    const script = buildLauncherCmd({
      nodePath: 'C:\\node.exe',
      bridgeEntryPath: 'D:\\bridge\\bin\\feishu-codex-bridge.mjs',
      envPath: 'C:\\Windows\\System32',
    });

    expect(script).toContain('if "%BRIDGE_EXIT_CODE%"=="0" exit /b 0');
  });
});
