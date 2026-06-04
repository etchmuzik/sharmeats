# WhatsApp Business Setup — Phase 0 Checklist

**Goal:** A verified WhatsApp Business number live within 7 days, capable of:
- Receiving waitlist sign-ups from the landing page.
- Outbound restaurant-onboarding messages from the Sharm ops lead.
- LOI follow-ups with delivery receipts.
- Template-based notifications later (order status, etc.).

**Why this matters in Phase 0:** WhatsApp is the *only* channel that 100% of Egyptian restaurants and 95% of Sharm tourists actually use. Email and SMS are second-class in this market. Get this right before the landing page goes live.

---

## Provider Decision: 360dialog vs Meta Direct vs Twilio

| | 360dialog (recommended) | Meta WhatsApp Cloud API | Twilio |
|---|---|---|---|
| Per-message cost (Egypt, May 2026) | ~$0.04 / business-initiated conv | ~$0.04 same | ~$0.07 (markup) |
| Setup speed | 1–3 days, single dashboard | 1–7 days, more steps | 1 day, easiest |
| Customer-care window pricing | Free (24h after user msg) | Free | Twilio charges |
| Multi-user inbox | Yes, included | No (need 3rd party like Wati) | Yes, via Twilio Flex (expensive) |
| Number portability later | Yes | Yes | Painful |
| Best for | **Us** | Engineering-heavy teams | Speed-first prototypes |

**Decision: 360dialog.** Reasoning: cheapest, fastest, comes with a multi-user inbox the ops lead can use without us building one, and supports template management out of the box.

---

## Step-by-Step Setup (target: complete in 5 working days)

### Day 1 — Meta Business Manager
1. Create or use existing **Meta Business Manager** account at `business.facebook.com`.
2. Verify the business (legal name, address, tax ID). This requires documentation — start now even if Egyptian LLC is pending. Use the founder's personal address as a placeholder if needed (re-verify once the LLC is registered).
3. **Heads up:** Meta Business Verification takes 1–14 days. The number can be active before verification, but rate limits are tighter until verified (~250 conversations/day vs unlimited).

### Day 1–2 — Get a number
- **Option A (recommended):** Buy a fresh Egyptian mobile number with a SIM, used *only* for WhatsApp Business (not for personal calls). EGP ~100 + EGP 50 credit. Vodafone or Orange.
- **Option B:** Use a virtual number from 360dialog. Faster but costs ~$15/mo and feels less local.
- **Critical:** The number must **not have a personal WhatsApp account currently linked** — that account will be deleted when you migrate it to Business API. If using a fresh SIM, this isn't an issue.

### Day 2 — Sign up with 360dialog
1. Go to `hub.360dialog.com`, create account.
2. Select "WhatsApp Business API" → "Get a new number" (or "Bring your own number").
3. Connect to Meta Business Manager (OAuth flow).
4. Verify number via SMS or voice OTP.
5. Set up display name (e.g., "sharmeats") and category ("Food and beverage").
6. Get API key. Store in 1Password / vault — never commit to git.

### Day 2–3 — Configure profile
- Profile picture (sharmeats logo when ready, neutral placeholder for now).
- About text: "Sharm El Sheikh food delivery — coming soon."
- Business hours.
- Website URL (landing page once live).
- Email.

### Day 3 — Submit message templates for approval
Meta requires pre-approval for any business-initiated (outbound) message outside the 24h customer-care window. Submit these now — approval takes 1–3 days.

#### Template 1: `waitlist_confirmation_en`
```
Hi {{1}}! 👋 You're on the sharmeats waitlist.
We're launching the best food delivery in Sharm El Sheikh — 5 languages, hotel room delivery, fair prices.
We'll message you the day we open in your area.
— sharmeats team
```
Repeat for `_ar`, `_ru`, `_it`, `_de` (same structure, translated).

