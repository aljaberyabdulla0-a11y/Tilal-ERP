# Tilal ERP - run the Next.js app locally against STAGING (port 3100), never production.
# Next.js gives real process environment variables priority over .env.local, so the production values in
# .env.local are overridden for this process only. The anon key is asked through a secure prompt.
. "$PSScriptRoot\guard.ps1"
$ref = Read-Host 'Staging project ref'
Assert-NotProduction $ref 'Staging ref'
if ($ref -notmatch '^[a-z]{20}$') { throw 'A project ref is 20 lowercase letters.' }
$secure = Read-Host 'STAGING anon/publishable key' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:NEXT_PUBLIC_SUPABASE_URL = "https://$ref.supabase.co"
  $env:NEXT_PUBLIC_SUPABASE_ANON_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $env:ANTHROPIC_API_KEY = ''   # no AI calls from staging
  Assert-NotProduction $env:NEXT_PUBLIC_SUPABASE_URL 'App URL'
  Write-Host "App -> $env:NEXT_PUBLIC_SUPABASE_URL on http://localhost:3100" -ForegroundColor Cyan
  Push-Location (Split-Path $PSScriptRoot -Parent)
  try { & npx next dev -p 3100 } finally { Pop-Location }
} finally {
  Remove-Item Env:NEXT_PUBLIC_SUPABASE_URL, Env:NEXT_PUBLIC_SUPABASE_ANON_KEY, Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
