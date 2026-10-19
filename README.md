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
  measurements.
- `/size/?g=CODE&embed=1` — the same page inside a popup: the bar is reduced to
  the centred logo, the sky comes off, and the whole tool is drawn 60% smaller
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
5. Under Authentication → Providers → Email, turn **Confirm email** off. Signup then opens the scanner immediately; left on, it emails a link instead and the account screen says so.
6. Optional, and only if you keep **Confirm email** on: paste `supabase/emails/confirm-signup.html` into Authentication → Email Templates → **Confirm signup**. Its button is `{{ .ConfirmationURL }}`, which comes back to the account screen, picks up the session it carries and opens the scanner — the same destination the signup form asks for with `accountPageUrl()` in `web/src/services/auth.js`. A link that has expired or has been used once says so in words on that screen rather than leaving a blank page.

The migration in `supabase/migrations` creates the tables, RLS policies and the private `garments` bucket. CI applies it automatically.

### 2. Cloudflare Workers AI
Go to Cloudflare dashboard → **AI → Workers AI → Use REST API**. Create a token with *Workers AI* permissions and copy the **Account ID** and the **API token**.

### 3. Render (live)
The API is running at **https://threedgarments.onrender.com**. Its secrets are stored only as Render environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. There are no `.env` files in this repo. Render redeploys on every push to `main` once CI passes.

Check it at `https://threedgarments.onrender.com/health/deep` → `"ok": true` means Supabase, Storage and Cloudflare AI are all linked.

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
| GET | `/health`, `/health/deep` | liveness, integration check |
| GET | `/api/garments` | list, with signed image URLs |
| POST | `/api/body-scan` | measure a clip: on-device `pose` landmarks (JSON) or JPEG `frames` (multipart). Optional `gender` (the shopper's own answer) and `chart` (the brand's size chart — `{ name, sex, unit, columns, rows }` — used only to pick a size, never to measure). Returns the measurements, the notes, and `size` / `sizeChart` / `sizeSource` |
| POST | `/api/garments` | multipart `image` returns 202 and processes in the background |
| GET / PATCH / DELETE | `/api/garments/:id` | read, rename / recategorise / fit, delete |
| POST | `/api/garments/:id/reprocess` | re-run the pipeline |
| GET / PUT | `/api/me/body` | body measurements |
| GET / POST / DELETE | `/api/me/outfits` | saved outfits |

All `/api` routes need `Authorization: Bearer <supabase access token>` — except
`/api/body-scan`, which is open on purpose: it measures a clip and stores nothing,
and a shopper following a brand's link has no account to present.
