# Supabase auth email templates — Sharm Eats

Paste each block into **Authentication → Emails → Templates** in the Supabase
dashboard, one per template. Subject lines are given alongside each.

## Brand values these use

Taken from `landing/src/app/globals.css` (`.lpage`), so email matches the site:

| Token | Value | Used for |
|---|---|---|
| `--bg` | `#F6F5F2` | page canvas |
| `--ink` | `#161616` | headings |
| `--mut` | `#8B8984` | body copy |
| `--dim` | `#B0ADA6` | footer, fallback link label |
| `--line` | `#EAE8E3` | card border, divider |
| `--accent` | `#F05A1F` | button, links |

Logo: `https://sharmeats.online/brand/icon-192.png` (verified live, `image/png`).

## Things that will bite you if changed carelessly

- **Every style is inline and the layout is `<table>`-based.** Gmail strips
  `<style>` blocks and Outlook ignores most modern CSS. A `<div>` + flexbox
  rewrite will look correct in the dashboard preview and broken in inboxes.
- **Urbanist will not load.** Email clients do not fetch webfonts reliably, so
  the stack falls back to system sans. The brand reads through colour and
  layout, not typeface.
- **`Reauthentication` has no `{{ .ConfirmationURL }}`** — it is OTP-only, so
  that template shows `{{ .Token }}` instead. Pasting a button template there
  produces a dead link.
- **"expires in 1 hour" must match your real setting** (Authentication →
  Sessions → OTP expiry, default 3600s). If you change the expiry, change the
  copy — an email that lies about expiry generates support mail.
- The fallback "paste this URL" block is not decoration: corporate mail
  scanners rewrite or pre-click links, and some clients strip the button.

---

## 1. Confirm sign up

**Subject:** `Confirm your Sharm Eats account`

```html
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Confirm your email to start ordering.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F6F5F2;margin:0;padding:32px 12px;font-family:'Urbanist',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#FFFFFF;border:1px solid #EAE8E3;border-radius:20px;">
      <tr><td style="padding:36px 36px 0;">
        <img src="https://sharmeats.online/brand/icon-192.png" width="48" height="48" alt="Sharm Eats" style="display:block;border:0;border-radius:12px;">
      </td></tr>
      <tr><td style="padding:24px 36px 0;">
        <h1 style="margin:0;font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-0.02em;color:#161616;">Confirm your email</h1>
        <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:#8B8984;">One tap and your Sharm Eats account is ready — then Naama Bay to Nabq is a few minutes away.</p>
      </td></tr>
      <tr><td style="padding:28px 36px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="border-radius:999px;background:#F05A1F;">
            <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 30px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px;">Confirm my email</a>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:22px 36px 0;">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#B0ADA6;">If the button doesn't work, paste this into your browser:</p>
        <p style="margin:6px 0 0;font-size:13px;line-height:1.6;word-break:break-all;"><a href="{{ .ConfirmationURL }}" style="color:#F05A1F;text-decoration:underline;">{{ .ConfirmationURL }}</a></p>
      </td></tr>
      <tr><td style="padding:28px 36px 32px;">
        <hr style="border:0;border-top:1px solid #EAE8E3;margin:0 0 18px;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#B0ADA6;">This link expires in 1 hour. If you didn't create a Sharm Eats account, you can ignore this email — nothing happens until it's confirmed.</p>
        <p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#B0ADA6;">Sharm Eats · Sharm el-Sheikh, Egypt<br><a href="https://sharmeats.online" style="color:#B0ADA6;text-decoration:underline;">sharmeats.online</a> · <a href="mailto:support@sharmeats.online" style="color:#B0ADA6;text-decoration:underline;">support@sharmeats.online</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
```

---

## 2. Invite user

**Subject:** `You're invited to Sharm Eats`

```html
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Accept your invitation to Sharm Eats.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F6F5F2;margin:0;padding:32px 12px;font-family:'Urbanist',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#FFFFFF;border:1px solid #EAE8E3;border-radius:20px;">
      <tr><td style="padding:36px 36px 0;">
        <img src="https://sharmeats.online/brand/icon-192.png" width="48" height="48" alt="Sharm Eats" style="display:block;border:0;border-radius:12px;">
      </td></tr>
      <tr><td style="padding:24px 36px 0;">
        <h1 style="margin:0;font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-0.02em;color:#161616;">You've been invited</h1>
        <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:#8B8984;">Someone at Sharm Eats invited <strong style="color:#161616;">{{ .Email }}</strong> to create an account. Accept below to set your password.</p>
      </td></tr>
      <tr><td style="padding:28px 36px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="border-radius:999px;background:#F05A1F;">
            <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 30px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px;">Accept invitation</a>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:22px 36px 0;">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#B0ADA6;">If the button doesn't work, paste this into your browser:</p>
        <p style="margin:6px 0 0;font-size:13px;line-height:1.6;word-break:break-all;"><a href="{{ .ConfirmationURL }}" style="color:#F05A1F;text-decoration:underline;">{{ .ConfirmationURL }}</a></p>
      </td></tr>
      <tr><td style="padding:28px 36px 32px;">
        <hr style="border:0;border-top:1px solid #EAE8E3;margin:0 0 18px;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#B0ADA6;">This invitation expires in 1 hour. If you weren't expecting it, you can ignore this email.</p>
        <p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#B0ADA6;">Sharm Eats · Sharm el-Sheikh, Egypt<br><a href="https://sharmeats.online" style="color:#B0ADA6;text-decoration:underline;">sharmeats.online</a> · <a href="mailto:support@sharmeats.online" style="color:#B0ADA6;text-decoration:underline;">support@sharmeats.online</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
```

