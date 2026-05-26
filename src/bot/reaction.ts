import type { LarkChannel } from '@larksuiteoapi/node-sdk';
import { log } from '../core/logger';

/**
 * Add a "Typing" reaction (敲键盘) to a message to give text-mode users an
 * instant "I got your message and I'm responding" cue while Codex is still
 * thinking. Matches the conventional Feishu UX for "the other side is
 * replying". Card mode doesn't need this — the streaming card already
 * shows a "正在思考…" footer the moment it's posted.
 *
 * Returns the reaction id on success, undefined on any failure. Failures
 * are logged but never thrown — losing a decoration must not break the
 * actual reply flow.
 */
export async function addWorkingReaction(
  channel: LarkChannel,
  messageId: string,
): Promise<string | undefined> {
  try {
    const r = (await channel.rawClient.im.v1.messageReaction.create({
      path: { message_id: messageId },
      data: { reaction_type: { emoji_type: 'Typing' } },
    })) as { data?: { reaction_id?: string } };
    const id = r?.data?.reaction_id;
    if (id) log.info('reaction', 'added', { messageId, reactionId: id });
    return id;
  } catch (err) {
    log.warn('reaction', 'add-failed', {
      messageId,
      err: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/** Remove a previously-added reaction. Tolerates errors silently — best
 * effort cleanup; a leftover reaction is harmless. */
export async function removeReaction(
  channel: LarkChannel,
  messageId: string,
  reactionId: string,
): Promise<void> {
  try {
    await channel.rawClient.im.v1.messageReaction.delete({
      path: { message_id: messageId, reaction_id: reactionId },
    });
    log.info('reaction', 'removed', { messageId, reactionId });
  } catch (err) {
    log.warn('reaction', 'remove-failed', {
      messageId,
      reactionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Add a "Typing" reaction to a cloud-doc comment reply. Doc comments have
 * their own reaction endpoint (`drive/v2/comment_reaction`) — separate from
 * IM message reactions, and unlike IM it doesn't return a reaction id:
 * add/delete are the same POST with an `action` field. Returns `true` if
 * the call succeeded so callers know whether to bother sending the matching
 * remove.
 */
export async function addCommentReaction(
  channel: LarkChannel,
  fileToken: string,
  fileType: string,
  replyId: string,
): Promise<boolean> {
  return commentReaction(channel, fileToken, fileType, replyId, 'add');
}

/** Remove the "Typing" reaction. Same endpoint, action=delete. */
export async function removeCommentReaction(
  channel: LarkChannel,
  fileToken: string,
  fileType: string,
  replyId: string,
): Promise<void> {
  await commentReaction(channel, fileToken, fileType, replyId, 'delete');
}

async function commentReaction(
  channel: LarkChannel,
  fileToken: string,
  fileType: string,
  replyId: string,
  action: 'add' | 'delete',
): Promise<boolean> {
  const url =
    `/open-apis/drive/v2/files/${encodeURIComponent(fileToken)}/comments/reaction` +
    `?file_type=${encodeURIComponent(fileType)}`;
  try {
    await channel.rawClient.request({
      method: 'POST',
      url,
      data: { action, reply_id: replyId, reaction_type: 'Typing' },
    });
    log.info('reaction', `comment-${action}ed`, { fileToken, replyId });
    return true;
  } catch (err) {
    log.warn('reaction', `comment-${action}-failed`, {
      fileToken,
      replyId,
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
