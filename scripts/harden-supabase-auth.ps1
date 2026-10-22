# Apply the hardened Supabase Auth config to the hosted project via the Management API.
# Leaked-password (HIBP) protection + min length can't be set via SQL or config.toml
# alone, so this patches the live project. Requires a Supabase personal access token
# (https://supabase.com/dashboard/account/tokens) with auth_config_write + project_admin_write.
#
# Usage:
#   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
#   .\scripts\harden-supabase-auth.ps1
param(
  [string]$ProjectRef = "yzqmpyxfwcqreymbqrhc",
  [string]$Token = $env:SUPABASE_ACCESS_TOKEN
)
if (-not $Token) { throw "Set SUPABASE_ACCESS_TOKEN or pass -Token" }

$body = @{
  password_hibp_enabled             = $true   # leaked-password protection (Pro plan+)
  password_min_length                = 8
  mailer_otp_exp                     = 600     # 10 minutes (login code validity)
  mailer_otp_length                  = 8
  mailer_secure_email_change_enabled  = $true
  mailer_autoconfirm                 = $false  # email confirmation stays ON
  rate_limit_otp                     = 10     # sign-in / sign-up per 5 min per IP
  rate_limit_verify                  = 10     # OTP verify per hour per IP
  rate_limit_token_refresh           = 60
  external_anonymous_users_enabled   = $false
} | ConvertTo-Json -Depth 3

Invoke-RestMethod -Method Patch `
  -Uri "https://api.supabase.com/v1/projects/$ProjectRef/config/auth" `
  -Headers @{ Authorization = "Bearer $Token"; "Content-Type" = "application/json" } `
  -Body $body
Write-Host "Done. Set password required characters + HIBP in Dashboard if the plan blocks it."