<#
.SYNOPSIS
    PATCH an existing Power Automate flow's definition + connectionReferences
    with the contents of a definition JSON file.

.DESCRIPTION
    Companion to Import-Flow.ps1. Import-Flow tried PUT (create-arbitrary-id)
    against api.flow.microsoft.com and hit "No HTTP resource" — that route
    doesn't accept PUT for new flows. PATCH on an existing flow DOES work,
    so the modify-in-place pattern is: create an empty shell in the designer
    (5 clicks — just the trigger), grab its ID from the URL, PATCH the real
    definition in with this script.

    Auth path identical to Import-Flow.ps1 (Microsoft.PowerApps.Administration.PowerShell
    + Get-JwtToken with flow audience + JWT tid tenant-guard).

.PARAMETER DefinitionPath
    Path to the flow definition JSON. Same schema Import-Flow.ps1 uses:
    { "properties": { "displayName": ..., "definition": {...}, "connectionReferences": {...} } }

.PARAMETER FlowId
    GUID of the empty stub flow you just created in the designer. Grab from
    the URL: make.powerautomate.com/environments/{env}/flows/{THIS}/details

.PARAMETER EnvId
    Target environment GUID. Default = D2 Automation.

.PARAMETER TenantId
    Entra tenant GUID. Default = D2.

.EXAMPLE
    .\Patch-Flow.ps1 -DefinitionPath ..\definitions\D2-Event-Driven-Reconciliation.json -FlowId 12345678-...
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $DefinitionPath,
    [Parameter(Mandatory)] [string] $FlowId,
    [string] $EnvId    = '2710a01b-6cfa-e820-b338-2286f2649300',
    [string] $TenantId = 'f24d9b39-6a71-4f4e-a376-03b6f61c97e4'
)

$ErrorActionPreference = 'Stop'

# --- Preflight: file + module ---
if (-not (Test-Path $DefinitionPath)) { throw "Definition not found: $DefinitionPath" }
if (-not (Get-Module -ListAvailable Microsoft.PowerApps.Administration.PowerShell)) {
    throw "Microsoft.PowerApps.Administration.PowerShell required."
}
$prevWarn = $WarningPreference; $WarningPreference = 'SilentlyContinue'
Import-Module Microsoft.PowerApps.Administration.PowerShell -ErrorAction Stop | Out-Null
$WarningPreference = $prevWarn

# --- Auth (identical to Import-Flow.ps1) ---
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

# --- Verify the stub flow exists (fail cleanly if wrong ID) ---
$flowUrl = "https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/$EnvId/flows/$FlowId`?api-version=2016-11-01"
try {
    $stub = Invoke-RestMethod -Uri $flowUrl -Headers $headers -Method GET
    Write-Host "Stub flow OK: '$($stub.properties.displayName)' (state=$($stub.properties.state))" -ForegroundColor Green
} catch {
    throw "Stub flow $FlowId not found in env $EnvId. Double-check the GUID from the make.powerautomate.com URL."
}

# --- Load definition + build PATCH body ---
$defObj = Get-Content $DefinitionPath -Raw | ConvertFrom-Json -Depth 40
if (-not $defObj.properties.definition) { throw "Missing properties.definition in $DefinitionPath" }
$actions = $defObj.properties.definition.actions.PSObject.Properties.Name
Write-Host "Definition OK: '$($defObj.properties.displayName)', $($actions.Count) actions, connectionRefs = $($defObj.properties.connectionReferences.PSObject.Properties.Name -join ', ')" -ForegroundColor Green

# PATCH the whole properties block. Merge semantics at the properties level replace
# definition + connectionReferences wholesale, which is what we want.
$body = $defObj | ConvertTo-Json -Depth 40 -Compress

Write-Host ""
Write-Host "PATCH flow $FlowId with definition from $DefinitionPath..." -ForegroundColor Cyan
try {
    $result = Invoke-RestMethod -Uri $flowUrl -Headers $headers -Method PATCH -Body $body
    Write-Host "PATCH OK. Flow name: $($result.name)" -ForegroundColor Green
} catch {
    Write-Host ""
    Write-Host "PATCH FAILED. Body echo:" -ForegroundColor Red
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message -ForegroundColor Red }
    else { Write-Host $_.Exception.Message -ForegroundColor Red }
    throw
}

# --- Verify: re-read and compare action count ---
Start-Sleep -Seconds 2
$verify = Invoke-RestMethod -Uri $flowUrl -Headers $headers -Method GET
$actionsBack = $verify.properties.definition.actions.PSObject.Properties.Name
Write-Host ""
Write-Host "VERIFY:" -ForegroundColor Green
Write-Host "  displayName: $($verify.properties.displayName)"
Write-Host "  state:       $($verify.properties.state)"
Write-Host "  actions:     $($actionsBack.Count) ($($actionsBack -join ', '))"
Write-Host ""
Write-Host "Portal URL:" -ForegroundColor Cyan
Write-Host "  https://make.powerautomate.com/environments/$EnvId/flows/$FlowId/details"
Write-Host ""
Write-Host "Flow's still whatever state the stub was in. Sanity-check trigger + turn on from portal." -ForegroundColor Yellow
