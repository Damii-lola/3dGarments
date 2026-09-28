# 3dGarments

**Snap it. Wear it.** Take a photo of any top, dress or pair of trousers. 3dGarments cuts the garment out, measures it, and wraps it around a 3D model you can spin, size and restyle.

```
 phone camera ──► GitHub Pages (Vite + three.js)
                    │  Supabase Auth (JWT)
                    ▼
               Render (Express API) ──► Cloudflare Workers AI (garment recognition)
                    │
                    ▼
               Supabase (Postgres + private Storage)
```

The web app also runs fully **offline / local mode**: the same silhouette engine runs in the browser, so it works with no backend configured.

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

### 3. Render
Go to [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint** → select this repo. `render.yaml` creates `3dgarments-api`. Paste the four secrets it asks for (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`).
Render redeploys on every push to `main` once CI passes.

### 4. Link everything
```bash
cp .env.deploy.example .env.deploy     # fill it in (this file is git-ignored)
./scripts/link.sh                      # sets GitHub secrets/variables, Render env, enables Pages, runs deploys
```
If you'd rather click through it:
- **GitHub → Settings → Secrets and variables → Actions**
  - Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`
  - Variables: `VITE_API_URL` (your Render URL), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- **GitHub → Settings → Pages → Source: GitHub Actions**

### 5. Verify
```bash
cd server && cp ../.env.deploy .env && npm i && npm run verify
```
This checks the Supabase tables and bucket, a Cloudflare text call, a Cloudflare vision call, and the deployed API's `/health/deep`.

## Local development
```bash
cd server && npm i && cp .env.example .env && npm run dev    # http://localhost:8787
cd web && npm i && cp .env.example .env.local && npm run dev  # http://localhost:5173
```
To try it without any keys, open `http://localhost:5173/?demo=tee,jeans`.

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
