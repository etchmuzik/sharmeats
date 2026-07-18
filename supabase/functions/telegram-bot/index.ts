// Supabase Edge Function — Telegram ops bot webhook (Sharm Eats).
//
// Telegram POSTs message updates here (setWebhook). Answers /today and /week
// with stats from the ops_stats_text RPC [mig 118]. Replies ride the webhook
// HTTP response itself ({"method":"sendMessage",...}) — no outbound calls and
// the bot token never enters this function.
//
// AUTH (two layers, both required):
//   1. X-Telegram-Bot-Api-Secret-Token header must equal
//      platform_settings.telegram_webhook_secret (random, set at deploy time
//      via SQL; passed to setWebhook as secret_token). Proves the POST came
//      from Telegram delivering OUR webhook — without it, anyone could POST a
//      forged update and read revenue stats off the response body.
//   2. The sender chat must equal platform_settings.ops_alert_telegram_chat_id
//      (the owner's chat) — anyone else messaging the bot is ignored silently.
//
// Non-OK outcomes return 200 with an empty body wherever safe: Telegram
// retries non-2xx deliveries, and a retry storm is worse than a dropped
// update for an ops bot.
//
// Deploy:
//   supabase functions deploy telegram-bot --no-verify-jwt --project-ref <REF>
//   (--no-verify-jwt required: Telegram sends no Supabase JWT; auth is the
//   secret-token header above, same pattern as paymob-webhook.)
// Register the webhook (once, token + secret stay out of the repo):
//   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
//     -d url=https://<REF>.supabase.co/functions/v1/telegram-bot \
//     -d secret_token=<SECRET> -d allowed_updates='["message"]'

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { HELP_TEXT, parseCommand, sendMessageReply } from './logic.ts';

interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id?: number | string };
  };
}

interface BotConfig {
  secret: string;
  ownerChat: string;
  fetchedAt: number;
}

// Module-scope cache: edge isolates persist across requests, so this caps the
// pre-auth DB cost of an unauthenticated flood at one settings read per minute
// per isolate (review finding — paymob keeps its secret in an env var for the
// same reason; here the TTL also picks up secret rotation within a minute).
let cachedConfig: BotConfig | null = null;
const CONFIG_TTL_MS = 60_000;

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    if (!cachedConfig || Date.now() - cachedConfig.fetchedAt > CONFIG_TTL_MS) {
      const { data: settings, error: cfgErr } = await admin
        .from('platform_settings')
        .select('key, value')
        .in('key', ['telegram_webhook_secret', 'ops_alert_telegram_chat_id']);
      if (cfgErr) {
        // 503, not 200: transient — Telegram redelivers, the command survives.
        console.error('telegram-bot: settings read failed', cfgErr.message);
        return new Response('config unavailable', { status: 503 });
      }
      const cfg = Object.fromEntries(
        (settings ?? []).map((r: { key: string; value: unknown }) => [r.key, String(r.value ?? '')]),
      );
      cachedConfig = {
        secret: cfg['telegram_webhook_secret'] ?? '',
        ownerChat: cfg['ops_alert_telegram_chat_id'] ?? '',
        fetchedAt: Date.now(),
      };
    }
    const { secret, ownerChat } = cachedConfig;
    // Refuse to serve until BOTH auth anchors exist — a missing secret must
    // fail closed, not open. 503 (not 200): this is a config error we want
    // surfaced, and Telegram retrying it is harmless noise.
    if (!secret || !ownerChat) return new Response('not configured', { status: 503 });

    const provided = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
    if (!secretMatches(provided, secret)) return new Response('unauthorized', { status: 401 });

    let update: TelegramUpdate;
    try {
      update = await req.json();
    } catch {
      return new Response('', { status: 200 });
    }

    const chatId = update.message?.chat?.id;
    if (chatId === undefined || String(chatId) !== ownerChat) {
      // Not the owner (or not a message update): ignore silently.
      return new Response('', { status: 200 });
    }

    const command = parseCommand(update.message?.text);
    let reply: string;
    if (command === 'today' || command === 'week') {
      const { data, error } = await admin.rpc('ops_stats_text', { p_scope: command });
      if (error) {
        console.error('telegram-bot: ops_stats_text failed', error.message);
        reply = 'Stats unavailable right now — try again in a minute.';
      } else {
        reply = (data as string | null) ?? HELP_TEXT;
      }
    } else {
      reply = HELP_TEXT;
    }

    return new Response(JSON.stringify(sendMessageReply(chatId, reply)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('telegram-bot: unhandled', error instanceof Error ? error.message : error);
    return new Response('', { status: 200 });
  }
});
