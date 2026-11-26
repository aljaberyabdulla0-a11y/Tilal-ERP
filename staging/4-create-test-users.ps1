# Tilal ERP - create the synthetic test users in STAGING Auth (never production).
# Asks for the staging ref/host/password (to check the marker) and the staging service_role key, all through secure prompts.
# Nothing is written to files except output/test-users.json (emails, ids, generated passwords) which is git-ignored.
. "$PSScriptRoot\guard.ps1"
$t = Read-StagingTarget
Invoke-WithStagingPassword { Assert-StagingMarker $t }

$secure = Read-Host 'STAGING service_role key (Supabase > Project Settings > API keys)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:STAGING_URL = "https://$($t.Ref).supabase.co"
  $env:STAGING_REF = $t.Ref
  $env:STAGING_SERVICE_ROLE_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  Assert-NotProduction $env:STAGING_URL 'Staging URL'
  & node (Join-Path $PSScriptRoot 'fixtures\create-test-users.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'create-test-users failed' }
} finally {
  Remove-Item Env:STAGING_SERVICE_ROLE_KEY, Env:STAGING_URL, Env:STAGING_REF -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
