$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$Installers = @(Get-ChildItem 'src-tauri/target/release/bundle/nsis/*.exe')
if ($Installers.Count -ne 1) { throw 'Expected exactly one Windows installer.' }
$InstallRoot = "$env:LOCALAPPDATA/Kythros native installation test"
$Install = Start-Process $Installers[0].FullName -ArgumentList "/S /D=$InstallRoot" -Wait -PassThru
if ($Install.ExitCode -ne 0) { throw "Installation failed: $($Install.ExitCode)" }
$App = Join-Path $InstallRoot 'kythros-desktop.exe'
if (-not (Test-Path $App)) { throw 'Installed desktop executable was not found.' }
$SavedPath = $env:PATH
$env:OMP_NUM_THREADS = '2'
try {
    # Exercise bundled dependencies: no Python or developer tools on PATH.
    $env:PATH = "$env:SystemRoot/System32;$env:SystemRoot"
    Remove-Item Env:PYTHONHOME -ErrorAction SilentlyContinue
    Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue
    $TestRoot = "$env:RUNNER_TEMP/Kythros installed CFD test"
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
