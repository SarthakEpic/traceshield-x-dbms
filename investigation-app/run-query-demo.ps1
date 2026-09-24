[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$DatabaseUrl = $env:TRACESHIELD_DATABASE_URL,

    [Parameter(Mandatory = $false)]
    [string]$CaseId = '11111111-1111-4111-8111-111111111111',

    [Parameter(Mandatory = $false)]
    [string]$InvestigatorId = '1',

    [Parameter(Mandatory = $false)]
    [string]$InstitutionId = '101',

    [Parameter(Mandatory = $false)]
    [string]$PsqlPath = 'psql',

    [Parameter(Mandatory = $false)]
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'query-output')
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
    throw @'
DatabaseUrl is required. Set it once with:
  $env:PGPASSWORD = "your_password"
  $env:TRACESHIELD_DATABASE_URL = "postgresql://postgres@localhost:5432/traceshield"
or pass -DatabaseUrl directly to this script.
'@
}

$queryFile = Join-Path $PSScriptRoot 'investigation_queries.sql'
if (-not (Test-Path -LiteralPath $queryFile)) {
    throw "Query file was not found: $queryFile"
}

$psqlCommand = Get-Command $PsqlPath -ErrorAction SilentlyContinue
if ($null -eq $psqlCommand) {
    throw @"
PostgreSQL's psql client was not found. Install PostgreSQL or pass its full path,
for example:
  -PsqlPath 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
"@
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outputFile = Join-Path $OutputDirectory "executed-queries-$stamp.txt"
$displayDatabaseUrl = $DatabaseUrl -replace '://([^:/]+):([^@]+)@', '://$1:****@'

Write-Host "Running the TraceShield X PostgreSQL query pack..." -ForegroundColor Cyan
Write-Host "Database: $displayDatabaseUrl"
Write-Host "Case: $CaseId"
Write-Host "Transcript: $outputFile"
Write-Host ""

$arguments = @(
    '-X',
    '-v', 'ON_ERROR_STOP=1',
    '-P', 'pager=off',
    '-P', 'border=2',
    '-v', "investigator_id=$InvestigatorId",
    '-v', "institution_id=$InstitutionId",
    '-v', "case_id=$CaseId",
    '-d', $DatabaseUrl,
    '-f', $queryFile
)

& $psqlCommand.Source @arguments 2>&1 | Tee-Object -FilePath $outputFile
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    throw "The query pack failed with exit code $exitCode. Review the transcript: $outputFile"
}

Write-Host ""
Write-Host "Completed successfully. Use this transcript as executed-query evidence:" -ForegroundColor Green
Write-Host (Resolve-Path -LiteralPath $outputFile).Path -ForegroundColor Green
