import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const waitlistSchema = z.object({
  email: z.string().email().max(320),
  whatsapp: z.string().min(5).max(40).nullable(),
  locale: z.enum(['en', 'ar', 'ru', 'it', 'de']),
  source: z.string().max(64).default('landing'),
  referrer: z.string().max(2000).nullable(),
});

export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const parsed = waitlistSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: 'Waitlist not yet configured. Try again later.' },
      { status: 503 },
    );
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const headers = req.headers;
  const ip =
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? headers.get('x-real-ip') ?? null;
  const ua = headers.get('user-agent') ?? null;

  const { error } = await supabase.from('waitlist').insert({
    email: parsed.data.email.toLowerCase(),
    whatsapp: parsed.data.whatsapp,
    locale: parsed.data.locale,
    source: parsed.data.source,
    referrer: parsed.data.referrer,
    ip,
    user_agent: ua,
  });

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    return NextResponse.json({ error: 'Could not save signup.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
