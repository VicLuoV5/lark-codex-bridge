/**
 * SDK's `convertInteractive` flattens an interactive card by walking the
 * JSON tree (`walkCard`) and pulling text-bearing nodes. Three failure
 * modes we paper over here:
 *
 *   1. CardKit 2.0 webhook dual-publish. Feishu pushes v2 cards in webhook
 *      events as JSON with BOTH:
 *        - `elements`: a v1-shaped "请升级至最新版本客户端" fallback so
 *          older clients/SDKs aren't broken.
 *        - `user_dsl`: a JSON string containing the real schema 2.0 card.
 *      SDK only walks `elements`, so without intervention Codex sees the
 *      "please upgrade" downgrade. We pull `user_dsl` when present.
 *
 *   2. CardKit 2.0 API response. When `im.v1.message.get` is called with
 *      `card_msg_content_type=user_card_content` (SDK ≥ 1.65), the
 *      response's `body.content` IS the schema 2.0 DSL itself
 *      (`{schema:"2.0", body, config, header}`) — not wrapped in
 *      `user_dsl`. We detect by `schema:"2.0"` and inject as-is.
 *
 *   3. Zero-text v1 cards. Button-only / image-only / decorative cards
 *      have no text-bearing nodes; SDK collapses to the literal placeholder
 *      `[interactive card]` (lib/index.js:88951,88955). We fall back to the
 *      raw JSON so Codex can see the card structure.
 *
 * All branches wrap output in an `<interactive_card>` block. Codex is
 * taught in BRIDGE_SYSTEM_PROMPT not to echo the XML tag back to the user.
 */
export const INTERACTIVE_CARD_PLACEHOLDER = '[interactive card]';

export function expandInteractiveCard(
  flattenedContent: string,
  rawJsonContent: string | undefined,
): string {
  if (!rawJsonContent) return flattenedContent;

  const parsed = tryParseJson(rawJsonContent);

  // Branch 1: webhook v2 — `user_dsl` nested as a string. Prefer it over
  // `elements` (which would be the upgrade-fallback).
  if (parsed && typeof parsed.user_dsl === 'string' && parsed.user_dsl.trim().length > 0) {
    return `<interactive_card>\n${parsed.user_dsl}\n</interactive_card>`;
  }

  // Branch 2: API v2 — raw content already IS the schema 2.0 DSL.
  if (parsed && parsed.schema === '2.0') {
    return `<interactive_card>\n${rawJsonContent}\n</interactive_card>`;
  }

  // Branch 3: SDK collapsed a v1 card to placeholder (zero text-bearing
  // nodes). Substitute raw JSON so Codex can see the structure.
  if (flattenedContent === INTERACTIVE_CARD_PLACEHOLDER) {
    return `<interactive_card>\n${rawJsonContent}\n</interactive_card>`;
  }

  return flattenedContent;
}

function tryParseJson(s: string): { user_dsl?: unknown; schema?: unknown } | undefined {
  try {
    return JSON.parse(s) as { user_dsl?: unknown; schema?: unknown };
  } catch {
    return undefined;
  }
}
