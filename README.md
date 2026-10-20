# 3dGarments

**A size finder for clothing brands.** A brand types a garment's size chart into
its dashboard, gets a link, and drops a snippet on the product page: the shopper
presses one button, records a slow 360Â° turn on their own phone, and is told
which size of _that_ garment to buy â€” measured against the brand's own chart, not
a generic one. No app, no account for the shopper, no video or measurement stored
anywhere.

The same engine also powers the fitting-room core in this repo: male and female
mannequins with real-measurement shape controls, and a garment photo pipeline
(cut-out, measurement, AI description) that clothing upload builds on.

The bodies are the models in `assets/` (FBX), turned into rigged web models (`web/public/body/*.glb`) by `tools/body/`.

```
 phone camera â”€â”€â–º GitHub Pages (Vite + three.js)
                    â”‚  Supabase Auth (JWT)
                    â–¼
               Render (Express API) â”€â”€â–º Cloudflare Workers AI (garment recognition)
                    â”‚
                    â–¼
               Supabase (Postgres + private Storage)
```

The fitting room runs entirely in the browser and needs no backend. The API and Supabase back the garment pipeline (cut-out, measurement, AI description) that clothing upload builds on.

The public site is five pages, all real directories on disk: `/` (the home page â€” the camera first, then the page the brands read), `/size/` (the scanner â€” record a 360Â° turn, trim it, get a size), `/auth/` (create an account with a username, an email and a password, or log in), `/pricing/` and `/dashboard/` (where a brand types its clothing and gets its links). Every page carries the same bar: the brand, the four sections, and the account button. The camera sends you to the account screen, and the account screen hands you on to the scanner; opening `/size` without an account does the same. On the app pages (`/size`, `/auth`) the bar is clamped to the app column, so the four section names fold behind one button at every size rather than crowding the brand. The links in the bar are written as `%BASE_URL%â€¦`, which Vite fills in at build time, so one copy of the markup works in a subdirectory and at a domain root.

### The shopper's link, and the popup

A brand's chart has an unguessable code. Two addresses open it:

- `/size/?g=CODE` â€” the scanner, straight in: **no account gate**, because a
  shopper following a product link is not a brand signing in. The size the scan
  comes back with is scored against that chart, and a size card sits above the
  measurements. The scanner asks the shopper nothing: the chart's own sex picks
  the sheet when it has one, and when nothing does, both built-in sheets are
  scored against the body and the closer one is used â€” said on the results in so
  many words. Opened on a phone it runs at the popup's
  compact scale; a desktop or tablet keeps the full size.
- `/size/?g=CODE&embed=1` â€” the same page inside a popup: the bar is reduced to
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
  brand's own â€” which is how the dashboard previews a chart.

### The chart a brand types

A chart is whatever the brand already prints: its own size names, its own unit,
and its own columns. The dashboard starts every chart with **Chest or bust /
Waist / Hips** and the brand adds, renames, repoints or removes columns from
there â€” a shoulder, an upper arm, a height for a shirt; just a waist for
trousers; a body length that only gets printed.

