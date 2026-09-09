export function captureKind(text: string) {
  if (/^\/?후기(?=\s|$)/u.test(text)) return "review";
  if (/^\/?썸네일기록(?=\s|$)/u.test(text)) return "thumbnail";
  if (/^#raw(?=\s|$)/iu.test(text)) return "raw";
  if (/^[/#]?인박스(?=\s|$)/u.test(text)) return "inbox";
  if (/^\/?요약(?=\s|$)/u.test(text)) return "summary";
  return "question";
}

export function isBotAddressed(message: { chat: { type: string }; text?: string; caption?: string; reply_to_message?: { from?: { is_bot?: boolean; username?: string } } }, configuredUsername: string | undefined) {
  if (message.chat.type === "private") return true;
  const username = configuredUsername?.replace(/^@/, "").toLowerCase();
  if (!username) return false;
  const mentions = (message.text ?? message.caption ?? "").match(/@[A-Za-z0-9_]+/g) ?? [];
  return mentions.some((mention) => mention.slice(1).toLowerCase() === username)
    || Boolean(message.reply_to_message?.from?.is_bot && message.reply_to_message.from.username?.toLowerCase() === username);
}
