#Requires -Version 5.1
<#
Opens the local CoachTools index and creates a desktop shortcut to the same
browser and file. No server, Node.js, administrator rights, or browser settings
changes are required. Keep the extracted CoachTools folder in its final location.

Examples:
  .\OPEN COACHTOOLS.bat
  .\OPEN COACHTOOLS.bat -Browser Chrome
  powershell -File build\open-coachtools.ps1 -Browser Edge -NoLaunch -DesktopPath C:\Temp\TestDesktop

NoLaunch, NoShortcut, and DesktopPath support isolated verification. Dot-source
this file to test its functions without creating a shortcut or opening a browser.
#>
[CmdletBinding()]
param(
    [ValidateSet('Auto', 'Edge', 'Chrome')]
    [string]$Browser = 'Auto',
    [switch]$NoLaunch,
    [switch]$NoShortcut,
    [string]$DesktopPath
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Get-CoachToolsRegistryBrowserPath {
    param([Parameter(Mandatory = $true)][string]$Executable)

    # App Paths includes installs registered per user and per machine. Check
    # both registry views even when Windows PowerShell itself is 32-bit.
    foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
        foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
            $baseKey = $null
            $appKey = $null
            try {
                $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
                $appKey = $baseKey.OpenSubKey("SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$Executable")
                if ($null -ne $appKey) {
                    $value = [string]$appKey.GetValue('')
                    if (-not [string]::IsNullOrWhiteSpace($value)) {
                        $candidate = [Environment]::ExpandEnvironmentVariables($value.Trim().Trim('"'))
                        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
                    }
                }
            }
            catch {
                # Registry restrictions must not hide a standard folder install.
            }
            finally {
                if ($null -ne $appKey) { $appKey.Dispose() }
                if ($null -ne $baseKey) { $baseKey.Dispose() }
            }
        }
    }
}

function Get-CoachToolsBrowserPath {
    param([Parameter(Mandatory = $true)][ValidateSet('Edge', 'Chrome')][string]$Name)

    if ($Name -eq 'Edge') {
        $executable = 'msedge.exe'
        $relativePath = 'Microsoft\Edge\Application\msedge.exe'
    }
    else {
        $executable = 'chrome.exe'
        $relativePath = 'Google\Chrome\Application\chrome.exe'
    }

    $registeredPath = Get-CoachToolsRegistryBrowserPath -Executable $executable
    if ($registeredPath) { return [IO.Path]::GetFullPath($registeredPath) }

    foreach ($basePath in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
        if (-not [string]::IsNullOrWhiteSpace($basePath)) {
            $candidate = Join-Path $basePath $relativePath
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { return [IO.Path]::GetFullPath($candidate) }
        }
    }
}

function Get-CoachToolsBrowsers {
    foreach ($name in @('Edge', 'Chrome')) {
        $browserPath = Get-CoachToolsBrowserPath -Name $name
        if ($browserPath) { [pscustomobject]@{ Name = $name; Path = $browserPath } }
    }
}

function Select-CoachToolsBrowser {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$InstalledBrowsers,
        [ValidateSet('Auto', 'Edge', 'Chrome')][string]$PreferredBrowser = 'Auto'
    )

    if ($InstalledBrowsers.Count -eq 0) {
        throw 'Microsoft Edge or Google Chrome was not found. Install either browser, then run OPEN COACHTOOLS.bat again.'
    }
    if ($PreferredBrowser -ne 'Auto') {
        $selected = @($InstalledBrowsers | Where-Object { $_.Name -eq $PreferredBrowser })
        if ($selected.Count -eq 0) {
            throw "$PreferredBrowser was not found. Run OPEN COACHTOOLS.bat again to choose an installed browser."
        }
        return $selected[0]
    }
    if ($InstalledBrowsers.Count -eq 1) { return $InstalledBrowsers[0] }

    Write-Host ''
    Write-Host 'Choose the browser for CoachTools and its desktop shortcut:'
    for ($i = 0; $i -lt $InstalledBrowsers.Count; $i++) {
        Write-Host ("  {0}. {1}" -f ($i + 1), $InstalledBrowsers[$i].Name)
    }
    do {
        $answer = Read-Host 'Enter 1 or 2 (Enter selects 1)'
        if ([string]::IsNullOrWhiteSpace($answer)) { return $InstalledBrowsers[0] }
        if ($answer -eq '1' -or $answer -eq '2') { return $InstalledBrowsers[[int]$answer - 1] }
        Write-Host 'Please enter 1 or 2.'
    } while ($true)
}

function Get-CoachToolsLaunchTarget {
    param([Parameter(Mandatory = $true)][string]$SuitePath)

    $suiteFolder = [IO.Path]::GetFullPath($SuitePath)
    $indexPath = Join-Path $suiteFolder 'index.html'
    if (-not (Test-Path -LiteralPath $indexPath -PathType Leaf)) {
        throw "CoachTools index.html was not found in '$suiteFolder'. Extract the entire CoachTools ZIP, then run OPEN COACHTOOLS.bat from that folder."
    }
    # AbsoluteUri escapes spaces, #, %, Unicode, and other filename characters.
    # One quoted argument is shared by Start-Process and the shortcut.
    $fileUri = ([System.Uri]$indexPath).AbsoluteUri
    [pscustomobject]@{
        SuitePath = $suiteFolder
        IndexPath = $indexPath
        Arguments = '"' + $fileUri + '"'
    }
}

