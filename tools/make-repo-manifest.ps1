param(
  [Parameter(Mandatory=$true)][string]$ZipPath
)

if (-not (Test-Path $ZipPath)) { throw "File not found: $ZipPath" }

$md5 = (Get-FileHash -Algorithm MD5 $ZipPath).Hash.ToLowerInvariant()
$ts  = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

$manifestPath = Join-Path $PSScriptRoot "..\repo\manifest.json"
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$manifest[0].versions[0].checksum  = $md5
$manifest[0].versions[0].timestamp = $ts
$manifest | ConvertTo-Json -Depth 20 | Set-Content $manifestPath -Encoding utf8

Write-Host "Updated $manifestPath checksum=$md5 timestamp=$ts"