- A column is one of the measurements the scan can actually read (`chest`,
  `waist`, `hips`, `shoulder`, `neck`, `arm`, `height` â€” one list, in
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
   - **Project ref**: Settings â†’ General
   - **URL**, **anon key** and **service_role key**: Settings â†’ API
   - **Access token**: Account â†’ Access Tokens
3. Under Authentication â†’ URL Configuration, set **Site URL** to `https://damii-lola.github.io/3dGarments/auth/` and add `https://damii-lola.github.io/3dGarments/**` (plus `http://localhost:5173/**` while developing) to **Redirect URLs**. Supabase falls back to the Site URL whenever a redirect is not in that list, so this is the setting that decides whether a confirmation link lands on the account screen or on something unrelated.
4. Apply the schema: paste `supabase/setup.sql` into SQL Editor â†’ New query â†’ Run (it is idempotent). It creates the tables, the RLS policies, the private `garments` bucket, and `profiles` â€” the one row per account that holds the username, plus the trigger that writes it on every signup and the `username_taken()` check the signup form calls. It also creates `size_charts`: one row per garment a brand has typed in, readable by its owner only, plus `chart_by_code()` â€” a `security definer` function that returns one chart to a shopper who has the code and no account. Until this has run, the dashboard says so in words and saving is off; nothing else is affected.
5. Under Authentication â†’ Providers â†’ Email, turn **Confirm email** off. Signup then opens the scanner immediately; left on, it emails a link instead and the account screen says so.
6. Optional, and only if you keep **Confirm email** on: paste `supabase/emails/confirm-signup.html` into Authentication â†’ Email Templates â†’ **Confirm signup**. Its button is `{{ .ConfirmationURL }}`, which comes back to the account screen, picks up the session it carries and opens the scanner â€” the same destination the signup form asks for with `accountPageUrl()` in `web/src/services/auth.js`. A link that has expired or has been used once says so in words on that screen rather than leaving a blank page.

The migration in `supabase/migrations` creates the tables, RLS policies and the private `garments` bucket. CI applies it automatically.

### 2. Cloudflare Workers AI
Go to Cloudflare dashboard â†’ **AI â†’ Workers AI â†’ Use REST API**. Create a token with *Workers AI* permissions and copy the **Account ID** and the **API token**.

### 3. Render (live)
The API is running at **https://threedgarments.onrender.com**. Its secrets are stored only as Render environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. There are no `.env` files in this repo. Render redeploys on every push to `main` once CI passes.

**Who reads the frames** is one variable. `MISTRAL_API_KEY` (plus optional `MISTRAL_MODEL`, default `ministral-14b-latest`) makes the scan use Mistral's vision model; without it the scan uses Workers AI exactly as before. `VISION_PROVIDER=mistral|cloudflare` forces the choice when both keys exist. Whichever model runs, it only ever reports *where the landmarks are* â€” every centimetre after that is arithmetic in `server/src/lib/bodyGeometry.js`, on this server. `/health` reports `integrations.vision` (`provider`, `model`, `configured`, `concurrency`) so the deployment says which one it is actually using.

Check it at `https://threedgarments.onrender.com/health/deep` â†’ `"ok": true` means Supabase, Storage and Cloudflare AI are all linked. `cloudflare_ai.credentials` shows what the server is actually holding â€” the token's length, type (`cfut_` user / `cfat_` account / legacy 40-char), whether it has stray whitespace, an 8-character one-way fingerprint, and the account id â€” and `attempts` shows what Cloudflare said to each verify endpoint. `cloudflare_ai.vision` reports what Workers AI last said: `calls_today`, `lastOkAt`, and `lastError.kind` â€” `capacity` (shared GPUs busy, wait a minute), `quota` (the account's daily free neurons are spent; a new token on the same account does not reset it), or `auth` (the token was rejected â€” check `credentials.token_fingerprint` changed after editing it on Render).

### 4. GitHub
- **Settings â†’ Pages â†’ Source: GitHub Actions**
- **Settings â†’ Secrets and variables â†’ Actions**
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
| GET | `/health`, `/health/deep` | liveness, integration check |
| GET | `/api/garments` | list, with signed image URLs |
| POST | `/api/body-scan` | measure a clip: `video` (multipart â€” the default path; the server decodes it, takes 8 stills and reads them) or JPEG `frames` (multipart, `?frames=1` in the app and the automatic fallback) or `pose` landmarks measured on the device (JSON, `?local=1`). Optional `from`/`to` (the trimmed span, seconds), `chart` (the brand's size chart â€” `{ name, sex, unit, columns, rows }` â€” used only to pick a size, never to measure). Returns the measurements, the notes, and `size` / `sizeChart` / `sizeSource` |
| POST | `/api/garments` | multipart `image` returns 202 and processes in the background |
| GET / PATCH / DELETE | `/api/garments/:id` | read, rename / recategorise / fit, delete |
| POST | `/api/garments/:id/reprocess` | re-run the pipeline |
| GET / PUT | `/api/me/body` | body measurements |
| GET / POST / DELETE | `/api/me/outfits` | saved outfits |

All `/api` routes need `Authorization: Bearer <supabase access token>` â€” except
`/api/body-scan`, which is open on purpose: it measures a clip and stores nothing,
and a shopper following a brand's link has no account to present.

