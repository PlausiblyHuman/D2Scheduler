<#
.SYNOPSIS
    Imports a Power Automate flow into an environment by PUTting its definition
    JSON to the Power Automate management REST API. Bypasses the missing PA UI
    "import package" path.

.DESCRIPTION
    Uses Microsoft.PowerApps.Administration.PowerShell for token acquisition
    (Add-PowerAppsAccount + Get-JwtToken, audience: service.flow.microsoft.com).
    Preflight verifies the target environment and warns if any connectionReference
    in the definition doesn't exist in the target env (import will still succeed
    but the flow won't run until connections are wired).

    IMPORTANT: run this in a real interactive pwsh window (not from an agent-
    piped shell) so the sign-in popup can render. See m365-interactive-auth
    skill for the "an error occurred when writing to a listener" workaround.

    Idempotency: pass -FlowId to overwrite an existing flow; omit to mint a new
    GUID. New flow starts Stopped so it can't fire on partial config.

.PARAMETER DefinitionPath
    Path to the flow definition JSON (schema matches Get-AdminFlow's
    .Internal.properties, wrapped in { "properties": { ... } }).

.PARAMETER EnvId
    Target environment GUID. Default = D2 Automation.

.PARAMETER TenantId
    Entra tenant GUID. Default = D2 (f24d9b39...).

.PARAMETER FlowId
    Optional. Overwrite an existing flow by GUID. Omit to create new.

.EXAMPLE
    .\Import-Flow.ps1 -DefinitionPath ..\definitions\D2-Event-Driven-Reconciliation.json
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $DefinitionPath,
    [string] $EnvId    = '2710a01b-6cfa-e820-b338-2286f2649300',
    [string] $TenantId = 'f24d9b39-6a71-4f4e-a376-03b6f61c97e4',
    [string] $FlowId
)

$ErrorActionPreference = 'Stop'

# --- Preflight: file + module ---
if (-not (Test-Path $DefinitionPath)) { throw "Definition not found: $DefinitionPath" }
if (-not (Get-Module -ListAvailable Microsoft.PowerApps.Administration.PowerShell)) {
    throw "Microsoft.PowerApps.Administration.PowerShell required. Install: Install-Module Microsoft.PowerApps.Administration.PowerShell -Scope CurrentUser"
}
# Suppress the noisy unapproved-verb warnings the module emits on import.
$prevWarn = $WarningPreference; $WarningPreference = 'SilentlyContinue'
Import-Module Microsoft.PowerApps.Administration.PowerShell -ErrorAction Stop | Out-Null
$WarningPreference = $prevWarn

# --- Auth: Add-PowerAppsAccount pinned to D2 tenant, then Get-JwtToken for flow audience ---
# Per CLAUDE.md: Add-PowerAppsAccount without -TenantID silently uses cached tenant
# (e.g. Tennetech LLC in Shane's case) and Get-AdminFlow returns 0 flows with no error.
# Always pin -TenantID. Sign in as stratirus@d2pools.com when the popup appears.
Write-Host "Connecting to Power Platform on tenant $TenantId..." -ForegroundColor Cyan
Add-PowerAppsAccount -TenantID $TenantId | Out-Null

$tokenObj = Get-JwtToken -Audience 'https://service.flow.microsoft.com/' -ErrorAction Stop
$token    = if ($tokenObj -is [string]) { $tokenObj } else { $tokenObj.access_token }
if (-not $token) { throw "Failed to acquire flow-audience token via Get-JwtToken." }

# Tenant guard: parse the JWT and confirm the tid claim matches the target tenant.
$payloadB64 = ($token -split '\.')[1].Replace('-', '+').Replace('_', '/')
switch ($payloadB64.Length % 4) { 2 { $payloadB64 += '==' } 3 { $payloadB64 += '=' } }
$claims   = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payloadB64)) | ConvertFrom-Json
if ($claims.tid -ne $TenantId) {
    throw "TENANT MISMATCH: token tid=$($claims.tid), expected $TenantId. Aborting."
}
Write-Host "Tenant OK: tid=$($claims.tid) as $($claims.upn)" -ForegroundColor Green

$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }

# --- Preflight: verify target environment exists and is the D2 Automation env ---
$envUrl = "https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/$EnvId`?api-version=2016-11-01"
try {
    $envInfo = Invoke-RestMethod -Uri $envUrl -Headers $headers -Method GET
    Write-Host "Env OK: $($envInfo.properties.displayName) ($EnvId)" -ForegroundColor Green
} catch {
    throw "Env lookup failed: $($_.Exception.Message). Check EnvId or scope permissions (need at least Environment Maker)."
}

# --- Load and validate definition ---
$defObj = Get-Content $DefinitionPath -Raw | ConvertFrom-Json -Depth 40
if (-not $defObj.properties.definition) { throw "Missing properties.definition in $DefinitionPath" }
$displayName = $defObj.properties.displayName
$connRefs    = $defObj.properties.connectionReferences.PSObject.Properties.Name
Write-Host "Definition OK: '$displayName', connectionRefs = $($connRefs -join ', ')" -ForegroundColor Green

# --- Preflight: check that referenced connections exist in target env ---
$connCheckUrl = "https://api.powerapps.com/providers/Microsoft.PowerApps/environments/$EnvId/connections?api-version=2016-11-01"
try {
    $conns = (Invoke-RestMethod -Uri $connCheckUrl -Headers $headers -Method GET).value
    $connNames = $conns | ForEach-Object { $_.name }
    foreach ($ref in $defObj.properties.connectionReferences.PSObject.Properties) {
        $expected = $ref.Value.connectionName
        if ($connNames -notcontains $expected) {
            Write-Warning "Connection '$expected' (for $($ref.Name)) NOT found in env. Flow will import but won't run until wired."
        } else {
            Write-Host "  connection $expected present" -ForegroundColor DarkGray
        }
    }
} catch {
    Write-Warning "Could not enumerate connections (continuing anyway): $($_.Exception.Message)"
}

# --- PUT the flow (create if -FlowId omitted, overwrite if provided) ---
if (-not $FlowId) { $FlowId = [Guid]::NewGuid().ToString() }
Write-Host ""
Write-Host "PUT flow $FlowId as '$displayName' to env $EnvId" -ForegroundColor Cyan
$putUrl = "https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/$EnvId/flows/$FlowId`?api-version=2016-11-01"
$body   = $defObj | ConvertTo-Json -Depth 40 -Compress

try {
    $result = Invoke-RestMethod -Uri $putUrl -Headers $headers -Method PUT -Body $body
    Write-Host "PUT OK. Flow name (id): $($result.name)" -ForegroundColor Green
} catch {
    Write-Host ""
    Write-Host "PUT FAILED. Body echo:" -ForegroundColor Red
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message -ForegroundColor Red }
    else { Write-Host $_.Exception.Message -ForegroundColor Red }
    throw
}

# --- Verify: re-read the flow and confirm state + actions match ---
Start-Sleep -Seconds 2
$verifyUrl = "https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/$EnvId/flows/$FlowId`?api-version=2016-11-01"
$verify = Invoke-RestMethod -Uri $verifyUrl -Headers $headers -Method GET
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
Write-Host "Flow is imported STOPPED. Turn it on from the portal after verifying trigger + connections." -ForegroundColor Yellow
