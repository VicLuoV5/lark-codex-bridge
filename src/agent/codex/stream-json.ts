import type { AgentEvent } from '../types';

interface CodexUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
}

interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  summary?: string;
  command?: string;
  status?: string;
  output?: string;
  error?: string;
  [key: string]: unknown;
}

interface CodexRawEvent {
  type?: string;
  thread_id?: string;
  item?: CodexItem;
  usage?: CodexUsage;
  message?: string;
  error?: string | { message?: string };
  [key: string]: unknown;
}

export function* translateCodexEvent(raw: unknown): Generator<AgentEvent> {
  if (!raw || typeof raw !== 'object') return;
  const evt = raw as CodexRawEvent;

  if (evt.type === 'thread.started') {
    yield { type: 'system', sessionId: evt.thread_id };
    return;
  }

  if (evt.type === 'item.started' && evt.item) {
    const item = evt.item;
    if (item.type === 'command_execution') {
      yield {
        type: 'tool_use',
        id: item.id ?? `cmd-${Date.now()}`,
        name: 'command',
        input: { command: item.command ?? summarizeUnknown(item) },
      };
    }
    return;
  }

  if (evt.type === 'item.completed' && evt.item) {
    yield* translateCompletedItem(evt.item);
    return;
  }

  if (evt.type === 'turn.completed') {
    if (evt.usage) {
      yield {
        type: 'usage',
        inputTokens: evt.usage.input_tokens ?? evt.usage.total_input_tokens,
        outputTokens: evt.usage.output_tokens ?? evt.usage.total_output_tokens,
      };
    }
    yield { type: 'done', sessionId: evt.thread_id };
    return;
  }

  if (evt.type === 'turn.failed' || evt.type === 'error') {
    yield { type: 'error', message: eventErrorMessage(evt.error, evt.message) };
  }
}

function* translateCompletedItem(item: CodexItem): Generator<AgentEvent> {
  if (item.type === 'agent_message') {
    const text = extractText(item);
    if (text) yield { type: 'text', delta: text };
    return;
  }

  if (item.type === 'reasoning') {
    const text = extractText(item);
    if (text) yield { type: 'thinking', delta: text };
    return;
  }

  if (item.type === 'command_execution') {
    yield {
      type: 'tool_result',
      id: item.id ?? `cmd-${Date.now()}`,
      output: item.output ?? item.error ?? summarizeUnknown(item),
      isError: Boolean(item.error) || item.status === 'failed',
    };
    return;
  }

  if (item.type === 'file_change') {
    yield {
      type: 'tool_result',
      id: item.id ?? `file-${Date.now()}`,
      output: summarizeUnknown(item),
      isError: false,
    };
  }
}

function extractText(item: CodexItem): string {
  if (typeof item.text === 'string') return item.text;
  if (typeof item.summary === 'string') return item.summary;
  const content = item.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const maybe = part as { text?: unknown; content?: unknown };
          if (typeof maybe.text === 'string') return maybe.text;
          if (typeof maybe.content === 'string') return maybe.content;
        }
        return '';
      })
      .filter(Boolean)
      .join('');
  }
  return '';
}

function eventErrorMessage(error: CodexRawEvent['error'], message?: string): string {
  if (typeof message === 'string' && message.trim()) return message;
  if (typeof error === 'string') return error;
  if (error && typeof error.message === 'string') return error.message;
  return 'codex run failed';
}

function summarizeUnknown(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
