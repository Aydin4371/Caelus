param(
    [string]$WorkDirectory = "$PSScriptRoot/../../../.solver-windows",
    [int]$Parallel = 4
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'This build requires native Windows and Visual Studio C++ build tools.' }
$SolverRoot = (Resolve-Path "$PSScriptRoot/..").Path
$Lock = Get-Content "$SolverRoot/upstream-lock.json" -Raw | ConvertFrom-Json
$WorkDirectory = [IO.Path]::GetFullPath($WorkDirectory)
$Source = Join-Path $WorkDirectory 'PeleC'
$Build = Join-Path $WorkDirectory 'build'
$Output = Join-Path $WorkDirectory 'output'
New-Item -ItemType Directory -Force $WorkDirectory, $Output | Out-Null
if (-not (Test-Path "$Source/.git")) {
    git clone --no-checkout $Lock.peleC.repository $Source
}
git -C $Source checkout --detach $Lock.peleC.commit
git -C $Source submodule update --init --recursive
$PhysicsCommit = git -C "$Source/Submodules/PelePhysics" rev-parse HEAD
if ($PhysicsCommit.Trim() -ne $Lock.pelePhysics.commit) { throw 'PelePhysics does not match upstream-lock.json.' }

# Build only the Kythros case. Upstream's other cases and shell-based test suite
# are not needed in a native runtime; the reacting annulus is tested separately.
Copy-Item "$SolverRoot/Exec/KythrosRDRE" "$Source/Exec/" -Recurse -Force
Set-Content "$Source/Exec/CMakeLists.txt" 'add_subdirectory(KythrosRDRE)' -Encoding utf8
Set-Content "$Source/Tests/CMakeLists.txt" '# Kythros uses test-native-solver.py.' -Encoding utf8
# Upstream adds GNU warning switches unconditionally; /Wextra is invalid in
# MSVC. Change compiler diagnostics only, without altering numerical source.
$FlagsFile = "$Source/CMake/SetPeleCompileFlags.cmake"
$Flags = Get-Content $FlagsFile -Raw
$GnuWarnings = 'list(APPEND PELE_CXX_FLAGS "-Wall" "-Wextra" "-pedantic" "-Wno-unused-function")'
$NativeWarnings = "if(MSVC)`n  list(APPEND PELE_CXX_FLAGS /W3)`nelse()`n  $GnuWarnings`nendif()"
if (-not $Flags.Contains($NativeWarnings)) {
    if (-not $Flags.Contains($GnuWarnings)) { throw 'Upstream compiler flags changed; review the Windows adaptation.' }
    Set-Content $FlagsFile $Flags.Replace($GnuWarnings, $NativeWarnings) -Encoding utf8
}

$VsWhere = "${env:ProgramFiles(x86)}/Microsoft Visual Studio/Installer/vswhere.exe"
$Vs = (& $VsWhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format json | ConvertFrom-Json)[0]
$VsRoot = $Vs.installationPath
$VsMajor = ([version]$Vs.installationVersion).Major
$Generator = "Visual Studio $VsMajor $($Vs.catalog.productLineVersion)"
cmake -S $Source -B $Build -G $Generator -A x64 "-DCMAKE_GENERATOR_INSTANCE=$VsRoot" `
    -DPELE_DIM=3 -DPELE_ENABLE_MPI=OFF -DPELE_ENABLE_OPENMP=ON `
    -DPELE_ENABLE_PARTICLES=OFF -DPELE_ENABLE_FCOMPARE=OFF `
    -DPELE_ENABLE_FPE_TRAP_FOR_TESTS=OFF -DPELE_ENABLE_CUDA=OFF `
    -DBUILD_SHARED_LIBS=OFF -DBUILD_STATIC_LIBS=ON `
    '-DCMAKE_CXX_FLAGS=/bigobj /Zc:__cplusplus'
cmake --build $Build --config Release --target PeleC-KythrosRDRE --parallel $Parallel
$Binary = "$Build/Exec/KythrosRDRE/Release/PeleC-KythrosRDRE.exe"
if (-not (Test-Path $Binary)) { throw 'Native solver executable was not produced.' }
Copy-Item $Binary "$Output/kythros-pelec-rdre.exe" -Force
# Include any non-static dependencies beside the executable.
Get-ChildItem $Build -Recurse -Filter '*.dll' | Copy-Item -Destination $Output -Force
# Ship the redistributable C++ and OpenMP DLLs app-locally. The solver must
# not depend on a customer's development tools or a separate runtime install.
$RedistRoot = Get-ChildItem "$VsRoot/VC/Redist/MSVC" -Directory | Sort-Object Name -Descending | Select-Object -First 1
foreach ($Component in @('Microsoft.VC*.CRT', 'Microsoft.VC*.OpenMP')) {
    $Runtime = Get-ChildItem "$($RedistRoot.FullName)/x64" -Directory -Filter $Component | Select-Object -First 1
    if (-not $Runtime) { throw "Missing redistributable component: $Component" }
    Get-ChildItem $Runtime.FullName -Filter '*.dll' | Copy-Item -Destination $Output -Force
}
Copy-Item "$SolverRoot/Exec/KythrosRDRE/smoke.inp" $Output -Force
Copy-Item "$SolverRoot/Exec/KythrosRDRE/inputs.template" $Output -Force
Copy-Item "$SolverRoot/upstream-lock.json" $Output -Force
$Licenses = Join-Path $Output 'licenses'
New-Item -ItemType Directory -Force $Licenses | Out-Null
Copy-Item "$Source/license.txt" "$Licenses/PeleC.txt" -Force
Copy-Item "$Source/Submodules/PelePhysics/license.txt" "$Licenses/PelePhysics.txt" -Force
Copy-Item "$Source/Submodules/PelePhysics/Submodules/amrex/LICENSE" "$Licenses/AMReX.txt" -Force
Copy-Item "$Source/Submodules/PelePhysics/Submodules/sundials/LICENSE" "$Licenses/SUNDIALS.txt" -Force
Copy-Item "$Source/Submodules/PelePhysics/Submodules/amrex/NOTICE" "$Licenses/AMReX-NOTICE.txt" -Force
Copy-Item "$Source/Submodules/PelePhysics/Submodules/sundials/NOTICE" "$Licenses/SUNDIALS-NOTICE.txt" -Force
$Manifest = [ordered]@{
    platform = 'windows-x64'; accelerator = 'cpu-openmp'; peleC = $Lock.peleC.commit
    pelePhysics = $PhysicsCommit.Trim(); executable = 'kythros-pelec-rdre.exe'
    sha256 = (Get-FileHash "$Output/kythros-pelec-rdre.exe" -Algorithm SHA256).Hash.ToLower()
    validationStatus = 'development-unvalidated'
}
$Manifest | ConvertTo-Json | Set-Content "$Output/build-manifest.json" -Encoding utf8
Write-Host "Native solver: $Output/kythros-pelec-rdre.exe"
