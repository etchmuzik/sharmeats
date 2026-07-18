// deno test --permit-no-files supabase/functions/telegram-bot/
import { assertEquals } from 'jsr:@std/assert@1';
import { HELP_TEXT, parseCommand, sendMessageReply } from './logic.ts';

Deno.test('parseCommand maps known commands', () => {
  assertEquals(parseCommand('/today'), 'today');
  assertEquals(parseCommand('/week'), 'week');
  assertEquals(parseCommand('/start'), 'help');
  assertEquals(parseCommand('/help'), 'help');
});

Deno.test('parseCommand strips @botname suffix (group chats)', () => {
  assertEquals(parseCommand('/today@malawany_bot'), 'today');
  assertEquals(parseCommand('/week@Malawany_Bot'), 'week');
});

Deno.test('parseCommand is case-insensitive and tolerates trailing text', () => {
  assertEquals(parseCommand('/TODAY'), 'today');
  assertEquals(parseCommand('  /week  please  '), 'week');
});

Deno.test('parseCommand rejects everything else', () => {
  assertEquals(parseCommand(undefined), null);
  assertEquals(parseCommand(null), null);
  assertEquals(parseCommand(''), null);
  assertEquals(parseCommand('hello'), null);
  assertEquals(parseCommand('today'), null); // no leading slash
  assertEquals(parseCommand('/todayx'), null);
  assertEquals(parseCommand('x /today'), null); // command must lead
});

Deno.test('sendMessageReply shapes the webhook-response method call', () => {
  assertEquals(sendMessageReply(751331374, 'hi'), {
    method: 'sendMessage',
    chat_id: 751331374,
    text: 'hi',
  });
});

Deno.test('HELP_TEXT lists both commands', () => {
  for (const cmd of ['/today', '/week']) {
    if (!HELP_TEXT.includes(cmd)) throw new Error(`help text missing ${cmd}`);
  }
});
