#Requires -Version 5.1
# Runs without Pester, administrator rights, a real Desktop write, or a browser
# launch. Uses real Windows shortcuts in a disposable temporary folder.
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\build\open-coachtools.ps1')

$script:passed = 0
function Assert-Launcher {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "FAIL: $Message" }
    $script:passed++
}
function Assert-LauncherThrows {
    param([scriptblock]$Action, [string]$Expected, [string]$Message)
    $failure = $null
    try { & $Action } catch { $failure = $_.Exception.Message }
    Assert-Launcher ($null -ne $failure -and $failure.Contains($Expected)) $Message
}

$tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$tempName = 'coachtools-launcher-test-' + [Guid]::NewGuid().ToString('N')
$testRoot = Join-Path $tempParent $tempName
$suite = Join-Path $testRoot "Coach Tools O'Brien # 100% caf$([char]0xE9)"
$desktop = Join-Path $testRoot 'Isolated Desktop'
$null = New-Item -ItemType Directory -Path (Join-Path $suite 'icons') -Force
$null = New-Item -ItemType Directory -Path $desktop -Force
Set-Content -LiteralPath (Join-Path $suite 'index.html') -Value '<!doctype html><title>Launcher test</title>'
# WScript stores the icon reference; icon rendering is validated separately.
$icon = Join-Path $suite 'icons\coachtools-galaxy.ico'
[IO.File]::WriteAllBytes($icon, [byte[]](0, 0, 1, 0, 0, 0))
$fakeEdge = Join-Path $testRoot 'Edge Test\msedge.exe'
$fakeChrome = Join-Path $testRoot 'Chrome Test\chrome.exe'
$null = New-Item -ItemType Directory -Path (Split-Path -Parent $fakeEdge), (Split-Path -Parent $fakeChrome) -Force
[IO.File]::WriteAllText($fakeEdge, '')
[IO.File]::WriteAllText($fakeChrome, '')
$edge = [pscustomobject]@{ Name = 'Edge'; Path = $fakeEdge }
$chrome = [pscustomobject]@{ Name = 'Chrome'; Path = $fakeChrome }
$originalRegistryBrowserPath = (Get-Item Function:\Get-CoachToolsRegistryBrowserPath).ScriptBlock
$originalBrowserPath = (Get-Item Function:\Get-CoachToolsBrowserPath).ScriptBlock
$originalBrowsers = (Get-Item Function:\Get-CoachToolsBrowsers).ScriptBlock
$savedProgramFiles = $env:ProgramFiles
$savedProgramFilesX86 = ${env:ProgramFiles(x86)}
$savedLocalAppData = $env:LOCALAPPDATA
$shell = $null
$link = $null
$script:answers = @()
$script:promptCount = 0
function Read-Host {
    param([string]$Prompt)
    if ($script:answers.Count -eq 0) { throw 'The launcher requested unexpected interactive input.' }
    $script:promptCount++
    $answer = $script:answers[0]
    $script:answers = @($script:answers | Select-Object -Skip 1)
    return $answer
}

