param([Parameter(Mandatory)] [string] $Path)
try {
    $obj = Get-Content -Path $Path -Raw | ConvertFrom-Json -Depth 40
    $actions = $obj.properties.definition.actions.PSObject.Properties.Name
    Write-Host "JSON VALID"
    Write-Host "displayName: $($obj.properties.displayName)"
    Write-Host "trigger:    $($obj.properties.definition.triggers.PSObject.Properties.Name -join ', ')"
    Write-Host "actions ($($actions.Count)): $($actions -join ', ')"
    Write-Host "connectionRefs: $($obj.properties.connectionReferences.PSObject.Properties.Name -join ', ')"
} catch {
    Write-Host "JSON INVALID"
    Write-Host $_.Exception.Message
    exit 1
}
