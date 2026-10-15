# Console presentation for the Windows shortcut setup. ASCII works in Windows
# PowerShell 5.1 without requiring a particular terminal font or encoding.

function Show-CoachToolsWelcome {
    Write-Host ''
    Write-Host '      *                  .              *           .' -ForegroundColor DarkRed
    Write-Host '          .     C O A C H T O O L S          *' -ForegroundColor White
    Write-Host '   .             YOUR GALAXY OF TOOLS           .' -ForegroundColor Red
    Write-Host '        *                          .       *' -ForegroundColor DarkRed
    Write-Host ''
    Write-Host '   =========================================================' -ForegroundColor Red
    Write-Host '                  LET''S MAKE YOUR SHORTCUT' -ForegroundColor White
    Write-Host '   =========================================================' -ForegroundColor Red
    Write-Host ''
    Write-Host '   Pick your browser. Your galaxy shortcut will appear' -ForegroundColor Gray
    Write-Host '   beside this launcher, ready to move wherever you like.' -ForegroundColor Gray
    Write-Host ''
}

function Show-CoachToolsBrowserMenu {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$InstalledBrowsers)

    foreach ($choice in @(
        @{ Number = '1'; Letter = 'C'; Name = 'Chrome'; Label = 'GOOGLE CHROME  ' },
        @{ Number = '2'; Letter = 'E'; Name = 'Edge'; Label = 'MICROSOFT EDGE ' }
    )) {
        $available = @($InstalledBrowsers | Where-Object { $_.Name -eq $choice.Name }).Count -gt 0
        $status = if ($available) { 'Ready for your shortcut' } else { 'Not installed on this PC' }
        $labelColor = if ($available) { 'White' } else { 'DarkGray' }
        Write-Host ('   [ {0} / {1} ]  ' -f $choice.Number, $choice.Letter) -ForegroundColor Red -NoNewline
        Write-Host ($choice.Label + '  |  ') -ForegroundColor $labelColor -NoNewline
        Write-Host $status -ForegroundColor Gray
        Write-Host ''
    }
    Write-Host '   Please choose your preferred browser, then press Enter.' -ForegroundColor White
    Write-Host '   Type 1 or Chrome, or 2 or Edge.' -ForegroundColor Gray
    Write-Host ''
}

function Show-CoachToolsShortcutReady {
    param(
        [Parameter(Mandatory = $true)][string]$ShortcutPath,
        [Parameter(Mandatory = $true)][string]$Browser
    )

    Write-Host ''
    Write-Host '   =========================================================' -ForegroundColor Red
    Write-Host '                   *  SHORTCUT READY!  *' -ForegroundColor White
    Write-Host '   =========================================================' -ForegroundColor Red
    Write-Host ''
    Write-Host ('   Your browser: {0}' -f $Browser) -ForegroundColor White
    Write-Host '   Your galaxy shortcut:' -ForegroundColor Gray
    Write-Host ('   ' + $ShortcutPath) -ForegroundColor White
    Write-Host ''
    Write-Host '   Move the shortcut to your Desktop or any folder.' -ForegroundColor Gray
    Write-Host ('   Double-click it to open the Index in {0}.' -f $Browser) -ForegroundColor White
    Write-Host '   Keep the CoachTools folder and its icon files in place.' -ForegroundColor Gray
    Write-Host ''
}
