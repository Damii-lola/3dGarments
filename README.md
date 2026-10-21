# 3dGarments

**A size finder for clothing brands.** A brand types a garment's size chart into
its dashboard, gets a link, and drops a snippet on the product page: the shopper
presses one button, records a slow 360° turn on their own phone, and is told
which size of _that_ garment to buy — measured against the brand's own chart, not
a generic one. No app, no account for the shopper, no video or measurement stored
anywhere.

The same engine also powers the fitting-room core in this repo: male and female
mannequins with real-measurement shape controls, and a garment photo pipeline
(cut-out, measurement, AI description) that clothing upload builds on.

The bodies are the models in `assets/` (FBX), turned into rigged web models (`web/public/body/*.glb`) by `tools/body/`.

```
 phone camera ──► GitHub Pages (Vite + three.js)
                    │  Supabase Auth (JWT)
                    ▼
               Render (Express API) ──► Cloudflare Workers AI (garment recognition)
                    │
                    ▼
               Supabase (Postgres + private Storage)
```

The fitting room runs entirely in the browser and needs no backend. The API and Supabase back the garment pipeline (cut-out, measurement, AI description) that clothing upload builds on.

The public site is five pages, all real directories on disk: `/` (the home page — the camera first, then the page the brands read), `/size/` (the scanner — record a 360° turn, trim it, get a size), `/auth/` (create an account with a username, an email and a password, or log in), `/pricing/` and `/dashboard/` (where a brand types its clothing and gets its links). Every page carries the same bar: the brand, the four sections, and the account button. The camera sends you to the account screen, and the account screen hands you on to the scanner; opening `/size` without an account does the same. On the app pages (`/size`, `/auth`) the bar is clamped to the app column, so the four section names fold behind one button at every size rather than crowding the brand. The links in the bar are written as `%BASE_URL%…`, which Vite fills in at build time, so one copy of the markup works in a subdirectory and at a domain root.

### The shopper's link, and the popup

A brand's chart has an unguessable code. Two addresses open it:

- `/size/?g=CODE` — the scanner, straight in: **no account gate**, because a
  shopper following a product link is not a brand signing in. The size the scan
  comes back with is scored against that chart, and a size card sits above the
  measurements. The scanner asks the shopper nothing: the chart's own sex picks
  the sheet when it has one, and when nothing does, both built-in sheets are
  scored against the body and the closer one is used — said on the results in so
  many words. Opened on a phone it runs at the popup's
  compact scale; a desktop or tablet keeps the full size.
- `/size/?g=CODE&embed=1` — the same page inside a popup: the bar is reduced to
  the centred logo, the sky comes off, and the whole tool is drawn 52% smaller
  than on a phone (the panel's own size is the store's and does not change).
  This is what `web/public/embed.js` opens in an overlay on the brand's own
  product page, so the shopper never leaves the page they are buying from. The script is plain JavaScript with no build step, so a brand needs one
  tag:

  ```html
  <script src="https://damii-lola.github.io/3dGarments/embed.js"
          data-chart="CODE" data-label="Find my size"></script>
  ```

  It also publishes `window.ThreeDG.open({ code, name })` for a button of the
  brand's own — which is how the dashboard previews a chart.

### The chart a brand types

A chart is whatever the brand already prints: its own size names, its own unit,
and its own columns. The dashboard starts every chart with **Chest or bust /
Waist / Hips** and the brand adds, renames, repoints or removes columns from
there — a shoulder, an upper arm, a height for a shirt; just a waist for
trousers; a body length that only gets printed.

- A column is one of the measurements the scan can actually read (`chest`,
  `waist`, `hips`, `shoulder`, `neck`, `arm`, `height` — one list, in
  `server/src/shared/measures.js`, used by the form and the engine) or
  **Other**, which is carried and shown to the shopper beside their size and
  never scored.
- The **first column with a measure decides the size**; every other measured
  column joins the same worst-case comparison. That is why a trousers chart
  can be a waist and an inseam with no chest anywhere, and why adding a
  shoulder column can change the answer.
