param(
  [string]$Origin = 'https://localhost',
  [Parameter(Mandatory)][string]$CaseId,
  [Parameter(Mandatory)][string]$DlsaUser,
  [Parameter(Mandatory)][string]$JailUser,
  [string]$CaFile,
  [string]$OrderOn = (Get-Date -Format yyyy-MM-dd)
)
$ErrorActionPreference = 'Stop'
$previousCa = $env:NODE_EXTRA_CA_CERTS
try {
  if ($CaFile) { $env:NODE_EXTRA_CA_CERTS = (Resolve-Path -LiteralPath $CaFile).Path }
  if (-not $env:COURTPLUS_SMOKE_DLSA_PASSWORD) {
    $secret = Read-Host "Password for $DlsaUser" -AsSecureString
    $env:COURTPLUS_SMOKE_DLSA_PASSWORD = [Net.NetworkCredential]::new('', $secret).Password
  }
  if (-not $env:COURTPLUS_SMOKE_JAIL_PASSWORD) {
    $secret = Read-Host "Password for $JailUser" -AsSecureString
    $env:COURTPLUS_SMOKE_JAIL_PASSWORD = [Net.NetworkCredential]::new('', $secret).Password
  }
  node (Join-Path $PSScriptRoot 'smoke.mjs') $Origin $CaseId $DlsaUser $JailUser $OrderOn
  if ($LASTEXITCODE -ne 0) { throw "Smoke failed with exit code $LASTEXITCODE" }
} finally {
  $env:NODE_EXTRA_CA_CERTS = $previousCa
  Remove-Item Env:COURTPLUS_SMOKE_DLSA_PASSWORD,Env:COURTPLUS_SMOKE_JAIL_PASSWORD -ErrorAction SilentlyContinue
}
