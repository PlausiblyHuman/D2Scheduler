<#
.SYNOPSIS
    Publish a Power Automate flow's current draft as the running version.

.DESCRIPTION
    On Dataverse-backed environments, api.flow.microsoft.com PATCH deposits
    changes into the DRAFT slot; the previously published version keeps running
    until this endpoint promotes the draft. Bypasses the "New designer / Save
    and switch" designer dance.

    POST https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/
         environments/{env}/flows/{id}/publish?api-version=2016-11-01

    Auth path identical to Patch-Flow.ps1 (Microsoft.PowerApps.Administration.PowerShell
    + Get-JwtToken flow audience + JWT tid tenant-guard).

.PARAMETER FlowId
    GUID of the flow whose draft to publish.

.EXAMPLE
    .\Publish-Flow.ps1 -FlowId 2764968c-4aa6-f111-b8dd-6045bd0196b3
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $FlowId,
    [string] $EnvId    = '2710a01b-6cfa-e820-b338-2286f2649300',
    [string] $TenantId = 'f24d9b39-6a71-4f4e-a376-03b6f61c97e4'
)

$ErrorActionPreference = 'Stop'

# --- Preflight: module ---
if (-not (Get-Module -ListAvailable Microsoft.PowerApps.Administration.PowerShell)) {
    throw "Microsoft.PowerApps.Administration.PowerShell required."
}
$prevWarn = $WarningPreference; $WarningPreference = 'SilentlyContinue'
Import-Module Microsoft.PowerApps.Administration.PowerShell -ErrorAction Stop | Out-Null
$WarningPreference = $prevWarn

# --- Auth ---
Write-Host "Connecting to Power Platform on tenant $TenantId..." -ForegroundColor Cyan
Add-PowerAppsAccount -TenantID $TenantId | Out-Null
$tokenObj = Get-JwtToken -Audience 'https://service.flow.microsoft.com/' -ErrorAction Stop
$token    = if ($tokenObj -is [string]) { $tokenObj } else { $tokenObj.access_token }
if (-not $token) { throw "Failed to acquire flow-audience token." }

$payloadB64 = ($token -split '\.')[1].Replace('-', '+').Replace('_', '/')
switch ($payloadB64.Length % 4) { 2 { $payloadB64 += '==' } 3 { $payloadB64 += '=' } }
$claims = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payloadB64)) | ConvertFrom-Json
if ($claims.tid -ne $TenantId) {
    throw "TENANT MISMATCH: token tid=$($claims.tid), expected $TenantId. Aborting."
}
Write-Host "Tenant OK: tid=$($claims.tid) as $($claims.upn)" -ForegroundColor Green

$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }

# --- Pre-publish baseline: what does the published version look like NOW? ---
$flowUrl = "https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/$EnvId/flows/$FlowId`?api-version=2016-11-01"
try {
    $before = Invoke-RestMethod -Uri $flowUrl -Headers $headers -Method GET
    $beforeActions = $before.properties.definition.actions.PSObject.Properties.Name
    Write-Host "Before publish: '$($before.properties.displayName)', state=$($before.properties.state), $($beforeActions.Count) action(s) in published version" -ForegroundColor Yellow
    Write-Host "  actions: $($beforeActions -join ', ')" -ForegroundColor DarkGray
} catch {
    throw "Flow $FlowId not found in env $EnvId. Double-check the GUID."
}

# --- Publish ---
$publishUrl = "https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/$EnvId/flows/$FlowId/publish?api-version=2016-11-01"
Write-Host ""
Write-Host "POST /publish on $FlowId..." -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri $publishUrl -Headers $headers -Method POST -Body '{}' | Out-Null
    Write-Host "Publish POST accepted." -ForegroundColor Green
} catch {
    Write-Host "PUBLISH FAILED. Body echo:" -ForegroundColor Red
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message -ForegroundColor Red }
    else { Write-Host $_.Exception.Message -ForegroundColor Red }
    throw
}

# --- Verify: re-read published version, check action count ticked up ---
Start-Sleep -Seconds 3
$after = Invoke-RestMethod -Uri $flowUrl -Headers $headers -Method GET
$afterActions = $after.properties.definition.actions.PSObject.Properties.Name
Write-Host ""
Write-Host "VERIFY (post-publish):" -ForegroundColor Green
Write-Host "  displayName: $($after.properties.displayName)"
Write-Host "  state:       $($after.properties.state)"
Write-Host "  actions:     $($afterActions.Count) ($($afterActions -join ', '))"
Write-Host ""
if ($afterActions.Count -eq $beforeActions.Count) {
    Write-Warning "Action count unchanged from before publish. Draft may not have promoted — check the portal."
} else {
    Write-Host "Draft promoted: $($beforeActions.Count) -> $($afterActions.Count) actions." -ForegroundColor Green
}
Write-Host "Portal URL:"
Write-Host "  https://make.powerautomate.com/environments/$EnvId/flows/$FlowId/details" -ForegroundColor DarkGray