function New-CoachToolsShortcut {
    param(
        [Parameter(Mandatory = $true)][object]$SelectedBrowser,
        [Parameter(Mandatory = $true)][object]$LaunchTarget,
        [Parameter(Mandatory = $true)][string]$IconPath,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    if (-not (Test-Path -LiteralPath $IconPath -PathType Leaf)) {
        throw "The CoachTools galaxy icon was not found at '$IconPath'. Extract the entire CoachTools ZIP and try again."
    }
    if ([string]::IsNullOrWhiteSpace($Destination)) {
        throw 'Windows did not provide a Desktop folder. Use -DesktopPath with the folder where you want the CoachTools shortcut.'
    }
    $desktopFolder = [IO.Path]::GetFullPath($Destination)
    if (-not (Test-Path -LiteralPath $desktopFolder -PathType Container)) {
        $null = New-Item -ItemType Directory -Path $desktopFolder -Force
    }

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $null
    $marker = 'CoachTools desktop launcher'
    try {
        # Update only our shortcut for this suite. Preserve an unrelated link or
        # a second CoachTools installation by choosing the next available name.
        $sequence = 1
        do {
            $name = if ($sequence -eq 1) { 'CoachTools.lnk' } else { "CoachTools ($sequence).lnk" }
            $shortcutPath = Join-Path $desktopFolder $name
            $canUse = -not (Test-Path -LiteralPath $shortcutPath)
            if ($canUse) {
                $shortcut = $shell.CreateShortcut($shortcutPath)
            }
            else {
                try {
                    $shortcut = $shell.CreateShortcut($shortcutPath)
                    $canUse = $shortcut.Description -eq $marker -and
                        ([string]$shortcut.WorkingDirectory).TrimEnd('\') -ieq $LaunchTarget.SuitePath.TrimEnd('\')
                }
                catch {
                    # Even an unreadable/non-shortcut file with this name is
                    # unrelated content to preserve, not something to replace.
                    $canUse = $false
                }
            }
            if (-not $canUse) {
                if ($null -ne $shortcut) { $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) }
                $shortcut = $null
                $sequence++
            }
        } while (-not $canUse)

        $shortcut.TargetPath = $SelectedBrowser.Path
        $shortcut.Arguments = $LaunchTarget.Arguments
        $shortcut.WorkingDirectory = $LaunchTarget.SuitePath
        $shortcut.Description = $marker
        $shortcut.IconLocation = "$IconPath,0"
        $shortcut.WindowStyle = 1
        $shortcut.Save()
        if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) {
            throw "Windows did not save the desktop shortcut at '$shortcutPath'."
        }
        return $shortcutPath
    }
    finally {
        if ($null -ne $shortcut) { $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) }
        $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
    }
}

function Invoke-CoachToolsLauncher {
    param(
        [Parameter(Mandatory = $true)][string]$SuitePath,
        [ValidateSet('Auto', 'Edge', 'Chrome')][string]$PreferredBrowser = 'Auto',
        [switch]$SkipLaunch,
        [switch]$SkipShortcut,
        [string]$ShortcutFolder
    )

    $target = Get-CoachToolsLaunchTarget -SuitePath $SuitePath
    $selected = Select-CoachToolsBrowser -InstalledBrowsers @(Get-CoachToolsBrowsers) -PreferredBrowser $PreferredBrowser
    $shortcutPath = $null
    if (-not $SkipShortcut) {
        if ([string]::IsNullOrWhiteSpace($ShortcutFolder)) {
            $ShortcutFolder = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
        }
        $iconPath = Join-Path $target.SuitePath 'icons\coachtools-galaxy.ico'
        $shortcutPath = New-CoachToolsShortcut -SelectedBrowser $selected -LaunchTarget $target -IconPath $iconPath -Destination $ShortcutFolder
        Write-Host "Desktop shortcut ready: $shortcutPath"
    }
    if (-not $SkipLaunch) {
        Start-Process -FilePath $selected.Path -ArgumentList $target.Arguments -WorkingDirectory $target.SuitePath -ErrorAction Stop
        Write-Host ("CoachTools opened in {0}." -f $selected.Name)
    }
    Write-Host 'Keep this CoachTools folder in place. If you move it, run OPEN COACHTOOLS.bat again to create a shortcut for the new location.'

    [pscustomobject]@{
        Browser = $selected.Name
        BrowserPath = $selected.Path
        IndexPath = $target.IndexPath
        Arguments = $target.Arguments
        ShortcutPath = $shortcutPath
        Launched = -not $SkipLaunch
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        $suitePath = Split-Path -Parent $PSScriptRoot
        $null = Invoke-CoachToolsLauncher -SuitePath $suitePath -PreferredBrowser $Browser -SkipLaunch:$NoLaunch -SkipShortcut:$NoShortcut -ShortcutFolder $DesktopPath
    }
    catch {
        Write-Host ''
        Write-Host 'CoachTools could not finish opening.' -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        exit 1
    }
}
