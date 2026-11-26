# Tilal ERP - READ-ONLY export from production for building staging.
# Produces: structure (no rows), managed-schema customisations, sanitised reference data, inventory.
# Run by the owner on the owner's machine. The password is read from a secure prompt and never written to disk.
# Every connection is forced read-only (default_transaction_read_only=on). Nothing here can write to production.
# Based on C:\dev\Tilal-Next15-Upgrade\schema-dump\1-run-schema-dump.ps1 (2026-11-07).
$ErrorActionPreference = 'Stop'
$ProdRef = 'edgblrqkushnznhmuxln'
$Out = Join-Path $PSScriptRoot 'output'

$pgDump = (Get-Command pg_dump -ErrorAction SilentlyContinue).Source
$psql = (Get-Command psql -ErrorAction SilentlyContinue).Source
if (-not $pgDump -or -not $psql) { throw 'pg_dump/psql not found. See staging/README.md (PostgreSQL 17 client tools).' }
if ((& $pgDump --version) -notmatch ' 17\.') { throw 'pg_dump 17 is required.' }

Write-Host "Source = PRODUCTION ($ProdRef), read-only." -ForegroundColor Yellow
$dbHost = Read-Host 'Production Session pooler host (Supabase > Connect > Session pooler)'
$dbUser = Read-Host "Production database user (postgres.$ProdRef)"
if ($dbUser -notmatch [regex]::Escape($ProdRef)) { throw "User does not reference project $ProdRef. Stopping." }
$secure = Read-Host 'Production database password' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
New-Item -ItemType Directory -Force -Path $Out | Out-Null
try {
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $env:PGSSLMODE = 'require'
  $env:PGOPTIONS = '-c default_transaction_read_only=on'
  $conn = @('--host', $dbHost, '--port', '5432', '--username', $dbUser, '--dbname', 'postgres', '--no-password')

  # 1) App schemas: tables, views, sequences, indexes, constraints, functions, triggers, RLS, grants, default privileges. NO rows.
  & $pgDump @conn --schema-only --no-owner --schema=public --schema=tests --file (Join-Path $Out 'schema_public_tests.sql')
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed on public/tests' }

  # 2) Managed-schema customisations (triggers on auth.users, storage/realtime policies). Filtered later by tools/extract-managed.mjs.
  & $pgDump @conn --schema-only --no-owner --table=auth.users --table=storage.objects --table=storage.buckets --table=realtime.messages --file (Join-Path $Out 'schema_managed_tables.sql')
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed on managed tables' }

  # 3) Reference/configuration data only (allow-list, personal columns stripped). See sql/reference_data_export.sql.
  & $psql @conn -v ON_ERROR_STOP=1 -At -q -f (Join-Path $PSScriptRoot 'sql\reference_data_export.sql') -o (Join-Path $Out 'reference_data.sql')
  if ($LASTEXITCODE -ne 0) { throw 'reference data export failed' }

  # 4) Inventory for the checklist and the verifier: table list, extensions, bucket ids, cron job NAMES (no commands).
  & $psql @conn -v ON_ERROR_STOP=1 -At -q -f (Join-Path $PSScriptRoot 'sql\inventory_export.sql') -o (Join-Path $Out 'inventory.json')
  if ($LASTEXITCODE -ne 0) { throw 'inventory export failed' }

  Get-ChildItem $Out -File | Where-Object { $_.Name -ne 'SHA256.txt' } | Get-FileHash -Algorithm SHA256 |
    ForEach-Object { "$($_.Hash)  $(Split-Path $_.Path -Leaf)" } | Set-Content (Join-Path $Out 'SHA256.txt')
  Write-Host 'Done. Next: node staging/2-verify-export.mjs' -ForegroundColor Green
} finally {
  Remove-Item Env:PGPASSWORD, Env:PGOPTIONS -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
