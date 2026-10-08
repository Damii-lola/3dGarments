# 3dGarments

**An embeddable 3D Virtual Fitting Room for e-commerce.** Merchants add a script tag and the widget replaces the last static image in a product gallery with an interactive 3D mannequin. Shoppers match the mannequin to their own proportions (height, weight, bust, waist, hips, thighs, shoulders …, with live girth readouts) to see how a garment will sit on a body like theirs — fewer sizing guesses, fewer returns, longer time on the product page. Brands can also show a digital twin of a garment before it is manufactured (pre-order validation).

Today the repo holds the fitting-room core: male and female mannequins with real-measurement shape controls, garment photo upload and the garment-processing pipeline. The embeddable widget, the merchant dashboard and billing are what comes next.

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

## One-time setup (about 10 minutes)

### 1. Supabase
1. Create a project at [supabase.com](https://supabase.com/dashboard). Pick the closest region (eu-west works well for Nigeria) and save the DB password.
2. Collect these values:
   - **Project ref**: Settings → General
   - **URL**, **anon key** and **service_role key**: Settings → API
   - **Access token**: Account → Access Tokens
3. Under Authentication → URL Configuration, set **Site URL** to `https://damii-lola.github.io/3dGarments/`.

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
| POST | `/api/garments` | multipart `image` returns 202 and processes in the background |
| GET / PATCH / DELETE | `/api/garments/:id` | read, rename / recategorise / fit, delete |
| POST | `/api/garments/:id/reprocess` | re-run the pipeline |
| GET / PUT | `/api/me/body` | body measurements |
| GET / POST / DELETE | `/api/me/outfits` | saved outfits |

All `/api` routes need `Authorization: Bearer <supabase access token>`.
