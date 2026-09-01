$candidates = 'Az.Accounts', 'MSAL.PS', 'Microsoft.PowerApps.Administration.PowerShell', 'Microsoft.PowerApps.PowerShell', 'Microsoft.Graph.Authentication'
Write-Host "Installed auth modules on this box:"
foreach ($mod in $candidates) {
    $found = Get-Module -ListAvailable $mod | Select-Object -First 1
    if ($found) {
        Write-Host ("  [OK]   {0,-52} v{1}" -f $mod, $found.Version)
    } else {
        Write-Host ("  [MISS] {0}" -f $mod)
    }
}
