# Installs the better-update CLI on Windows: a single standalone .exe (no Node, no Bun).
#
#   powershell -ExecutionPolicy ByPass -c "irm https://raw.githubusercontent.com/aislopware/better-update/main/install.ps1 | iex"
#
# Environment:
#   BETTER_UPDATE_VERSION      version to install (default: latest CLI release)
#   BETTER_UPDATE_INSTALL_DIR  where the binary goes (default: ~\.local\bin, the
#                              per-user bin dir uv and friends use on Windows too)
#   BETTER_UPDATE_REPO         GitHub owner/repo to download from
#                              (default: aislopware/better-update; a fork that
#                              ships its own binaries points this at itself)
#   BETTER_UPDATE_NO_MODIFY_PATH  set to 1 to leave the user PATH alone
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repo = if ($env:BETTER_UPDATE_REPO) { $env:BETTER_UPDATE_REPO } else { 'aislopware/better-update' }
$InstallDir = if ($env:BETTER_UPDATE_INSTALL_DIR) { $env:BETTER_UPDATE_INSTALL_DIR } else { Join-Path $HOME '.local\bin' }
$TagPrefix = '@better-update/cli@'

function Fail([string] $Message) {
  Write-Error "install: $Message"
  exit 1
}

# --- target -----------------------------------------------------------------
# Only x64 is built; Windows on Arm runs it under its x64 emulation.
$arch = $env:PROCESSOR_ARCHITEW6432
if (-not $arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
if ($arch -ne 'AMD64' -and $arch -ne 'ARM64') { Fail "unsupported architecture: $arch (64-bit Windows only)" }
$target = 'windows-x64'

# --- version ----------------------------------------------------------------
$version = $env:BETTER_UPDATE_VERSION
if (-not $version) {
  # publish-cli marks every CLI release as the repo's "latest"; the
  # /releases/latest redirect names it without spending REST API rate limit.
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/$Repo/releases/latest"
    # Windows PowerShell 5.1 exposes the final URL as ResponseUri, PowerShell 7 on the request.
    $final = $response.BaseResponse.ResponseUri
    if (-not $final) { $final = $response.BaseResponse.RequestMessage.RequestUri }
    $tag = [Uri]::UnescapeDataString(($final.AbsoluteUri -replace '^.*/releases/tag/', ''))
    if ($tag.StartsWith($TagPrefix)) { $version = $tag.Substring($TagPrefix.Length) }
  } catch { }
}
if (-not $version) {
  # Fallback: releases are listed newest first and mix every package's tags.
  $headers = @{ Accept = 'application/vnd.github+json' }
  if ($env:GITHUB_TOKEN) { $headers.Authorization = "Bearer $env:GITHUB_TOKEN" }
  $releases = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$Repo/releases?per_page=30"
  $cli = $releases | Where-Object { $_.tag_name.StartsWith($TagPrefix) -and -not $_.draft -and -not $_.prerelease } | Select-Object -First 1
  if (-not $cli) { Fail "could not determine the latest release of $Repo (set BETTER_UPDATE_VERSION to skip the lookup)" }
  $version = $cli.tag_name.Substring($TagPrefix.Length)
}
$version = $version.TrimStart('v')

# --- download ---------------------------------------------------------------
$asset = "better-update-$target.exe"
$base = "https://github.com/$Repo/releases/download/$([Uri]::EscapeDataString("$TagPrefix$version"))"
$tmp = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Write-Host "Downloading better-update $version ($target)..."
  $file = Join-Path $tmp $asset
  try { Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile $file } catch { Fail "download failed: $base/$asset" }

  $sums = Join-Path $tmp 'SHA256SUMS'
  $haveSums = $true
  try { Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile $sums } catch { $haveSums = $false }
  if ($haveSums) {
    $line = Get-Content $sums | Where-Object { $_ -match "\s\*?$([Regex]::Escape($asset))$" } | Select-Object -First 1
    if ($line) {
      $expected = ($line -split '\s+')[0].ToLowerInvariant()
      $actual = (Get-FileHash -Algorithm SHA256 $file).Hash.ToLowerInvariant()
      if ($expected -ne $actual) { Fail "checksum mismatch for $asset" }
    }
  }

  # --- install --------------------------------------------------------------
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  $dest = Join-Path $InstallDir 'better-update.exe'
  # A running better-update.exe cannot be overwritten, but it can be renamed.
  if (Test-Path $dest) {
    $old = "$dest.old"
    Remove-Item -Force $old -ErrorAction SilentlyContinue
    Move-Item -Force $dest $old
  }
  Move-Item -Force $file $dest
  Remove-Item -Force "$dest.old" -ErrorAction SilentlyContinue
  Write-Host "Installed better-update $version to $dest"
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$entries = @($userPath -split ';' | Where-Object { $_ })
if ($entries -notcontains $InstallDir) {
  if ($env:BETTER_UPDATE_NO_MODIFY_PATH -eq '1') {
    Write-Host ""
    Write-Host "Add $InstallDir to your PATH to run better-update."
  } else {
    [Environment]::SetEnvironmentVariable('Path', (@($InstallDir) + $entries) -join ';', 'User')
    $env:Path = "$InstallDir;$env:Path"
    Write-Host ""
    Write-Host "Added $InstallDir to your user PATH; open a new terminal to pick it up."
  }
}
