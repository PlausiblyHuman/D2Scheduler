Set-Location C:\src\D2Scheduler
Write-Host '---COPY-LATEST---'
Copy-Item sessions\2026-09-01b-flow3-rest-wall.md sessions\latest.md -Force
Get-Item sessions\latest.md | Format-Table Name,Length,LastWriteTime -AutoSize | Out-String

Write-Host '---STATUS-BEFORE-COMMIT---'
git status --short

Write-Host '---ADD-COMMIT---'
git add -A
git -c user.name='Shane Talbot' -c user.email='stalbot@stratirus.com' commit -m 'Flow 3 REST-import wall; FlowAgent picked as forward path (2026-09-01b)'
if ($LASTEXITCODE -ne 0) { Write-Host 'COMMIT FAILED, aborting push' -ForegroundColor Red; exit 1 }

Write-Host '---PUSH---'
git push
if ($LASTEXITCODE -ne 0) { Write-Host 'PUSH FAILED — run manually' -ForegroundColor Red; exit 2 }

Write-Host '---HEAD---'
git log --oneline -3
