# Tilal ERP - tests the migration registration mechanism (Q14) on STAGING before 227 is written.
# Builds two throw-away migrations with the real frame (sql/templates/migration_frame.sql), runs them through psql
# exactly as run-sql.ps1 does, and checks:
#   R1 a successful migration applies and registers exactly once
#   R2 re-running it is refused (MIGRATION_ALREADY_APPLIED) and changes nothing
#   R3 a migration that fails half-way leaves NO registration row and NO partial objects
#   R4 the version uses Supabase's 14-digit UTC format and sorts after every earlier version
#   R5 the idempotency key is enforced by the table's own unique constraint
# Cleans up after itself. Never touches production (guard.ps1 + staging marker).
. "$PSScriptRoot\..\guard.ps1"
$psql = Get-Psql
$work = Join-Path $PSScriptRoot '..\output\regtest'
New-Item -ItemType Directory -Force -Path $work | Out-Null
$gen = Join-Path $PSScriptRoot '..\tools\new-migration.mjs'
$okBody = Join-Path $work 'ok_body.sql'; $failBody = Join-Path $work 'fail_body.sql'
[IO.File]::WriteAllText($okBody, "create table staging_meta.regtest_ok (x int);`ninsert into staging_meta.regtest_ok values (1);", (New-Object Text.UTF8Encoding($false)))
[IO.File]::WriteAllText($failBody, "create table staging_meta.regtest_fail (x int);`nselect 1 / 0;", (New-Object Text.UTF8Encoding($false)))
$okFile = Join-Path $work '999_regtest_ok.sql'; $failFile = Join-Path $work '999_regtest_fail.sql'
Remove-Item $okFile, $failFile -ErrorAction SilentlyContinue
& node $gen '999_regtest_ok' 'registration test (ok)' $okBody $okFile | Out-Null
& node $gen '999_regtest_fail' 'registration test (fails half-way)' $failBody $failFile | Out-Null

$t = Read-StagingTarget
$conn = @('--host', $t.Host, '--port', '5432', '--username', $t.User, '--dbname', 'postgres', '--no-password')
Invoke-WithStagingPassword {
  Assert-StagingMarker $t
  $prevMax = & $psql @conn -At -c "select coalesce(max(version), '') from supabase_migrations.schema_migrations where version ~ '^\d{14}$'"
  $results = [ordered]@{}

  & $psql @conn -v ON_ERROR_STOP=1 -q -f $okFile 2>&1 | Out-Null
  $results['R1 first run succeeds'] = ($LASTEXITCODE -eq 0)

  $second = & $psql @conn -v ON_ERROR_STOP=1 -q -f $okFile 2>&1 | Out-String
  $results['R2 second run refused'] = ($LASTEXITCODE -ne 0 -and $second -match 'MIGRATION_ALREADY_APPLIED')

  & $psql @conn -v ON_ERROR_STOP=1 -q -f $failFile 2>&1 | Out-Null
  $results['R3a failing run exits non-zero'] = ($LASTEXITCODE -ne 0)

  $check = & $psql @conn -At -F '|' -c @"
select
  (select count(*) from supabase_migrations.schema_migrations where name = '999_regtest_ok'),
  (select count(*) from staging_meta.regtest_ok),
  (select count(*) from supabase_migrations.schema_migrations where name = '999_regtest_fail'),
  (to_regclass('staging_meta.regtest_fail') is null),
  (select version from supabase_migrations.schema_migrations where name = '999_regtest_ok'),
  (select count(*) from pg_constraint where conname = 'schema_migrations_idempotency_key_key')
"@
  $c = $check -split '\|'
  $results['R1 registered exactly once']          = ($c[0] -eq '1')
  $results['R2 re-run changed nothing (1 row)']   = ($c[1] -eq '1')
  $results['R3b no row for the failed migration'] = ($c[2] -eq '0')
  $results['R3c no partial objects left']         = ($c[3] -eq 't')
  $results['R4 version is 14-digit UTC']          = ($c[4] -match '^\d{14}$')
  $results['R4 version sorts after previous max'] = ([string]::CompareOrdinal($c[4], $prevMax) -gt 0)
  $results['R5 unique idempotency constraint']    = ($c[5] -eq '1')

  # cleanup
  & $psql @conn -q -c "delete from supabase_migrations.schema_migrations where idempotency_key in ('tilal:999_regtest_ok','tilal:999_regtest_fail'); drop table if exists staging_meta.regtest_ok; drop table if exists staging_meta.regtest_fail;" | Out-Null

  $fail = 0
  foreach ($k in $results.Keys) {
    if ($results[$k]) { Write-Host "PASS  $k" -ForegroundColor Green } else { Write-Host "FAIL  $k" -ForegroundColor Red; $fail++ }
  }
  if ($fail) { throw "$fail registration test(s) failed - do NOT write 227 with this frame." }
  Write-Host 'Registration mechanism: all tests passed.' -ForegroundColor Green
}