#### Template 2: `restaurant_outreach_ar`
```
السلام عليكم {{1}}،
أنا {{2}} من sharmeats — تطبيق توصيل طعام جديد في شرم الشيخ موجه للسياح بشكل أساسي.
نختار ٢٠ مطعم فقط في نعمة بي لمرحلة الإطلاق التجريبي بعمولة مخفضة ١٢٪.
ممكن نقابلك في مطعمك هذا الأسبوع لـ ١٥ دقيقة؟
```

#### Template 3: `loi_follow_up_ar`
```
{{1}}، شكرًا لوقتك أمس.
بعثت لك خطاب النوايا على الإيميل. مرفق نسخة هنا أيضًا.
لو في أي سؤال، أنا متاح على نفس الرقم.
```

#### Template 4: `loi_signed_thank_you_ar`
```
استلمنا الخطاب الموقّع. أهلًا بيك في كوهورت التأسيس!
المصور هيتواصل معاك خلال ٤٨ ساعة لترتيب زيارة التصوير.
أي حاجة، أنا هنا.
```

### Day 4 — Wire to landing page
Backend API route:
- POST `/api/waitlist` → insert into Supabase `waitlist` table → POST to 360dialog `/messages` with `waitlist_confirmation_{locale}` template, parameters `[first_name]`.
- Use 360dialog webhook → POST to a Supabase Edge Function → log delivery + read receipts in a `waitlist_messages` table.

### Day 5 — Verify everything end-to-end
- Sign up on the landing page with your own number → confirm WhatsApp arrives within 30s.
- Reply to it → confirm 360dialog inbox shows the reply.
- From the inbox, send a free-text reply → confirm it arrives in WhatsApp.
- Send a templated message to a different number → confirm it arrives.

---

## Ongoing operating discipline

- **One person owns the inbox.** Ops lead, not founder. Replies within 4 hours during waking hours, target 1 hour.
- **Never use the personal WhatsApp Web alongside Business API on the same number** — Meta will lock the number. Use 360dialog's web inbox exclusively.
- **Templates are immutable once approved.** If you need to change wording, submit a new template (e.g., `waitlist_confirmation_v2_en`). Plan template names with versioning from day 1.
- **Quality rating matters.** Meta tracks the % of users who block / report your number. >3% = rate-limited. To stay green: only message users who opted in (waitlist form has an explicit checkbox), and never send promotional messages outside opt-in cohorts.
- **24h care window.** When a user messages you first, you can reply freely for 24h. After that, every outbound message needs a template (charged).

---

## Cost projection (first 3 months)

| Item | Cost |
|---|---|
| 360dialog base | $15/mo × 3 = $45 |
| Number (Egyptian SIM) | EGP 150 one-time ≈ $3 |
| Outbound conversations (~500/mo × 3 = 1,500 conv) | ~$60 |
| Meta Business Verification | $0 |
| **Phase 0 WhatsApp total** | **~$110** |

---

## Risks

- **Number lock-out from a wrong action** (e.g., sharing with personal WA on same SIM). Mitigation: dedicated SIM, dedicated person, written runbook above.
- **Template rejection** for spammy wording. Mitigation: templates above are deliberately conversational, not promotional. If rejected, soften further.
- **Egyptian phone-network outages** (occasional). Mitigation: 360dialog automatically retries; no action needed.
- **Meta policy changes** (have happened). Mitigation: always have email + SMS as fallback channels in the customer database.

---

## Next steps (this week)

1. [ ] Get a fresh Vodafone/Orange Egyptian SIM (founder buys, hands to ops lead day one).
2. [ ] Create Meta Business Manager account, start verification (will take days in background).
3. [ ] Sign up for 360dialog, connect number.
4. [ ] Submit 4 templates for approval.
5. [ ] Once landing page is live (separate task), wire the `/api/waitlist` integration.
6. [ ] Document the inbox runbook in `/docs/whatsapp-ops-runbook.md` once ops lead is hired.
