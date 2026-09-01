param([Parameter(Mandatory)] [string] $Path)
$errs = $null
[System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$null, [ref]$errs) | Out-Null
if ($errs -and $errs.Count -gt 0) {
    Write-Host "SYNTAX ERRORS in $Path"
    $errs | ForEach-Object { Write-Host " - $($_.Extent.StartLineNumber): $($_.Message)" }
    exit 1
} else {
    Write-Host "SYNTAX OK: $Path"
}
