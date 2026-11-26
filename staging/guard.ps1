# Tilal ERP - shared guard for every staging script. Dot-source it: . "$PSScriptRoot\guard.ps1"
# Rule: nothing that writes may ever reach production. Production is identified by its project ref.
$ErrorActionPreference = 'Stop'
$ProdRef = 'edgblrqkushnznhmuxln'

function Assert-NotProduction([string]$Text, [string]$What) {
  if ([string]::IsNullOrWhiteSpace($Text)) { throw "$What is empty." }
  if ($Text -match [regex]::Escape($ProdRef)) {
    throw "STOP: $What points to PRODUCTION ($ProdRef). Staging scripts never write to production."
  }
}

function Read-StagingTarget {
  # The owner types the staging ref and pooler host each time. Nothing is stored in files.
  $ref = Read-Host 'Staging project ref (Supabase > Project Settings > General)'
  if ($ref -notmatch '^[a-z]{20}$') { throw 'A project ref is 20 lowercase letters.' }
  Assert-NotProduction $ref 'Staging ref'
  $dbHost = Read-Host 'Staging Session pooler host'
  Assert-NotProduction $dbHost 'Staging host'
  $dbUser = Read-Host "Staging database user (postgres.$ref)"
  Assert-NotProduction $dbUser 'Staging user'
  if ($dbUser -notmatch [regex]::Escape($ref)) { throw "User '$dbUser' does not belong to staging ref $ref." }
  return @{ Ref = $ref; Host = $dbHost; User = $dbUser }
}

function Invoke-WithStagingPassword([scriptblock]$Body) {
  $secure = Read-Host 'Staging database password' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    $env:PGSSLMODE = 'require'
    & $Body
  } finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Get-Psql {
  $psql = (Get-Command psql -ErrorAction SilentlyContinue).Source
  if (-not $psql) { throw 'psql not found. Install PostgreSQL 17 client tools (see staging/README.md).' }
  if ((& $psql --version) -notmatch ' 17\.') { throw 'psql 17 is required.' }
  return $psql
}

function Assert-StagingMarker($Target) {
  # Second line of defence: the database itself must carry the staging marker created by 00_bootstrap.sql.
  $psql = Get-Psql
  $q = "select coalesce((select name from staging_meta.environment limit 1), 'NONE')"
  $r = & $psql --host $Target.Host --port 5432 --username $Target.User --dbname postgres --no-password -At -c $q 2>$null
  if ($LASTEXITCODE -ne 0 -or $r -ne 'staging') {
    throw "STOP: target database has no staging marker (got '$r'). Run 3-restore.ps1 step 0 first, on the STAGING project only."
  }
}