try {
    $target = Get-CoachToolsLaunchTarget -SuitePath $suite
    Assert-Launcher ($target.IndexPath -eq (Join-Path $suite 'index.html')) 'Index resolves from the suite folder.'
    Assert-Launcher ($target.Arguments.StartsWith('"file:///') -and $target.Arguments.EndsWith('"')) 'A quoted absolute file URI is used.'
    Assert-Launcher ($target.Arguments.Contains('%20') -and $target.Arguments.Contains('%23') -and $target.Arguments.Contains('%25')) 'Spaces, hash, and percent are escaped.'
    $roundTripPath = ([Uri]($target.Arguments.Trim('"'))).LocalPath
    Assert-Launcher ($roundTripPath -eq $target.IndexPath) 'Apostrophes, Unicode, and special characters survive URI round trip.'
    Assert-LauncherThrows { Get-CoachToolsLaunchTarget -SuitePath (Join-Path $testRoot 'missing') } 'Extract the entire CoachTools ZIP' 'Missing index provides extraction instructions.'

    $script:answers = @('1', '2')
    Assert-Launcher ((Select-CoachToolsBrowser -InstalledBrowsers @($edge) -PreferredBrowser Auto).Name -eq 'Edge' -and $script:promptCount -eq 2) 'Single-browser setup still asks and rejects unavailable Chrome without changing Edge option 2.'
    Assert-Launcher ((Select-CoachToolsBrowser -InstalledBrowsers @($edge, $chrome) -PreferredBrowser Chrome).Path -eq $fakeChrome) 'Explicit Chrome selection works with both installed.'
    Assert-LauncherThrows { Select-CoachToolsBrowser -InstalledBrowsers @() } 'Install either browser' 'No browser provides a usable error.'
    Assert-LauncherThrows { Select-CoachToolsBrowser -InstalledBrowsers @($edge) -PreferredBrowser Chrome } 'Chrome was not found' 'An unavailable explicit choice is rejected.'
    $script:answers = @('bad', '', '1')
    $promptsBefore = $script:promptCount
    Assert-Launcher ((Select-CoachToolsBrowser -InstalledBrowsers @($edge, $chrome)).Name -eq 'Chrome') 'Browser menu retries invalid input and selects Chrome.'
    Assert-Launcher ($script:promptCount - $promptsBefore -eq 3) 'Empty Enter never silently selects a browser.'
    $script:answers = @('2')
    Assert-Launcher ((Select-CoachToolsBrowser -InstalledBrowsers @($chrome, $edge)).Name -eq 'Edge') 'Edge remains option 2 regardless of discovery ordering.'
    foreach ($answer in @('C', 'Chrome', '  chrome  ')) {
        $script:answers = @($answer)
        Assert-Launcher ((Select-CoachToolsBrowser -InstalledBrowsers @($edge, $chrome)).Name -eq 'Chrome') "Chrome choice '$answer' is accepted."
    }
    foreach ($answer in @('E', 'Edge', '  edge  ')) {
        $script:answers = @($answer)
        Assert-Launcher ((Select-CoachToolsBrowser -InstalledBrowsers @($edge, $chrome)).Name -eq 'Edge') "Edge choice '$answer' is accepted."
    }
    $script:answers = @('2', 'C')
    Assert-Launcher ((Select-CoachToolsBrowser -InstalledBrowsers @($chrome)).Name -eq 'Chrome') 'Chrome-only setup rejects unavailable Edge and accepts the installed choice.'

    # Discovery uses a registered custom install before standard folders.
    function Get-CoachToolsRegistryBrowserPath { param([string]$Executable); if ($Executable -eq 'msedge.exe') { return $fakeEdge } }
    Assert-Launcher ((Get-CoachToolsBrowserPath -Name Edge) -eq $fakeEdge) 'Registered custom browser install wins.'
    function Get-CoachToolsRegistryBrowserPath { param([string]$Executable) }
    $env:ProgramFiles = Join-Path $testRoot 'Program Files'
    ${env:ProgramFiles(x86)} = Join-Path $testRoot 'Program Files x86'
    $env:LOCALAPPDATA = Join-Path $testRoot 'Local User'
    $localChrome = Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'
    $machineEdge = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $localChrome), (Split-Path -Parent $machineEdge) -Force
    [IO.File]::WriteAllText($localChrome, '')
    [IO.File]::WriteAllText($machineEdge, '')
    Assert-Launcher ((Get-CoachToolsBrowserPath -Name Chrome) -eq $localChrome) 'Per-user Chrome fallback is discovered.'
    Assert-Launcher ((Get-CoachToolsBrowserPath -Name Edge) -eq $machineEdge) '32-bit machine Edge fallback is discovered.'
    $discovered = @(Get-CoachToolsBrowsers)
    Assert-Launcher ($discovered.Count -eq 2 -and $discovered[0].Name -eq 'Chrome' -and $discovered[1].Name -eq 'Edge') 'Both browser choices are retained in the menu order.'

    # Verify actual COM-created .lnk contents, collision handling, and reruns.
    $shell = New-Object -ComObject WScript.Shell
    $unrelatedPath = Join-Path $desktop 'CoachTools.lnk'
    $link = $shell.CreateShortcut($unrelatedPath)
    $link.TargetPath = $fakeEdge
    $link.Description = 'An unrelated user shortcut'
    $link.Save()
    $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($link)
    $link = $null
    $unrelatedBytes = [Convert]::ToBase64String([IO.File]::ReadAllBytes($unrelatedPath))

    $created = New-CoachToolsShortcut -SelectedBrowser $edge -LaunchTarget $target -IconPath $icon -Destination $desktop
    Assert-Launcher ((Split-Path -Leaf $created) -eq 'CoachTools (2).lnk') 'An unrelated shortcut is preserved with a new numbered name.'
    Assert-Launcher ([Convert]::ToBase64String([IO.File]::ReadAllBytes($unrelatedPath)) -eq $unrelatedBytes) 'Unrelated shortcut bytes are unchanged.'
    $link = $shell.CreateShortcut($created)
    Assert-Launcher ($link.TargetPath -eq $fakeEdge -and $link.Arguments -eq $target.Arguments) 'Shortcut opens the selected browser and exact quoted index URI.'
    Assert-Launcher ($link.WorkingDirectory -eq $suite -and $link.IconLocation -eq "$icon,0") 'Shortcut stores the suite folder and galaxy icon.'
    $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($link)
    $link = $null
    $reused = New-CoachToolsShortcut -SelectedBrowser $chrome -LaunchTarget $target -IconPath $icon -Destination $desktop
    Assert-Launcher ($reused -eq $created -and @(Get-ChildItem -LiteralPath $desktop -Filter '*.lnk').Count -eq 2) 'Rerun updates the owned shortcut without duplicates.'
    $link = $shell.CreateShortcut($reused)
    Assert-Launcher ($link.TargetPath -eq $fakeChrome) 'Rerun changes the owned shortcut to the selected browser.'
    $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($link)
    $link = $null

    $secondSuite = Join-Path $testRoot 'Second Suite'
    $null = New-Item -ItemType Directory -Path $secondSuite -Force
    Set-Content -LiteralPath (Join-Path $secondSuite 'index.html') -Value '<!doctype html>'
    $secondTarget = Get-CoachToolsLaunchTarget -SuitePath $secondSuite
    $secondLink = New-CoachToolsShortcut -SelectedBrowser $edge -LaunchTarget $secondTarget -IconPath $icon -Destination $desktop
    Assert-Launcher ((Split-Path -Leaf $secondLink) -eq 'CoachTools (3).lnk') 'Another CoachTools installation receives its own shortcut.'
    Assert-LauncherThrows { New-CoachToolsShortcut -SelectedBrowser $edge -LaunchTarget $target -IconPath (Join-Path $testRoot 'missing.ico') -Destination $desktop } 'galaxy icon was not found' 'Missing icon provides a usable error.'

    $unreadableDesktop = Join-Path $testRoot 'Other Isolated Desktop'
    $null = New-Item -ItemType Directory -Path $unreadableDesktop -Force
    $nonShortcutPath = Join-Path $unreadableDesktop 'CoachTools.lnk'
    [IO.File]::WriteAllText($nonShortcutPath, 'Not a Windows shortcut')
    $safeLink = New-CoachToolsShortcut -SelectedBrowser $edge -LaunchTarget $target -IconPath $icon -Destination $unreadableDesktop
    Assert-Launcher ((Split-Path -Leaf $safeLink) -eq 'CoachTools (2).lnk' -and [IO.File]::ReadAllText($nonShortcutPath) -eq 'Not a Windows shortcut') 'An unreadable existing link is preserved.'

    function Get-CoachToolsBrowsers { $edge; $chrome }
    $script:launchRequests = @()
    function Start-Process {
        param([string]$FilePath, [string]$ArgumentList, [string]$WorkingDirectory, [string]$ErrorAction)
        $script:launchRequests += [pscustomobject]@{ Path = $FilePath; Arguments = $ArgumentList; Directory = $WorkingDirectory }
    }
    $result = Invoke-CoachToolsLauncher -SuitePath $suite -PreferredBrowser Edge -SkipLaunch -SkipShortcut
    Assert-Launcher (-not $result.Launched -and $null -eq $result.ShortcutPath -and $script:launchRequests.Count -eq 0) 'Verification flags skip launch and desktop changes.'
    $result = Invoke-CoachToolsLauncher -SuitePath $suite -PreferredBrowser Chrome -SkipLaunch -ShortcutFolder $desktop
    Assert-Launcher ($result.ShortcutPath -eq $created -and $script:launchRequests.Count -eq 0) 'Isolated shortcut creation does not launch a browser.'
    $result = Invoke-CoachToolsLauncher -SuitePath $suite -PreferredBrowser Chrome -SkipShortcut
    Assert-Launcher (-not $result.Launched -and $script:launchRequests.Count -eq 0) 'No browser is opened without an explicit LaunchNow request.'
    $script:answers = @('Chrome')
    $result = Invoke-CoachToolsLauncher -SuitePath $suite
    Assert-Launcher ($result.ShortcutPath -eq (Join-Path $suite 'CoachTools.lnk') -and -not $result.Launched -and $script:launchRequests.Count -eq 0) 'Default setup creates the shortcut beside index.html without opening a browser.'
    $link = $shell.CreateShortcut($result.ShortcutPath)
    $originalLinkProperties = @($link.TargetPath, $link.Arguments, $link.WorkingDirectory, $link.IconLocation)
    $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($link)
    $link = $null
    $movedFolder = Join-Path $testRoot 'Moved Shortcut Folder'
    $null = New-Item -ItemType Directory -Path $movedFolder -Force
    $movedLinkPath = Join-Path $movedFolder 'CoachTools.lnk'
    Move-Item -LiteralPath $result.ShortcutPath -Destination $movedLinkPath
    $link = $shell.CreateShortcut($movedLinkPath)
    Assert-Launcher ($link.TargetPath -eq $originalLinkProperties[0] -and $link.Arguments -eq $originalLinkProperties[1] -and $link.WorkingDirectory -eq $originalLinkProperties[2] -and $link.IconLocation -eq $originalLinkProperties[3]) 'Moving the shortcut preserves its absolute browser, index URI, suite folder, and icon references.'
    $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($link)
    $link = $null
    Assert-Launcher (([Uri]$originalLinkProperties[1].Trim('"')).LocalPath -eq (Join-Path $suite 'index.html')) 'Moved shortcut still points to the original index file.'
    $result = Invoke-CoachToolsLauncher -SuitePath $suite -PreferredBrowser Chrome -LaunchNow -SkipLaunch -SkipShortcut
    Assert-Launcher (-not $result.Launched -and $script:launchRequests.Count -eq 0) 'NoLaunch overrides an explicit LaunchNow request.'
    $result = Invoke-CoachToolsLauncher -SuitePath $suite -PreferredBrowser Chrome -LaunchNow -SkipShortcut
    Assert-Launcher ($result.Launched -and $script:launchRequests.Count -eq 1) 'Explicit LaunchNow requests exactly one browser process.'
    Assert-Launcher ($script:launchRequests[0].Path -eq $fakeChrome -and $script:launchRequests[0].Arguments -eq $target.Arguments -and $script:launchRequests[0].Directory -eq $suite) 'Browser process receives the exact executable, URI, and working folder.'
    Remove-Item Function:\Start-Process

    Write-Host ("Windows launcher: {0} checks passed. No real Desktop changes or browser launches." -f $script:passed)
}
finally {
    if ($null -ne $link) { $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($link) }
    if ($null -ne $shell) { $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
    Set-Item Function:\Get-CoachToolsRegistryBrowserPath $originalRegistryBrowserPath
    Set-Item Function:\Get-CoachToolsBrowserPath $originalBrowserPath
    Set-Item Function:\Get-CoachToolsBrowsers $originalBrowsers
    Remove-Item Function:\Read-Host -ErrorAction SilentlyContinue
    Remove-Item Function:\Start-Process -ErrorAction SilentlyContinue
    $env:ProgramFiles = $savedProgramFiles
    ${env:ProgramFiles(x86)} = $savedProgramFilesX86
    $env:LOCALAPPDATA = $savedLocalAppData
    # Only remove the GUID-named fixture directly beneath the verified temp root.
    $resolvedFixture = [IO.Path]::GetFullPath($testRoot)
    $resolvedParent = [IO.Path]::GetFullPath((Split-Path -Parent $resolvedFixture)).TrimEnd('\')
    if ($resolvedParent -eq $tempParent.TrimEnd('\') -and (Split-Path -Leaf $resolvedFixture) -eq $tempName) {
        Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
    }
}
