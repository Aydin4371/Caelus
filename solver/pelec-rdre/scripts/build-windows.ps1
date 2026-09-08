param(
    [string]$WorkDirectory = "$PSScriptRoot/../../../.solver-windows",
    [int]$Parallel = 4
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'This build requires native Windows and Visual Studio C++/Clang tools.' }
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
git -C $Source submodule update --init Submodules/PelePhysics
git -C "$Source/Submodules/PelePhysics" submodule update --init Submodules/amrex Submodules/sundials
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
$Capabilities = cmake -E capabilities | ConvertFrom-Json
$Generator = ($Capabilities.generators | Where-Object { $_.name.StartsWith("Visual Studio $VsMajor ") } | Select-Object -First 1).name
if (-not $Generator) { throw "CMake has no generator for Visual Studio $VsMajor." }
# Visual Studio's Clang compiler does not include a discoverable libomp SDK.
# Build the native OpenMP runtime from a pinned source revision and package it.
$LlvmCommit = '87f0227cb60147a26a1eeb4fb06e3b505e9c7261'
$LlvmSource = Join-Path $WorkDirectory 'llvm-project'
$OpenMpBuild = Join-Path $WorkDirectory 'openmp-build'
$OpenMpInstall = Join-Path $WorkDirectory 'openmp-install'
if (-not (Test-Path "$LlvmSource/.git")) {
    git clone --depth 1 --branch llvmorg-20.1.8 --filter=blob:none --sparse https://github.com/llvm/llvm-project.git $LlvmSource
    git -C $LlvmSource sparse-checkout set openmp cmake llvm/cmake third-party
}
$ActualLlvmCommit = git -C $LlvmSource rev-parse HEAD
if ($ActualLlvmCommit.Trim() -ne $LlvmCommit) { throw 'LLVM OpenMP revision mismatch.' }
cmake -S "$LlvmSource/openmp" -B $OpenMpBuild -G $Generator -A x64 -T ClangCL `
    "-DCMAKE_GENERATOR_INSTANCE=$VsRoot" "-DCMAKE_INSTALL_PREFIX=$OpenMpInstall" `
    -DCMAKE_CXX_STANDARD=17 -DCMAKE_CXX_STANDARD_REQUIRED=ON '-DCMAKE_CXX_FLAGS=/std:c++17' `
    -DOPENMP_ENABLE_LIBOMPTARGET=OFF -DOPENMP_ENABLE_OMPT_TOOLS=OFF -DLIBOMP_OMPT_SUPPORT=OFF `
    -DLIBOMP_USE_ITT_NOTIFY=OFF
cmake --build $OpenMpBuild --config Release --parallel $Parallel
cmake --install $OpenMpBuild --config Release
$OpenMpLibrary = Join-Path $OpenMpInstall 'lib/libomp.lib'
if (-not (Test-Path $OpenMpLibrary)) { throw 'Native OpenMP import library was not produced.' }
cmake -S $Source -B $Build -G $Generator -A x64 -T ClangCL "-DCMAKE_GENERATOR_INSTANCE=$VsRoot" `
    -DPELE_DIM=3 -DPELE_ENABLE_MPI=OFF -DPELE_ENABLE_OPENMP=ON `
    -DPELE_ENABLE_PARTICLES=OFF -DPELE_ENABLE_FCOMPARE=OFF `
    -DPELE_ENABLE_FPE_TRAP_FOR_TESTS=OFF -DPELE_ENABLE_CUDA=OFF `
    -DBUILD_SHARED_LIBS=OFF -DBUILD_STATIC_LIBS=ON `
    '-DOpenMP_CXX_FLAGS=/clang:-fopenmp' -DOpenMP_CXX_LIB_NAMES=omp `
    "-DOpenMP_omp_LIBRARY=$OpenMpLibrary" "-DOpenMP_CXX_INCLUDE_DIR=$OpenMpInstall/include" `
    '-DCMAKE_CXX_FLAGS=/std:c++20 /bigobj /D_USE_MATH_DEFINES'
cmake --build $Build --config Release --target PeleC-KythrosRDRE --parallel $Parallel
$Binary = "$Build/Exec/KythrosRDRE/Release/PeleC-KythrosRDRE.exe"
if (-not (Test-Path $Binary)) { throw 'Native solver executable was not produced.' }
Copy-Item $Binary "$Output/kythros-pelec-rdre.exe" -Force
# Include any non-static dependencies beside the executable.
Get-ChildItem $Build -Recurse -Filter '*.dll' | Copy-Item -Destination $Output -Force
# Ship the redistributable C++ and OpenMP DLLs app-locally. The solver must
# not depend on a customer's development tools or a separate runtime install.
$RedistRoot = Get-ChildItem "$VsRoot/VC/Redist/MSVC" -Directory | Where-Object { $_.Name -match '^\d+\.' } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
foreach ($Component in @('Microsoft.VC*.CRT')) {
    $Runtime = Get-ChildItem "$($RedistRoot.FullName)/x64" -Directory -Filter $Component | Select-Object -First 1
    if (-not $Runtime) { throw "Missing redistributable component: $Component" }
    Get-ChildItem $Runtime.FullName -Filter '*.dll' | Copy-Item -Destination $Output -Force
}
$OpenMpDlls = @(Get-ChildItem "$OpenMpInstall/bin" -Filter '*omp*.dll')
if ($OpenMpDlls.Count -eq 0) { throw 'The native Clang OpenMP redistributable DLL was not found.' }
$OpenMpDlls | Copy-Item -Destination $Output -Force
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
Copy-Item "$SolverRoot/licenses/LLVM-OpenMP.txt" $Licenses -Force
$Manifest = [ordered]@{
    platform = 'windows-x64'; compiler = 'clang-cl'; accelerator = 'cpu-openmp'; peleC = $Lock.peleC.commit
    pelePhysics = $PhysicsCommit.Trim(); executable = 'kythros-pelec-rdre.exe'
    llvmOpenMP = $LlvmCommit
    sha256 = (Get-FileHash "$Output/kythros-pelec-rdre.exe" -Algorithm SHA256).Hash.ToLower()
    validationStatus = 'development-unvalidated'
}
$Manifest | ConvertTo-Json | Set-Content "$Output/build-manifest.json" -Encoding utf8
Write-Host "Native solver: $Output/kythros-pelec-rdre.exe"
