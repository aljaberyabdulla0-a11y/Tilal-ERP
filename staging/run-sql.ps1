# Tilal ERP - apply ONE SQL file to STAGING (migrations under test, fixtures, test runs).
# Usage: powershell -ExecutionPolicy Bypass -File staging\run-sql.ps1 -File sql\227_ops_foundation.sql [-NoTransaction]
# The file runs in a single transaction (psql -1) unless -NoTransaction. The target must carry the staging marker.
param(
  [Parameter(Mandatory = $true)][string]$File,
  [switch]$NoTransaction
)
. "$PSScriptRoot\guard.ps1"
if (-not (Test-Path $File)) { throw "File not found: $File" }
$psql = Get-Psql
$t = Read-StagingTarget
$conn = @('--host', $t.Host, '--port', '5432', '--username', $t.User, '--dbname', 'postgres', '--no-password', '-v', 'ON_ERROR_STOP=1')
Invoke-WithStagingPassword {
  Assert-StagingMarker $t
  $args1 = @($conn)
  # Migrations built from sql/templates/migration_frame.sql own their transaction (begin ... commit):
  # wrapping them in psql -1 would let the inner COMMIT end the outer transaction early.
  $ownsTx = (Get-Content -Raw -Encoding UTF8 $File) -match '(?im)^\s*begin\s*;'
  if (-not $NoTransaction -and -not $ownsTx) { $args1 += '-1' }
  Write-Host "Applying $File to STAGING ($($t.Ref)) ..." -ForegroundColor Cyan
  & $psql @args1 -f $File
  if ($LASTEXITCODE -ne 0) { throw "Failed: $File" }
  Write-Host 'OK' -ForegroundColor Green
}
