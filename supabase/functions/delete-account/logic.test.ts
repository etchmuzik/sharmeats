import { assertEquals } from 'jsr:@std/assert@1';
import { classifyAnonymizeFailure } from './logic.ts';

Deno.test('delete-account classifies active-order guards as a conflict', () => {
  assertEquals(
    classifyAnonymizeFailure({ code: '23514', message: 'ACTIVE_ORDER' }),
    { status: 409, error: 'active_order' },
  );
});

Deno.test('delete-account rejects non-customer identities explicitly', () => {
  assertEquals(
    classifyAnonymizeFailure({
      code: '23514',
      message: 'ACCOUNT_DELETION_ROLE_NOT_SUPPORTED',
    }),
    { status: 403, error: 'role_not_supported' },
  );
});

Deno.test('delete-account does not leak unexpected database diagnostics', () => {
  assertEquals(
    classifyAnonymizeFailure({ code: '42501', message: 'private detail' }),
    { status: 500, error: 'anonymize_failed' },
  );
});