- A column only counts when **every** size row carries it. A blank cell must not
  become an advantage, so the dashboard asks for a column to be filled
  everywhere or removed.
- Rows are edited in the same table: as many sizes as the brand sells, in the
  order it sells them (a tie keeps the row typed first).

The chart travels with the scan as `{ name, sex, unit, columns, rows }`; the
server converts it to inches once, picks the row, and returns it as `sizeChart`
so the shopper's card can show that size's own numbers in the brand's words and
unit.

## One-time setup (about 10 minutes)

### 1. Supabase
1. Create a project at [supabase.com](https://supabase.com/dashboard). Pick the closest region (eu-west works well for Nigeria) and save the DB password.
2. Collect these values:
   - **Project ref**: Settings → General
   - **URL**, **anon key** and **service_role key**: Settings → API
   - **Access token**: Account → Access Tokens
3. Under Authentication → URL Configuration, set **Site URL** to `https://damii-lola.github.io/3dGarments/auth/` and add `https://damii-lola.github.io/3dGarments/**` (plus `http://localhost:5173/**` while developing) to **Redirect URLs**. Supabase falls back to the Site URL whenever a redirect is not in that list, so this is the setting that decides whether a confirmation link lands on the account screen or on something unrelated.
4. Apply the schema: paste `supabase/setup.sql` into SQL Editor → New query → Run (it is idempotent). It creates the tables, the RLS policies, the private `garments` bucket, and `profiles` — the one row per account that holds the username, plus the trigger that writes it on every signup and the `username_taken()` check the signup form calls. It also creates `size_charts`: one row per garment a brand has typed in, readable by its owner only, plus `chart_by_code()` — a `security definer` function that returns one chart to a shopper who has the code and no account. Until this has run, the dashboard says so in words and saving is off; nothing else is affected.
5. Under Authentication → Providers → Email, leave **Confirm email** on. Signup then sends one link; the account screen says so and offers to send it again. After that, every log in is the password plus a code mailed to the same address. The code is 6–10 digits, whatever **Email OTP Length** is set to (this project was issuing 8 when the screen was tested, so the box accepts 6–10 and does not guess).
6. Paste the three email bodies from `supabase/emails/` into Authentication → Email Templates: **Confirm signup**, **Magic Link** (this is the login code — it must keep `{{ .Token }}`) and **Reset password**. Subject lines and the exact mapping are in `supabase/emails/README.md`.
7. Set up custom SMTP under Authentication → SMTP Settings. Supabase's built-in mailer sends only a handful of messages an hour for the whole project, and every log in now needs one; the templates cannot be edited until this exists either. Two free routes that need no domain:
   - **Brevo** — Host `smtp-relay.brevo.com`, port `587`, username the login address on your Brevo account (newer accounts show a `…@smtp-brevo.com` one under SMTP & API → SMTP), password the SMTP key from that same page, sender an address you have confirmed under Senders. 300 a day.
   - **Gmail** — Host `smtp.gmail.com`, port `587`, username the full address, password a 16-character App Password (Google Account → Security → 2-Step Verification → App passwords; ordinary passwords are refused), sender that same address.

   Whichever you pick, the **sender** must be the address the provider verified, or mail is rejected. Then raise Authentication → Rate Limits → *Emails sent per hour* to something a real login rate can live with (100 is ample). This project currently sends through **`findmysize.us@gmail.com`** (Gmail, sender name `FindMySize`).
8. Google sign-in is deliberately not on the account screen yet — it needs a published site and a verified OAuth client first. The database side is already ready for it: `supabase/migrations/*_oauth_usernames.sql` teaches `handle_new_user` to name a provider account from its address (`sam@example.com` → `sam`, suffixed if taken). When the button comes back, create an OAuth client in Google Cloud Console, put its ID and secret in Authentication → Providers → Google, and add `https://<project-ref>.supabase.co/auth/v1/callback` as the authorised redirect URI.

The migration in `supabase/migrations` creates the tables, RLS policies and the private `garments` bucket. CI applies it automatically.

### 2. Cloudflare Workers AI
Go to Cloudflare dashboard → **AI → Workers AI → Use REST API**. Create a token with *Workers AI* permissions and copy the **Account ID** and the **API token**.

### 3. Render (live)
The API is running at **https://threedgarments.onrender.com**. Its secrets are stored only as Render environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. There are no `.env` files in this repo. Render redeploys on every push to `main` once CI passes.

**Who reads the frames** is one variable. `MISTRAL_API_KEY` (plus optional `MISTRAL_MODEL`, default `ministral-14b-latest`) makes the scan use Mistral's vision model; without it the scan uses Workers AI exactly as before. `VISION_PROVIDER=mistral|cloudflare` forces the choice when both keys exist. Whichever model runs, it only ever reports *where the landmarks are* — every centimetre after that is arithmetic in `server/src/lib/bodyGeometry.js`, on this server. `/health` says whether the server is up and `ready` (every required variable present); the per-integration detail moved behind `/health/deep`.

Check it with the token you set as `HEALTH_TOKEN` on Render:

```bash
curl -H "x-health-token: $HEALTH_TOKEN" https://threedgarments.onrender.com/health/deep
```

→ `"ok": true` means Supabase, Storage and the vision provider are all linked; `vision.lastOkAt` / `lastError.kind` say what Workers AI last did (`capacity`, `quota` or `auth`). The endpoint runs real provider calls, so it is not public: with no `HEALTH_TOKEN` on the server it answers **503**, and with the variable set a missing or wrong `x-health-token` header answers **401**. The token goes in the header, never the query string, so it does not end up in access logs.

### 4. GitHub
- **Settings → Pages → Source: GitHub Actions**
- **Settings → Secrets and variables → Actions**
  - Secrets (auto-apply DB migrations): `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`
  - Variables (sign-in on the website): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

The web app already points to the Render API by default.

## Local development
```bash
cd server && npm i && npm run dev    # needs the same 4 env vars exported in your shell
cd web && npm i && npm run dev       # http://localhost:5173
```
URL shortcuts: `?model=male|female`, `?tone=0..1` (skin tone). The lab also takes `?view=front|three|side|back`.

Rebuild the body models (only after changing `assets/` or `tools/body/`): start the lab (`cd test && npm run dev`), then `node tools/body/extract.mjs && python3 tools/body/prepare.py` (needs `pip install numpy scipy`).

## API
| Method | Path | |
|---|---|---|
| GET | `/health` | liveness: `ok`, `version`, `uptime_s`, `ready` |
| GET | `/health/deep` | integration check; needs `x-health-token: $HEALTH_TOKEN` (503 when the variable is unset, 401 when the header is missing or wrong) |
| GET | `/api/garments` | list, with signed image URLs |
| POST | `/api/body-scan` | measure a clip: `video` (multipart — the default path; the server decodes it, takes 8 stills and reads them) or JPEG `frames` (multipart, `?frames=1` in the app and the automatic fallback) or `pose` landmarks measured on the device (JSON, `?local=1`). Optional `from`/`to` (the trimmed span, seconds), `chart` (the brand's size chart — `{ name, sex, unit, columns, rows }` — used only to pick a size, never to measure). Returns the measurements, the notes, and `size` / `sizeChart` / `sizeSource` |
| POST | `/api/garments` | multipart `image` returns 202 and processes in the background |
| GET / PATCH / DELETE | `/api/garments/:id` | read, rename / recategorise / fit, delete |
| POST | `/api/garments/:id/reprocess` | re-run the pipeline |
| GET / PUT | `/api/me/body` | body measurements |
| GET / POST / DELETE | `/api/me/outfits` | saved outfits |

All `/api` routes need `Authorization: Bearer <supabase access token>` — except
`/api/body-scan`, which is open on purpose: it measures a clip and stores nothing,
and a shopper following a brand's link has no account to present.
