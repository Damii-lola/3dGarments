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

`magic-link.html` contains `{{ .Token }}`. That is the six-digit code the login
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

- **Resend** — free tier, 100 emails/day, 3,000/month. Needs a domain you own,
  or their `onboarding@resend.dev` sender for testing only.
- **Brevo** — free tier, 300 emails/day.

Set the sender to something at a domain you control (for example
`no-reply@findmysize.com`) once the domain exists, and keep the display name
`FindMySize`.

## Site URL and redirects

Supabase → Authentication → **URL Configuration**:

- **Site URL**: `https://damii-lola.github.io/3dGarments/auth/`
- **Redirect URLs**: add the same address. The site asks for it explicitly
  (`emailRedirectTo` in `web/src/services/auth.js`), and a link that is not on
  this allow-list is silently rewritten to the Site URL instead.

The repository name and the Pages path still say `3dGarments`. That is
deliberate: the rename is visual. The URLs above are the real ones.
