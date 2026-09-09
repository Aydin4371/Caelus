param([Parameter(Mandatory=$true)][string]$SolverDirectory,
      [Parameter(Mandatory=$true)][string]$Destination,
      [Parameter(Mandatory=$true)][string]$WorkDirectory)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
Set-StrictMode -Version Latest
$SolverRoot = (Resolve-Path "$PSScriptRoot/..").Path
$SolverDirectory = (Resolve-Path $SolverDirectory).Path
$Destination = [IO.Path]::GetFullPath($Destination)
$WorkDirectory = [IO.Path]::GetFullPath($WorkDirectory)
if (Test-Path $Destination) { throw 'Use an empty destination for the native runtime package.' }
python -m venv "$WorkDirectory/venv"
$Python = "$WorkDirectory/venv/Scripts/python.exe"
& $Python -m pip install --only-binary=:all: -r "$SolverRoot/runtime/requirements.txt" 'pyinstaller==6.22.2'
& $Python -m PyInstaller --noconfirm --clean --onedir --console --name kythros-runtime `
    --collect-all yt --collect-all unyt --copy-metadata yt --copy-metadata unyt `
    --distpath "$WorkDirectory/dist" --workpath "$WorkDirectory/build" --specpath $WorkDirectory `
    "$SolverRoot/runtime/kythros_pelec_rdre.py"
New-Item -ItemType Directory -Force (Split-Path $Destination) | Out-Null
Copy-Item "$WorkDirectory/dist/kythros-runtime" $Destination -Recurse
Copy-Item "$SolverDirectory/*" $Destination -Recurse -Force
Set-Content "$Destination/accelerator.txt" 'cpu-openmp' -Encoding ascii
# Include installed Python-package license notices alongside native notices.
& $Python "$PSScriptRoot/package-python-notices.py" "$Destination/licenses/python-packages"
& "$Destination/kythros-runtime.exe" --version
