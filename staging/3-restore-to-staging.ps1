# Tilal ERP - restore the verified export into the STAGING project.
# Order: 0 bootstrap (marker) -> 1 structure -> 2 managed customisations -> 3 reference data -> 4 staging settings.
# Every step after 0 checks the staging marker inside the target database first. Production can never be the target:
# the ref/host/user are checked against the production ref, and production has no marker.
. "$PSScriptRoot\guard.ps1"
$Out = Join-Path $PSScriptRoot 'output'
$psql = Get-Psql

foreach ($f in 'schema_public_tests.sql', 'schema_managed_tables.sql', 'reference_data.sql', 'inventory.json') {
  if (-not (Test-Path (Join-Path $Out $f))) { throw "Missing output/$f. Run 1-export-from-production.ps1 first." }
}
Write-Host 'Checking the export before restoring...' -ForegroundColor Cyan
& node (Join-Path $PSScriptRoot '2-verify-export.mjs') $Out
if ($LASTEXITCODE -ne 0) { throw 'Export verification is NOT READY. Fix it before restoring.' }
& node (Join-Path $PSScriptRoot 'tools\extract-managed.mjs') $Out
if ($LASTEXITCODE -ne 0) { throw 'extract-managed failed' }

# pg_dump 17 emits "CREATE SCHEMA public;" when -n public is used; the new project already has it.
$schemaIn = Join-Path $Out 'schema_public_tests.sql'
$schemaFix = Join-Path $Out 'schema_public_tests.restore.sql'
$guardLine = "do `$g`$ begin if coalesce((select name from staging_meta.environment limit 1), '') <> 'staging' then raise exception 'STOP: not a staging database'; end if; end `$g`$;"
$body = (Get-Content -Raw -Encoding UTF8 $schemaIn) -replace '(?m)^CREATE SCHEMA public;\s*$', '-- (staging) CREATE SCHEMA public; skipped: exists in every Supabase project'
[IO.File]::WriteAllText($schemaFix, $guardLine + "`n" + $body, (New-Object Text.UTF8Encoding($false)))  # UTF-8 without BOM for psql

$t = Read-StagingTarget
$conn = @('--host', $t.Host, '--port', '5432', '--username', $t.User, '--dbname', 'postgres', '--no-password', '-v', 'ON_ERROR_STOP=1')

Invoke-WithStagingPassword {
  $step0 = Read-Host 'Run step 0 (bootstrap marker) now? Only on a NEW, EMPTY staging project [y/N]'
  if ($step0 -eq 'y') {
    & $psql @conn -1 -f (Join-Path $PSScriptRoot 'sql\00_bootstrap.sql')
    if ($LASTEXITCODE -ne 0) { throw 'bootstrap failed' }
  }
  Assert-StagingMarker $t

  $steps = @(
    @{ n = '1 structure';         f = $schemaFix },
    @{ n = '2 managed';           f = (Join-Path $Out 'managed_restore.sql') },
    @{ n = '3 reference data';    f = (Join-Path $Out 'reference_data.sql') },
    @{ n = '4 staging settings';  f = (Join-Path $PSScriptRoot 'sql\20_staging_settings.sql') }
  )
  foreach ($s in $steps) {
    Assert-StagingMarker $t
    Write-Host "Step $($s.n) ..." -ForegroundColor Cyan
    & $psql @conn -1 -q -f $s.f
    if ($LASTEXITCODE -ne 0) { throw "Step $($s.n) failed. The step ran in one transaction, so nothing from it was kept." }
  }
  Write-Host 'Restore done. Next: 4-create-test-users.ps1, then fixtures/10_synthetic_seed.sql via run-sql.ps1' -ForegroundColor Green
}
