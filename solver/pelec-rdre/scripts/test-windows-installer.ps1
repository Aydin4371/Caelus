$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$Installers = @(Get-ChildItem 'src-tauri/target/release/bundle/nsis/*.exe')
if ($Installers.Count -ne 1) { throw 'Expected exactly one Windows installer.' }
# NSIS /D requires a native absolute Windows path and must remain the last,
# unquoted argument, including when the directory contains spaces.
$InstallRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Kythros native installation test')).Replace('/', '\')
Write-Host "Installing into: $InstallRoot"
$Install = Start-Process $Installers[0].FullName -ArgumentList "/S /D=$InstallRoot" -Wait -PassThru
if ($Install.ExitCode -ne 0) { throw "Installation failed: $($Install.ExitCode)" }
$App = Join-Path $InstallRoot 'kythros-desktop.exe'
if (-not (Test-Path -LiteralPath $App -PathType Leaf)) {
    Write-Host 'Files in the requested installation directory:'
    if (Test-Path -LiteralPath $InstallRoot) {
        Get-ChildItem -LiteralPath $InstallRoot -Recurse | Select-Object FullName | Format-Table -AutoSize | Out-String | Write-Host
    }
    # Record the actual NSIS directory if the installer ignored /D.
    Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -like '*Kythros*' } |
        Select-Object DisplayName, InstallLocation, DisplayIcon |
        Format-List | Out-String | Write-Host
    throw "Installed desktop executable was not found at $App."
}
$SavedPath = $env:PATH
$env:OMP_NUM_THREADS = '2'
try {
    # Exercise bundled dependencies: no Python or developer tools on PATH.
    $env:PATH = "$(Join-Path $env:SystemRoot 'System32');$env:SystemRoot"
    Remove-Item Env:PYTHONHOME -ErrorAction SilentlyContinue
    Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue
    $TestRoot = Join-Path $env:RUNNER_TEMP 'Kythros installed CFD test'
    $Run = Start-Process $App -ArgumentList "--test-native-runtime `"$TestRoot`"" -PassThru
    if (-not $Run.WaitForExit(600000)) { Stop-Process -Id $Run.Id -Force; throw 'Installed runtime test timed out.' }
    if ($Run.ExitCode -ne 0) { throw "Installed runtime failed: $($Run.ExitCode)" }
    $Proof = Get-Content "$TestRoot/package-test-passed.json" -Raw | ConvertFrom-Json
    if (-not ($Proof.native -and $Proof.cleanExit -and $Proof.finiteFields -and $Proof.requestRoundTrip)) {
        throw 'The installed runtime did not produce the expected proof.'
    }
    Write-Host 'PASS: installed Kythros executes native CFD and reads results without Python on PATH.'
} finally {
    $env:PATH = $SavedPath
}
