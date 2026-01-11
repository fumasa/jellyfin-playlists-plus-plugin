param(
  [Parameter(Mandatory=$true)][string]$ZipPath,
  [string]$Version
)

if (-not (Test-Path $ZipPath)) { throw "File not found: $ZipPath" }

if (-not $Version) {
  if ($ZipPath -match "_v([0-9]+\\.[0-9]+\\.[0-9]+(\\.[0-9]+)?)\\.zip$") {
    $Version = $Matches[1]
  } else {
    throw "Version not provided and could not be parsed from filename."
  }
}

$manifestVersion = $Version
if ($Version.Split('.').Count -eq 3) {
  $manifestVersion = "$Version.0"
}

$md5 = (Get-FileHash -Algorithm MD5 $ZipPath).Hash.ToUpperInvariant()
$ts  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd")

$manifestPath = Join-Path $PSScriptRoot "..\manifest.json"
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json

$guid = "b9b9a50f-8b3a-4d2a-9c0e-7e2d0d7c2d73"
$plugin = $manifest | Where-Object { $_.guid -eq $guid } | Select-Object -First 1
if (-not $plugin) { throw "Plugin GUID not found in manifest.json" }

$repo = $env:GITHUB_REPOSITORY
if (-not $repo) { $repo = "fumasa/jellyfin-playlists-plus-plugin" }
$tag = "v$Version"
$sourceUrl = "https://github.com/$repo/releases/download/$tag/Jellyfin.Plugin.PlaylistsPlus_v$Version.zip"
$changelog = "https://github.com/$repo/releases/tag/$tag"

$versions = @()
if ($plugin.versions) {
  $versions = @($plugin.versions | Where-Object { $_.version -ne $manifestVersion })
}
$versions = @(
  @{
    version = $manifestVersion
    changelog = $changelog
    targetAbi = "10.10.3.0"
    sourceUrl = $sourceUrl
    checksum = $md5
    timestamp = $ts
  }
) + $versions

$plugin.versions = $versions
$manifest | ConvertTo-Json -Depth 20 | Set-Content $manifestPath -Encoding utf8

Write-Host "Updated $manifestPath version=$manifestVersion checksum=$md5 timestamp=$ts"
