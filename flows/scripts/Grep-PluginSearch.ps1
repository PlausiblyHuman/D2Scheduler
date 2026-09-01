$f = 'C:\Users\shane\AppData\Roaming\Claude\local-agent-mode-sessions\7805df08-416a-43a8-ace6-1b59136bcbe1\f0c19cd1-e762-4bfc-adf7-0423cc549869\local_d24b47dc-383d-4014-a933-dc2a905cb14e\.claude\projects\C--Users-shane-AppData-Roaming-Claude-local-agent-mode-sessions-7805df08-416a-43a8-ace6-1b59136bcbe1-f0c19cd1-e762-4bfc-adf7-0423cc549869-local-d24b47dc-383d-4014-a933-dc2a905cb14e-outputs\afb63fc4-de30-4df6-b3dc-7ecad18f120c\tool-results\mcp-plugins-search_plugins-1788302697054.txt'
$c = Get-Content $f -Raw
Write-Host ("File length: {0}" -f $c.Length)
$needles = 'power-automate','power-platform','FlowAgent','flowagent','microsoft/power','flow-deployer','pac-power','dataverse'
foreach ($needle in $needles) {
    $idx = $c.IndexOf($needle)
    if ($idx -ge 0) {
        $snippetStart = [Math]::Max(0, $idx - 80)
        $snippetLen   = [Math]::Min(300, $c.Length - $snippetStart)
        $snippet = $c.Substring($snippetStart, $snippetLen)
        Write-Host ("HIT '{0}' at {1}:" -f $needle, $idx) -ForegroundColor Green
        Write-Host ("   ...{0}..." -f $snippet.Replace("`n", ' ').Replace("`r", '')) -ForegroundColor DarkGray
    } else {
        Write-Host ("miss '{0}'" -f $needle) -ForegroundColor DarkYellow
    }
}
