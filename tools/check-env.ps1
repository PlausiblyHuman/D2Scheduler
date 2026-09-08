<#
.SYNOPSIS
  Checks that a Windows machine is ready for Claude Code work on the Stratirus
  projects under C:\src.

.DESCRIPTION
  Read-only, with one exception: it creates C:\src if that folder is missing,
  because every project lives under it and the path is deliberately short (see
  the path-length note below).

  Nothing else is installed, changed or removed. Registry access is read-only
  and needs no elevation.

.NOTES
  Run:  pwsh -File .\tools\check-env.ps1
  Exit codes:  0 = ready,  1 = at least one required check failed.
#>

[CmdletBinding()]
param()

$script:Failures = 0
$script:Warnings = 0

function Write-Result {
    param(
        [Parameter(Mandatory)][ValidateSet('PASS', 'FAIL', 'WARN', 'INFO')][string] $State,
        [Parameter(Mandatory)][string] $Label,
        [string] $Detail
    )
    $colour = switch ($State) {
        'PASS' { 'Green' }
        'FAIL' { 'Red' }
        'WARN' { 'Yellow' }
        default { 'Gray' }
    }
    Write-Host ('  [{0}] ' -f $State) -ForegroundColor $colour -NoNewline
    Write-Host $Label -NoNewline
    if ($Detail) { Write-Host ("  $Detail") -ForegroundColor DarkGray } else { Write-Host '' }

    if ($State -eq 'FAIL') { $script:Failures++ }
    if ($State -eq 'WARN') { $script:Warnings++ }
}

function Test-Tool {
    <#  Required tools FAIL when absent; optional tools only WARN, because they
        are needed for Power Platform work and not for everything.  #>
    param(
        [Parameter(Mandatory)][string] $Name,
        [string] $Label,
        [string] $Hint,
        [switch] $Optional
    )
    if (-not $Label) { $Label = $Name }
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) {
        $version = ''
        try {
            # Most of these answer to --version; keep failures quiet, the point
            # is whether the tool resolves on PATH.
            $raw = & $Name --version 2>$null | Select-Object -First 1
            if ($raw) { $version = ($raw | Out-String).Trim() }
        } catch { }
        Write-Result -State 'PASS' -Label $Label -Detail $version
    }
    elseif ($Optional) {
        Write-Result -State 'WARN' -Label "$Label (optional)" -Detail $Hint
    }
    else {
        Write-Result -State 'FAIL' -Label $Label -Detail $Hint
    }
}

Write-Host ''
Write-Host 'Claude Code environment check' -ForegroundColor Cyan
Write-Host ('Machine: {0}    User: {1}' -f $env:COMPUTERNAME, $env:USERNAME) -ForegroundColor DarkGray
Write-Host ''

# --------------------------------------------------------------- folders
Write-Host 'Folders' -ForegroundColor Cyan

$srcRoot = 'C:\src'
if (Test-Path -LiteralPath $srcRoot -PathType Container) {
    $projects = @(Get-ChildItem -LiteralPath $srcRoot -Directory -ErrorAction SilentlyContinue).Count
    Write-Result -State 'PASS' -Label $srcRoot -Detail "$projects project folder(s)"
}
else {
    try {
        New-Item -ItemType Directory -Path $srcRoot -ErrorAction Stop | Out-Null
        Write-Result -State 'PASS' -Label $srcRoot -Detail 'created'
    }
    catch {
        Write-Result -State 'FAIL' -Label $srcRoot -Detail "could not create: $($_.Exception.Message)"
    }
}

$skillsRoot = Join-Path $HOME '.claude\skills'
if (Test-Path -LiteralPath $skillsRoot -PathType Container) {
    $skills = @(Get-ChildItem -LiteralPath $skillsRoot -Directory -ErrorAction SilentlyContinue).Count
    Write-Result -State 'PASS' -Label $skillsRoot -Detail "$skills skill(s) installed"
}
else {
    Write-Result -State 'FAIL' -Label $skillsRoot -Detail 'skills folder missing'
}

$sessionSkill = Join-Path $skillsRoot 'dev-session-code\SKILL.md'
if (Test-Path -LiteralPath $sessionSkill -PathType Leaf) {
    $kb = [math]::Round((Get-Item -LiteralPath $sessionSkill).Length / 1KB, 1)
    Write-Result -State 'PASS' -Label 'dev-session-code\SKILL.md' -Detail "$kb KB"
}
else {
    Write-Result -State 'FAIL' -Label 'dev-session-code\SKILL.md' -Detail 'session workflow skill not installed'
}

# --------------------------------------------------------------- tooling
Write-Host ''
Write-Host 'Required tools' -ForegroundColor Cyan
Test-Tool -Name 'git'    -Hint 'install Git for Windows'
Test-Tool -Name 'node'   -Hint 'install Node.js LTS'
Test-Tool -Name 'npm'    -Hint 'ships with Node.js'
Test-Tool -Name 'python' -Hint 'install Python 3 and tick "Add to PATH"'
Test-Tool -Name 'claude' -Hint 'npm install -g @anthropic-ai/claude-code'

Write-Host ''
Write-Host 'Optional tools (Power Platform work only)' -ForegroundColor Cyan
Test-Tool -Name 'az'  -Label 'az'  -Optional -Hint 'Azure CLI, needed for flow publishing'
Test-Tool -Name 'pac' -Label 'pac' -Optional -Hint 'Power Platform CLI, needed for canvas app work'

# --------------------------------------------------------------- windows
Write-Host ''
Write-Host 'Windows settings' -ForegroundColor Cyan

# Long paths. Even with this enabled some tools still enforce 260 chars, which
# is why projects live at C:\src\<name> rather than deep under Documents.
$longPathKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem'
try {
    $longPaths = (Get-ItemProperty -Path $longPathKey -Name 'LongPathsEnabled' -ErrorAction Stop).LongPathsEnabled
    if ($longPaths -eq 1) {
        Write-Result -State 'PASS' -Label 'LongPathsEnabled' -Detail 'enabled'
    }
    else {
        Write-Result -State 'WARN' -Label 'LongPathsEnabled' -Detail 'disabled; keep repo paths short, or enable it (needs admin)'
    }
}
catch {
    Write-Result -State 'WARN' -Label 'LongPathsEnabled' -Detail 'not set; keep repo paths short'
}

# --------------------------------------------------------------- summary
Write-Host ''
if ($script:Failures -eq 0 -and $script:Warnings -eq 0) {
    Write-Host 'Ready. Everything checked out.' -ForegroundColor Green
}
elseif ($script:Failures -eq 0) {
    Write-Host ("Ready, with {0} warning(s) above. Nothing blocking." -f $script:Warnings) -ForegroundColor Yellow
}
else {
    Write-Host ("{0} required check(s) failed and {1} warning(s). Fix the red items above, then re-run." -f $script:Failures, $script:Warnings) -ForegroundColor Red
}
Write-Host ''

exit ([int]($script:Failures -gt 0))
