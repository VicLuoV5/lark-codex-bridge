import type { LarkChannel } from '@larksuiteoapi/node-sdk';

export interface CreateBoundChatOptions {
  channel: LarkChannel;
  name: string;
  inviteOpenId: string;
  description?: string;
}

export interface CreatedChat {
  chatId: string;
  name: string;
}

/**
 * Create a private group chat with the bot (as creator) and one user. Returns
 * the new chat_id. Requires `im:chat` scope on the bot.
 */
export async function createBoundChat(opts: CreateBoundChatOptions): Promise<CreatedChat> {
  const { channel, name, inviteOpenId, description } = opts;
  const result = await channel.rawClient.im.v1.chat.create({
    data: {
      name,
      description,
      chat_mode: 'group',
      chat_type: 'private',
      user_id_list: [inviteOpenId],
    },
    params: {
      user_id_type: 'open_id',
    },
  });
  const chatId = (result as { data?: { chat_id?: string } }).data?.chat_id;
  if (!chatId) {
    throw new Error(`chat.create returned no chat_id: ${JSON.stringify(result).slice(0, 200)}`);
  }
  return { chatId, name };
}

export function defaultChatName(): string {
  const d = new Date();
  const pad = (n: number): string => `${n}`.padStart(2, '0');
  return `Codex · ${d.getMonth() + 1}-${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
