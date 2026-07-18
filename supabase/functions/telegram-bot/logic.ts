// Pure helpers for the telegram-bot edge function — kept import-free so
// logic.test.ts runs without network access (same pattern as expo-push/copy.ts).

export type BotCommand = 'today' | 'week' | 'help';

export const HELP_TEXT = 'Sharm Eats ops bot\n/today — today’s orders & revenue\n/week — last 7 days';

// First token of the message, lowercased, with any @botname suffix stripped
// (Telegram appends it in groups: "/today@malawany_bot"). Unknown or absent
// commands map to null so the caller can decide between help and silence.
export function parseCommand(text: string | undefined | null): BotCommand | null {
  if (!text) return null;
  const first = text.trim().split(/\s+/)[0].toLowerCase().replace(/@[a-z0-9_]+$/, '');
  switch (first) {
    case '/today':
      return 'today';
    case '/week':
      return 'week';
    case '/start':
    case '/help':
      return 'help';
    default:
      return null;
  }
}

// Telegram allows answering the webhook POST with a bot API method call —
// zero outbound HTTP and the bot token never enters this function.
export function sendMessageReply(chatId: number | string, text: string): Record<string, unknown> {
  return { method: 'sendMessage', chat_id: chatId, text };
}