---

## 3. Magic link / OTP

**Subject:** `Your Sharm Eats sign-in link`

```html
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your one-time sign-in link.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F6F5F2;margin:0;padding:32px 12px;font-family:'Urbanist',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#FFFFFF;border:1px solid #EAE8E3;border-radius:20px;">
      <tr><td style="padding:36px 36px 0;">
        <img src="https://sharmeats.online/brand/icon-192.png" width="48" height="48" alt="Sharm Eats" style="display:block;border:0;border-radius:12px;">
      </td></tr>
      <tr><td style="padding:24px 36px 0;">
        <h1 style="margin:0;font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-0.02em;color:#161616;">Sign in to Sharm Eats</h1>
        <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:#8B8984;">Tap below to sign in. No password needed.</p>
      </td></tr>
      <tr><td style="padding:28px 36px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="border-radius:999px;background:#F05A1F;">
            <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 30px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px;">Sign in</a>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:24px 36px 0;">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#B0ADA6;">Or enter this code in the app:</p>
        <p style="margin:8px 0 0;font-size:30px;line-height:1.2;font-weight:800;letter-spacing:0.16em;color:#161616;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;">{{ .Token }}</p>
      </td></tr>
      <tr><td style="padding:22px 36px 0;">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#B0ADA6;">If the button doesn't work, paste this into your browser:</p>
        <p style="margin:6px 0 0;font-size:13px;line-height:1.6;word-break:break-all;"><a href="{{ .ConfirmationURL }}" style="color:#F05A1F;text-decoration:underline;">{{ .ConfirmationURL }}</a></p>
      </td></tr>
      <tr><td style="padding:28px 36px 32px;">
        <hr style="border:0;border-top:1px solid #EAE8E3;margin:0 0 18px;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#B0ADA6;">This link and code expire in 1 hour and can be used once. If you didn't ask to sign in, ignore this email — your account is safe.</p>
        <p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#B0ADA6;">Sharm Eats · Sharm el-Sheikh, Egypt<br><a href="https://sharmeats.online" style="color:#B0ADA6;text-decoration:underline;">sharmeats.online</a> · <a href="mailto:support@sharmeats.online" style="color:#B0ADA6;text-decoration:underline;">support@sharmeats.online</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
```

---

## 4. Change email address

**Subject:** `Confirm your new Sharm Eats email`

```html
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Confirm the new address on your account.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F6F5F2;margin:0;padding:32px 12px;font-family:'Urbanist',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#FFFFFF;border:1px solid #EAE8E3;border-radius:20px;">
      <tr><td style="padding:36px 36px 0;">
        <img src="https://sharmeats.online/brand/icon-192.png" width="48" height="48" alt="Sharm Eats" style="display:block;border:0;border-radius:12px;">
      </td></tr>
      <tr><td style="padding:24px 36px 0;">
        <h1 style="margin:0;font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-0.02em;color:#161616;">Confirm your new email</h1>
        <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:#8B8984;">You asked to change the address on your Sharm Eats account from <strong style="color:#161616;">{{ .Email }}</strong> to <strong style="color:#161616;">{{ .NewEmail }}</strong>. Confirm to finish.</p>
      </td></tr>
      <tr><td style="padding:28px 36px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="border-radius:999px;background:#F05A1F;">
            <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 30px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px;">Confirm the change</a>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:22px 36px 0;">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#B0ADA6;">If the button doesn't work, paste this into your browser:</p>
        <p style="margin:6px 0 0;font-size:13px;line-height:1.6;word-break:break-all;"><a href="{{ .ConfirmationURL }}" style="color:#F05A1F;text-decoration:underline;">{{ .ConfirmationURL }}</a></p>
      </td></tr>
      <tr><td style="padding:28px 36px 32px;">
        <hr style="border:0;border-top:1px solid #EAE8E3;margin:0 0 18px;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#B0ADA6;">This link expires in 1 hour. <strong style="color:#8B8984;">If you didn't request this change, contact <a href="mailto:support@sharmeats.online" style="color:#F05A1F;text-decoration:underline;">support@sharmeats.online</a> straight away</strong> — someone may have access to your account.</p>
        <p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#B0ADA6;">Sharm Eats · Sharm el-Sheikh, Egypt<br><a href="https://sharmeats.online" style="color:#B0ADA6;text-decoration:underline;">sharmeats.online</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
```

