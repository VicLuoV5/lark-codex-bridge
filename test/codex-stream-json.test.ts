import { describe, expect, it } from 'vitest';
import { translateCodexEvent } from '../src/agent/codex/stream-json';

describe('translateCodexEvent', () => {
  it('translates Codex JSONL lifecycle and message events', () => {
    expect([...translateCodexEvent({
      type: 'thread.started',
      thread_id: 'thread-1',
    })]).toEqual([{ type: 'system', sessionId: 'thread-1' }]);

    expect([...translateCodexEvent({
      type: 'item.completed',
      item: { id: 'item-1', type: 'agent_message', text: 'OK' },
    })]).toEqual([{ type: 'text', delta: 'OK' }]);

    expect([...translateCodexEvent({
      type: 'turn.completed',
      usage: { input_tokens: 3, output_tokens: 5 },
    })]).toEqual([
      { type: 'usage', inputTokens: 3, outputTokens: 5 },
      { type: 'done', sessionId: undefined },
    ]);
  });

  it('translates command execution events', () => {
    expect([...translateCodexEvent({
      type: 'item.started',
      item: { id: 'cmd-1', type: 'command_execution', command: 'git status' },
    })]).toEqual([
      { type: 'tool_use', id: 'cmd-1', name: 'command', input: { command: 'git status' } },
    ]);

    expect([...translateCodexEvent({
      type: 'item.completed',
      item: { id: 'cmd-1', type: 'command_execution', output: 'clean', status: 'completed' },
    })]).toEqual([
      { type: 'tool_result', id: 'cmd-1', output: 'clean', isError: false },
    ]);
  });

  it('preserves Codex top-level error messages', () => {
    expect([...translateCodexEvent({
      type: 'error',
      message: 'network failed',
    })]).toEqual([
      { type: 'error', message: 'network failed' },
    ]);
  });
});
