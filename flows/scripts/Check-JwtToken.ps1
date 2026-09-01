Import-Module Microsoft.PowerApps.Administration.PowerShell -ErrorAction Stop
$mod = Get-Module Microsoft.PowerApps.Administration.PowerShell
$exports = $mod.ExportedCommands.Values | Where-Object { $_.Name -match 'Token|Session|Api|Invoke' } | Sort-Object Name
Write-Host "Auth/API-related exports in v$($mod.Version):"
$exports | ForEach-Object { Write-Host ("  " + $_.Name) }
Write-Host ""
$hasGetJwt = $null -ne (Get-Command Get-JwtToken -ErrorAction SilentlyContinue)
Write-Host ("Get-JwtToken available: {0}" -f $hasGetJwt)