---

## 5. Reset password

**Subject:** `Reset your Sharm Eats password`

```html
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Reset the password on your Sharm Eats account.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F6F5F2;margin:0;padding:32px 12px;font-family:'Urbanist',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#FFFFFF;border:1px solid #EAE8E3;border-radius:20px;">
      <tr><td style="padding:36px 36px 0;">
        <img src="https://sharmeats.online/brand/icon-192.png" width="48" height="48" alt="Sharm Eats" style="display:block;border:0;border-radius:12px;">
      </td></tr>
      <tr><td style="padding:24px 36px 0;">
        <h1 style="margin:0;font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-0.02em;color:#161616;">Reset your password</h1>
        <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:#8B8984;">Choose a new password for your Sharm Eats account.</p>
      </td></tr>
      <tr><td style="padding:28px 36px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="border-radius:999px;background:#F05A1F;">
            <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 30px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px;">Set a new password</a>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:24px 36px 0;">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#B0ADA6;">Or enter this code in the app:</p>
        <p style="margin:8px 0 0;font-size:30px;line-height:1.2;font-weight:800;letter-spacing:0.16em;color:#161616;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;">{{ .Token }}</p>
      </td></tr>
      <tr><td style="padding:22px 36px 0;">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#B0ADA6;">If the button doesn't work, paste this into your browser:</p>
        <p style="margin:6px 0 0;font-size:13px;line-height:1.6;word-break:break-all;"><a href="{{ .ConfirmationURL }}" style="color:#F05A1F;text-decoration:underline;">{{ .ConfirmationURL }}</a></p>
      </td></tr>
      <tr><td style="padding:28px 36px 32px;">
        <hr style="border:0;border-top:1px solid #EAE8E3;margin:0 0 18px;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#B0ADA6;">This link and code expire in 1 hour. If you didn't request a reset, ignore this email — your password stays as it is.</p>
        <p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#B0ADA6;">Sharm Eats · Sharm el-Sheikh, Egypt<br><a href="https://sharmeats.online" style="color:#B0ADA6;text-decoration:underline;">sharmeats.online</a> · <a href="mailto:support@sharmeats.online" style="color:#B0ADA6;text-decoration:underline;">support@sharmeats.online</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
```

---

## 6. Reauthentication

**Subject:** `Your Sharm Eats verification code`

> This template is **OTP-only**. `{{ .ConfirmationURL }}` is not available here —
> a button template pasted into this slot renders a dead link.

```html
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your verification code.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F6F5F2;margin:0;padding:32px 12px;font-family:'Urbanist',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#FFFFFF;border:1px solid #EAE8E3;border-radius:20px;">
      <tr><td style="padding:36px 36px 0;">
        <img src="https://sharmeats.online/brand/icon-192.png" width="48" height="48" alt="Sharm Eats" style="display:block;border:0;border-radius:12px;">
      </td></tr>
      <tr><td style="padding:24px 36px 0;">
        <h1 style="margin:0;font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-0.02em;color:#161616;">Confirm it's you</h1>
        <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:#8B8984;">Enter this code to continue with a sensitive change to your account.</p>
      </td></tr>
      <tr><td style="padding:26px 36px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
          <td align="center" style="background:#F6F5F2;border:1px solid #EAE8E3;border-radius:14px;padding:20px 12px;">
            <span style="font-size:34px;line-height:1.1;font-weight:800;letter-spacing:0.18em;color:#161616;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;">{{ .Token }}</span>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:28px 36px 32px;">
        <hr style="border:0;border-top:1px solid #EAE8E3;margin:0 0 18px;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#B0ADA6;">This code expires in 1 hour. <strong style="color:#8B8984;">Nobody at Sharm Eats will ever ask you for it.</strong> If you weren't making a change to your account, contact <a href="mailto:support@sharmeats.online" style="color:#F05A1F;text-decoration:underline;">support@sharmeats.online</a>.</p>
        <p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#B0ADA6;">Sharm Eats · Sharm el-Sheikh, Egypt<br><a href="https://sharmeats.online" style="color:#B0ADA6;text-decoration:underline;">sharmeats.online</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
```

---

## After pasting

1. **Test the reset template first** by triggering a password reset for
   `admin@sharmeats.online` — it proves SMTP, the template, and gets that
   account off its temporary password in one move.
2. **Check the spam folder on the first send.** Auth mail is the category most
   likely to be filtered, and a reset that lands in junk is indistinguishable
   from one that never arrived.
3. **Confirm SPF/DKIM for `sharmeats.online`** in hPanel if anything lands in
   spam.
4. Raise the cap in **Authentication → Rate Limits** — it is a separate setting
   from SMTP, and the built-in default is what caused the 2026-07-30 admin
   lockout.
