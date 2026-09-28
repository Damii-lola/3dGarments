#!/usr/bin/env bash
# Wire GitHub ↔ Render ↔ Supabase ↔ Cloudflare AI in one go.
#   cp .env.deploy.example .env.deploy   # fill it in
#   ./scripts/link.sh
# Needs: gh (logged in), curl, node.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${1:-.env.deploy}"
[ -f "$ENV_FILE" ] || { echo "✖ $ENV_FILE not found — copy .env.deploy.example first"; exit 1; }
set -a; . "$ENV_FILE"; set +a

ok()   { printf '  \033[32m✔\033[0m %s\n' "$1"; }
skip() { printf '  \033[33m–\033[0m %s\n' "$1"; }
need() { [ -n "${!1:-}" ]; }

echo; echo "GitHub → $GITHUB_REPO"
command -v gh >/dev/null || { echo "✖ install the GitHub CLI: https://cli.github.com"; exit 1; }
for k in SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_PROJECT_REF; do
  if need "$k"; then gh secret set "$k" -R "$GITHUB_REPO" -b "${!k}" >/dev/null && ok "secret $k"; else skip "secret $k (empty)"; fi
done
declare -A VARS=([VITE_API_URL]="${API_URL:-}" [VITE_SUPABASE_URL]="${SUPABASE_URL:-}" [VITE_SUPABASE_ANON_KEY]="${SUPABASE_ANON_KEY:-}")
for k in "${!VARS[@]}"; do
  if [ -n "${VARS[$k]}" ]; then gh variable set "$k" -R "$GITHUB_REPO" -b "${VARS[$k]}" >/dev/null && ok "variable $k"; else skip "variable $k (empty)"; fi
done
if gh api -X POST "repos/$GITHUB_REPO/pages" -f build_type=workflow >/dev/null 2>&1; then ok "GitHub Pages enabled (Actions)";
else gh api -X PUT "repos/$GITHUB_REPO/pages" -f build_type=workflow >/dev/null 2>&1 && ok "GitHub Pages set to Actions" || skip "GitHub Pages (enable manually: Settings → Pages → Source: GitHub Actions)"; fi

echo; echo "Render"
if need RENDER_API_KEY && need RENDER_SERVICE_ID; then
  body=$(node -e '
    const e = process.env;
    const pairs = {
      NODE_VERSION: "22", NODE_ENV: "production",
      CORS_ORIGINS: `https://${e.GITHUB_REPO.split("/")[0].toLowerCase()}.github.io,http://localhost:5173`,
      SUPABASE_URL: e.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: e.SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET: "garments",
      CLOUDFLARE_ACCOUNT_ID: e.CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN: e.CLOUDFLARE_API_TOKEN,
      CF_VISION_MODEL: "@cf/meta/llama-4-scout-17b-16e-instruct",
    };
    console.log(JSON.stringify(Object.entries(pairs).filter(([, v]) => v).map(([key, value]) => ({ key, value }))));')
  code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "https://api.render.com/v1/services/$RENDER_SERVICE_ID/env-vars" \
    -H "Authorization: Bearer $RENDER_API_KEY" -H 'Content-Type: application/json' -d "$body")
  [ "$code" = 200 ] && ok "env vars set on $RENDER_SERVICE_ID" || { echo "  ✖ Render env update failed (HTTP $code)"; exit 1; }
  curl -s -o /dev/null -X POST "https://api.render.com/v1/services/$RENDER_SERVICE_ID/deploys" \
    -H "Authorization: Bearer $RENDER_API_KEY" -H 'Content-Type: application/json' -d '{"clearCache":"do_not_clear"}' && ok "deploy triggered"
else
  skip "RENDER_API_KEY / RENDER_SERVICE_ID empty — set env vars in the Render dashboard instead"
fi

echo; echo "Kick off workflows"
gh workflow run supabase.yml -R "$GITHUB_REPO" >/dev/null 2>&1 && ok "Supabase migrations running" || skip "supabase.yml (push to main first)"
gh workflow run deploy-web.yml -R "$GITHUB_REPO" >/dev/null 2>&1 && ok "web deploy running" || skip "deploy-web.yml (push to main first)"

echo; echo "Done. Verify everything with:  (cd server && cp ../.env.deploy .env && npm run verify)"
