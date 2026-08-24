<#
.SYNOPSIS
    Provisions the three demo SharePoint lists for D2 Build Scheduler.

.DESCRIPTION
    Creates Jobs, Assignments, Tasks lists + columns + indexes + uniqueness
    + seed data. Idempotent (safe to re-run).

.NOTES
    Prereq: PnP.PowerShell module. Install with:
        Install-Module PnP.PowerShell -Scope CurrentUser

    Run under PowerShell 7 (pwsh.exe). Interactive sign-in opens the DEFAULT
    browser (password manager can autofill).

    Writes progress to console AND to D2-Provision-Lists.log next to this file.
#>

$ErrorActionPreference = 'Stop'

$SiteUrl = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler'
$LogPath = Join-Path $PSScriptRoot 'D2-Provision-Lists.log'

# Reset log on each run
"D2 Provision Lists — $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File $LogPath -Encoding utf8

function Write-Log {
    param([string]$Msg, [string]$Color = 'Gray')
    $ts = Get-Date -Format 'HH:mm:ss'
    $line = "[$ts] $Msg"
    Write-Host $line -ForegroundColor $Color
    Add-Content -Path $LogPath -Value $line -Encoding utf8
}

try {
    Write-Log "Log file: $LogPath" 'Cyan'
    Write-Log "Site URL: $SiteUrl" 'Cyan'
    Write-Log ""

    # Force-install PnP.PowerShell 2.4.0 (known-good; newer versions have -DeviceLogin threading bug)
    $PinnedVersion = '2.4.0'
    $installed = Get-Module -ListAvailable -Name PnP.PowerShell | Where-Object { $_.Version -eq [Version]$PinnedVersion }
    if (-not $installed) {
        Write-Log "Installing PnP.PowerShell $PinnedVersion (pinned)..." 'Yellow'
        try {
            Install-PSResource -Name PnP.PowerShell -Version $PinnedVersion -Scope CurrentUser -TrustRepository -Reinstall
            Write-Log "Installed $PinnedVersion via PSResourceGet." 'Green'
        } catch {
            Write-Log "Install failed: $($_.Exception.Message)" 'Red'
            throw
        }
    } else {
        Write-Log "PnP.PowerShell $PinnedVersion already installed." 'Green'
    }
    # Remove any other loaded versions and import the pinned one
    Get-Module PnP.PowerShell | Remove-Module -Force -ErrorAction SilentlyContinue
    Import-Module PnP.PowerShell -RequiredVersion $PinnedVersion -DisableNameChecking

    Write-Log "Connecting via device code..." 'Cyan'
    Write-Log "  A URL and code will appear in the pwsh window. Open the URL, enter the code, and sign in." 'Yellow'
    Connect-PnPOnline -Url $SiteUrl -DeviceLogin
    $web = Get-PnPWeb
    Write-Log "Connected to: $($web.Title) [$($web.Url)]" 'Green'

    # ------------- helpers -------------
    function New-D2List {
        param([string]$Title, [string]$Description)
        $existing = Get-PnPList -Identity $Title -ErrorAction SilentlyContinue
        if ($existing) { Write-Log "  List '$Title' exists — skipping create" 'Yellow'; return $existing }
        Write-Log "  Creating list '$Title'..." 'Green'
        return New-PnPList -Title $Title -Template GenericList -OnQuickLaunch
    }

    function Add-D2Field {
        param(
            [string]$List, [string]$InternalName, [string]$DisplayName,
            [string]$Type, [switch]$Required, [string[]]$Choices,
            [string]$LookupList, [string]$LookupField
        )
        $existing = Get-PnPField -List $List -Identity $InternalName -ErrorAction SilentlyContinue
        if ($existing) { Write-Log "    Field '$InternalName' exists — skipping" 'Yellow'; return }
        Write-Log "    Adding '$InternalName' ($Type)..." 'Green'
        switch ($Type) {
            'Choice' {
                Add-PnPField -List $List -DisplayName $DisplayName -InternalName $InternalName `
                    -Type Choice -Choices $Choices -Required:$Required | Out-Null
            }
            'Lookup' {
                $target = Get-PnPList -Identity $LookupList
                $reqAttr = if ($Required) { "TRUE" } else { "FALSE" }
                Add-PnPFieldFromXml -List $List -FieldXml @"
<Field Type='Lookup' Name='$InternalName' DisplayName='$DisplayName' List='{$($target.Id)}' ShowField='$LookupField' Required='$reqAttr' />
"@ | Out-Null
            }
            'User' {
                Add-PnPField -List $List -DisplayName $DisplayName -InternalName $InternalName `
                    -Type User -Required:$Required | Out-Null
            }
            default {
                Add-PnPField -List $List -DisplayName $DisplayName -InternalName $InternalName `
                    -Type $Type -Required:$Required | Out-Null
            }
        }
    }

    function Set-D2FieldIndex {
        param([string]$List, [string]$InternalName, [switch]$Unique)
        Write-Log "    Indexing '$InternalName'$(if ($Unique) { ' (unique)' })..." 'Green'
        $values = if ($Unique) { @{ Indexed = $true; EnforceUniqueValues = $true } } else { @{ Indexed = $true } }
        Set-PnPField -List $List -Identity $InternalName -Values $values | Out-Null
    }

    # ------------- Jobs -------------
    Write-Log ""; Write-Log "== Jobs ==" 'Cyan'
    New-D2List -Title 'Jobs' -Description 'Pool build jobs.' | Out-Null
    Add-D2Field -List 'Jobs' -InternalName 'JobNumber' -DisplayName 'JobNumber' -Type Text     -Required
    Add-D2Field -List 'Jobs' -InternalName 'Address'   -DisplayName 'Address'   -Type Text
    Add-D2Field -List 'Jobs' -InternalName 'City'      -DisplayName 'City'      -Type Text
    Add-D2Field -List 'Jobs' -InternalName 'StartDate' -DisplayName 'StartDate' -Type DateTime -Required
    Add-D2Field -List 'Jobs' -InternalName 'Status'    -DisplayName 'Status'    -Type Choice -Choices 'Planned','Active','On Hold','Complete' -Required
    Set-D2FieldIndex -List 'Jobs' -InternalName 'JobNumber' -Unique

    $mondayNext = (Get-Date).Date.AddDays( ((1 - [int](Get-Date).DayOfWeek + 7) % 7) )
    if ($mondayNext -eq (Get-Date).Date) { $mondayNext = $mondayNext.AddDays(7) }

    $existingJob = Get-PnPListItem -List 'Jobs' -Query "<View><Query><Where><Eq><FieldRef Name='JobNumber'/><Value Type='Text'>D2-1001</Value></Eq></Where></Query></View>"
    if (-not $existingJob) {
        Write-Log "  Seeding Harrison Residence..." 'Green'
        Add-PnPListItem -List 'Jobs' -Values @{
            Title = 'Harrison Residence'; JobNumber = 'D2-1001';
            Address = '1420 Camino Real'; City = 'Thousand Oaks';
            StartDate = $mondayNext; Status = 'Active'
        } | Out-Null
    } else { Write-Log "  Job D2-1001 exists — skipping seed" 'Yellow' }

    # ------------- Assignments -------------
    Write-Log ""; Write-Log "== Assignments ==" 'Cyan'
    New-D2List -Title 'Assignments' -Description 'Sub-phase assignments per pool.' | Out-Null
    Add-D2Field -List 'Assignments' -InternalName 'Job'                -DisplayName 'Job'                -Type Lookup -LookupList 'Jobs' -LookupField 'Title' -Required
    Add-D2Field -List 'Assignments' -InternalName 'SubPhaseNumber'     -DisplayName 'SubPhaseNumber'     -Type Text -Required
    Add-D2Field -List 'Assignments' -InternalName 'SubPhaseName'       -DisplayName 'SubPhaseName'       -Type Text -Required
    Add-D2Field -List 'Assignments' -InternalName 'Crew'               -DisplayName 'Crew'               -Type Text
    Add-D2Field -List 'Assignments' -InternalName 'Sequence'           -DisplayName 'Sequence'           -Type Number
    Add-D2Field -List 'Assignments' -InternalName 'ScheduledStart'     -DisplayName 'ScheduledStart'     -Type DateTime
    Add-D2Field -List 'Assignments' -InternalName 'ScheduledFinish'    -DisplayName 'ScheduledFinish'    -Type DateTime
    Add-D2Field -List 'Assignments' -InternalName 'WorkDate'           -DisplayName 'WorkDate'           -Type DateTime
    Add-D2Field -List 'Assignments' -InternalName 'InstallerSignOff'   -DisplayName 'InstallerSignOff'   -Type Boolean
    Add-D2Field -List 'Assignments' -InternalName 'InstallerSignOffBy' -DisplayName 'InstallerSignOffBy' -Type User
    Add-D2Field -List 'Assignments' -InternalName 'InstallerSignOffOn' -DisplayName 'InstallerSignOffOn' -Type DateTime

    $job = Get-PnPListItem -List 'Jobs' -Query "<View><Query><Where><Eq><FieldRef Name='JobNumber'/><Value Type='Text'>D2-1001</Value></Eq></Where></Query></View>"
    $jobId = $job.Id
    $jobDate = $mondayNext

    $assignments = @(
        @{ Num='2.1'; Name='Rebar Delivery';     Crew='Devon Crew';    Seq=1; Start=$jobDate }
        @{ Num='2.2'; Name='Steel Installation'; Crew='Devon Crew';    Seq=2; Start=$jobDate.AddDays(2) }
        @{ Num='3.1'; Name='Plumbing Rough-In';  Crew='Antonio Crew';  Seq=3; Start=$jobDate.AddDays(4) }
        @{ Num='4.1'; Name='Shotcrete / Gunite'; Crew='STL Shotcrete'; Seq=4; Start=$jobDate.AddDays(6) }
        @{ Num='5.6'; Name='Deck Placement';     Crew='Harrison Crew'; Seq=5; Start=$jobDate.AddDays(9) }
    )
    foreach ($a in $assignments) {
        $title = "D2-1001 · $($a.Num) $($a.Name)"
        $existing = Get-PnPListItem -List 'Assignments' -Query "<View><Query><Where><Eq><FieldRef Name='Title'/><Value Type='Text'>$title</Value></Eq></Where></Query></View>"
        if ($existing) { Write-Log "  '$title' exists — skipping" 'Yellow'; continue }
        Write-Log "  Seeding '$title'..." 'Green'
        Add-PnPListItem -List 'Assignments' -Values @{
            Title = $title; Job = $jobId
            SubPhaseNumber = $a.Num; SubPhaseName = $a.Name
            Crew = $a.Crew; Sequence = $a.Seq
            ScheduledStart = $a.Start; ScheduledFinish = $a.Start.AddDays(1)
            InstallerSignOff = $false
        } | Out-Null
    }

    # ------------- Tasks -------------
    Write-Log ""; Write-Log "== Tasks ==" 'Cyan'
    New-D2List -Title 'Tasks' -Description 'Individual tasks per sub-phase.' | Out-Null
    Add-D2Field -List 'Tasks' -InternalName 'Assignment'  -DisplayName 'Assignment'  -Type Lookup -LookupList 'Assignments' -LookupField 'Title' -Required
    Add-D2Field -List 'Tasks' -InternalName 'Sequence'    -DisplayName 'Sequence'    -Type Number
    Add-D2Field -List 'Tasks' -InternalName 'Complete'    -DisplayName 'Complete'    -Type Boolean
    Add-D2Field -List 'Tasks' -InternalName 'CompletedBy' -DisplayName 'CompletedBy' -Type User
    Add-D2Field -List 'Tasks' -InternalName 'CompletedOn' -DisplayName 'CompletedOn' -Type DateTime
    Set-D2FieldIndex -List 'Tasks' -InternalName 'Assignment'

    $taskTemplates = @{
        '2.1' = @('Materials delivered on site','Delivery ticket signed','Materials counted','Photos taken','Storage location verified','Notify PM of arrival')
        '2.2' = @('Layout verified against plans','Bond beam steel set','Wall steel installed','Steel tied','Steel elevation checked','Ready for inspection')
        '3.1' = @('Skimmer stub-outs set','Main drain plumbing set','Return line stub-outs set','Test rig at 25 psi','Held pressure 15 min','Ready for inspection')
        '4.1' = @('Pool cavity clean of debris','Steel inspection passed','Water on site','Access confirmed','Shotcrete placed','Cure watering scheduled')
        '5.6' = @('Deck forms set','Rebar placed and tied','Concrete ordered','Sub-grade compacted','Placement complete','Finish coat applied')
    }
    $allAssignments = Get-PnPListItem -List 'Assignments' -PageSize 100
    foreach ($assign in $allAssignments) {
        $sp = $assign['SubPhaseNumber']
        if (-not $taskTemplates.ContainsKey($sp)) { continue }
        $tasks = $taskTemplates[$sp]
        for ($i = 0; $i -lt $tasks.Count; $i++) {
            $tt = $tasks[$i]
            $q = "<View><Query><Where><And><Eq><FieldRef Name='Assignment' LookupId='TRUE'/><Value Type='Lookup'>$($assign.Id)</Value></Eq><Eq><FieldRef Name='Title'/><Value Type='Text'>$tt</Value></Eq></And></Where></Query></View>"
            $existing = Get-PnPListItem -List 'Tasks' -Query $q
            if ($existing) { continue }
            Add-PnPListItem -List 'Tasks' -Values @{
                Title = $tt; Assignment = $assign.Id; Sequence = $i + 1; Complete = $false
            } | Out-Null
        }
        Write-Log "  Seeded 6 tasks for $sp" 'Green'
    }

    # ------------- Summary -------------
    Write-Log ""; Write-Log "== Complete ==" 'Cyan'
    $jc = (Get-PnPListItem -List 'Jobs'        -PageSize 100).Count
    $ac = (Get-PnPListItem -List 'Assignments' -PageSize 500).Count
    $tc = (Get-PnPListItem -List 'Tasks'       -PageSize 500).Count
    Write-Log "  Jobs        : $jc"
    Write-Log "  Assignments : $ac"
    Write-Log "  Tasks       : $tc"
    Write-Log "  Site: $SiteUrl" 'Cyan'
    Write-Log "STATUS: SUCCESS" 'Green'

} catch {
    Write-Log "ERROR: $($_.Exception.Message)" 'Red'
    Write-Log "STATUS: FAILED" 'Red'
    Write-Log $_.ScriptStackTrace 'Red'
} finally {
    try { Disconnect-PnPOnline -ErrorAction SilentlyContinue } catch {}
    Write-Log ""
    Read-Host "Press Enter to close this window"
}
