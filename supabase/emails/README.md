# The three emails FindMySize sends

Supabase owns the sending; these files are the bodies you paste into the
dashboard. Nothing here is code — an email template lives in the project, not in
this repository, so **a change to a file here does nothing until it is pasted**.

Supabase → **Authentication** → **Email Templates**:

| File | Template in Supabase | Subject to type in | Used by |
| --- | --- | --- | --- |
| `confirm-signup.html` | **Confirm signup** | `Confirm FindMySize` | Creating an account |
| `magic-link.html` | **Magic Link** | `Your FindMySize login code` | Every log in (second step) |
| `recovery.html` | **Reset password** | `Reset your FindMySize password` | "Forgot password?" |

## The one variable that matters

`magic-link.html` contains `{{ .Token }}`. That is the code the login
screen asks for. Supabase's default Magic Link template only has
`{{ .ConfirmationURL }}` (the clickable link), so if you paste the default back
in, logins still work by clicking the link but the code box has nothing to type.
Keep `{{ .Token }}` in the template.

## Sending limits — read this before testing with real people

Supabase's **built-in** mailer is not a production mail service. It is heavily
throttled (a handful of messages per hour for the whole project, not per user),
it is often filtered as spam, and every log in now needs one email. Without a
custom SMTP server the second or third person to log in in the same hour will be
told to wait.

Free options that work (Supabase → Authentication → **SMTP Settings**):

- **Gmail** — no domain needed. Turn on 2-Step Verification, create an app
  password (Google Account → Security → App passwords), then host
  `smtp.gmail.com`, port 587, username the full address, password the app
  password. ~500 a day, and the From is that address.
- **Brevo** — free tier, 300 emails/day. Works without a domain if you verify a
  sender address under Senders, Domains & IPs. Host `smtp-relay.brevo.com`,
  port 587, the SMTP login and key from SMTP & API → SMTP.
- **Resend** — free tier, 100 emails/day. Needs a domain you own, or their
  `onboarding@resend.dev` sender for testing only.

This project currently sends through the Gmail account `findmysize.us@gmail.com`,
with the display name `FindMySize`. When a domain exists, move the sender to
something like `no-reply@findmysize.com` and keep everything else the same.

## Site URL and redirects

Supabase → Authentication → **URL Configuration**:

- **Site URL**: `https://damii-lola.github.io/3dGarments/auth/`
- **Redirect URLs**: add the same address. The site asks for it explicitly
  (`emailRedirectTo` in `web/src/services/auth.js`), and a link that is not on
  this allow-list is silently rewritten to the Site URL instead.

The repository name and the Pages path still say `3dGarments`. That is
deliberate: the rename is visual. The URLs above are the real ones.
