import { describe, expect, it } from 'vitest';
import { buildArgs } from '../src/agent/codex/adapter';
import {
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
});
