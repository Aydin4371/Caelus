use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
    io::Read,
};
use tauri::{AppHandle, Manager, State};

const API_VERSION: u32 = 1;
const SOLVER_PATH: &str = "/opt/kythros/bin/kythros-pelec-rdre";
const WSL_DISTRIBUTION: &str = "KythrosSolver";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HardwareSnapshot {
    platform: String,
    architecture: String,
    logical_cpu_count: usize,
    memory_gb: Option<f64>,
    gpu_name: Option<String>,
    gpu_memory_gb: Option<f64>,
    cuda_available: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatus {
    api_version: u32,
    desktop: bool,
    runtime_installed: bool,
    runtime_version: Option<String>,
    solver_installed: bool,
    solver_name: Option<String>,
    solver_version: Option<String>,
    solver_accelerator: Option<String>,
    hardware: HardwareSnapshot,
    details: Vec<String>,
    desktop_version: String,
    setup_message: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct JobStatus {
    run_id: String,
    state: String,
    progress: f64,
    message: String,
    result_path: Option<String>,
    error: Option<String>,
    result: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunRequest {
    schema: String,
    format_version: u32,
    run_id: String,
    #[serde(flatten)]
    remaining: HashMap<String, Value>,
}

struct JobRecord {
    status: Mutex<JobStatus>,
    cancel: AtomicBool,
}

#[derive(Default, Clone)]
struct JobStore(Arc<Mutex<HashMap<String, Arc<JobRecord>>>>);

fn quiet_command(program: &str) -> Command {
    let mut command = Command::new(program);
    command.stdin(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW; UAC still uses its own prompt.
    }
    command
}

fn checked_output(mut command: Command, timeout_seconds: u64) -> Result<String, String> {
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| format!("Could not start the Windows/solver command: {error}"))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let read = |mut pipe: Box<dyn Read + Send>| {
        let mut bytes = Vec::new();
        let _ = pipe.read_to_end(&mut bytes);
        String::from_utf8_lossy(&bytes).replace('\0', "").trim().to_string()
    };
    let out = thread::spawn(move || read(Box::new(stdout)));
    let err = thread::spawn(move || read(Box::new(stderr)));
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if start.elapsed().as_secs() < timeout_seconds => thread::sleep(Duration::from_millis(100)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("The setup check timed out. Close Kythros, restart Windows, and retry setup.".to_string());
            }
            Err(error) => return Err(format!("Could not check the solver process: {error}")),
        }
    };
    let stdout = out.join().unwrap_or_default();
    let stderr = err.join().unwrap_or_default();
    if status.success() { return Ok(stdout); }
    Err(format!("{}{}{} (exit {status})", stdout, if stdout.is_empty() || stderr.is_empty() { "" } else { "\n" }, stderr))
}

fn command_output(command: Command) -> Option<String> {
    checked_output(command, 30).ok().filter(|value| !value.is_empty())
}

fn wsl_distribution_exists() -> bool {
    if !cfg!(target_os = "windows") {
        return false;
    }
    let mut command = quiet_command("wsl.exe");
    command.args(["--list", "--quiet"]);
    command_output(command)
        .map(|value| value.replace('\0', "").lines().any(|line| line.trim() == WSL_DISTRIBUTION))
        .unwrap_or(false)
}

fn platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "unknown"
    }
}

fn total_memory_gb() -> Option<f64> {
    if cfg!(target_os = "linux") {
        let content = fs::read_to_string("/proc/meminfo").ok()?;
        let kb = content.lines().find(|line| line.starts_with("MemTotal:"))?.split_whitespace().nth(1)?.parse::<f64>().ok()?;
        Some(kb / 1024.0 / 1024.0)
    } else if cfg!(target_os = "windows") {
        let mut command = quiet_command("powershell.exe");
        command.args(["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"]);
        command_output(command)?.parse::<f64>().ok().map(|bytes| bytes / 1024.0 / 1024.0 / 1024.0)
    } else {
        None
    }
}

fn nvidia_gpu() -> (Option<String>, Option<f64>) {
    let mut command = quiet_command("nvidia-smi");
    command.args(["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]);
    let Some(line) = command_output(command).and_then(|output| output.lines().next().map(str::to_string)) else {
        return (None, None);
    };
    let mut values = line.split(',').map(str::trim);
    let name = values.next().filter(|value| !value.is_empty()).map(str::to_string);
    let memory = values.next().and_then(|value| value.parse::<f64>().ok()).map(|mib| mib / 1024.0);
    (name, memory)
}

fn solver_command() -> Command {
    if cfg!(target_os = "windows") {
        let mut command = quiet_command("wsl.exe");
        command.args(["-d", WSL_DISTRIBUTION, "--cd", "/", "--exec", SOLVER_PATH]);
        command
    } else {
        quiet_command(SOLVER_PATH)
    }
}

fn solver_version() -> Option<String> {
    let mut command = solver_command();
    command.arg("--version");
    command_output(command)
}

fn solver_field(identity: Option<&String>, key: &str) -> Option<String> {
    identity.and_then(|value| {
        value
            .split(';')
            .map(str::trim)
            .find_map(|part| part.strip_prefix(key).map(str::to_string))
    })
}

fn runtime_installed() -> bool {
    if cfg!(target_os = "windows") {
        if !wsl_distribution_exists() { return false; }
        let mut command = quiet_command("wsl.exe");
        command.args(["-d", WSL_DISTRIBUTION, "--cd", "/", "--exec", "test", "-x", SOLVER_PATH]);
        checked_output(command, 30).is_ok()
    } else {
        Path::new(SOLVER_PATH).is_file()
    }
}

fn bundled_solver_rootfs(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_directory = app.path().resource_dir().map_err(|error| format!("Kythros could not open its installer resources: {error}"))?;
    let candidates = [
        resource_directory.join("resources").join("kythros-solver-rootfs.tar"),
        resource_directory.join("kythros-solver-rootfs.tar"),
    ];
    for candidate in candidates {
        if candidate.is_file() {
            let size = fs::metadata(&candidate).map_err(|error| format!("Kythros could not inspect its solver package: {error}"))?.len();
            if size < 10 * 1024 * 1024 {
                return Err("This development build does not contain the Full 3D solver package. Install a complete Kythros release.".to_string());
            }
            return Ok(candidate);
        }
    }
    Err("This Kythros installer does not contain the Full 3D solver package.".to_string())
}

fn ensure_wsl_available() -> Result<(), String> {
    let mut status = quiet_command("wsl.exe");
    status.arg("--status");
    if checked_output(status, 30).is_ok() { return Ok(()); }
    let mut install = quiet_command("powershell.exe");
    install.args([
        "-NoProfile", "-NonInteractive", "-Command",
        "$ErrorActionPreference='Stop'; try { $p = Start-Process wsl.exe -Verb RunAs -ArgumentList '--install','--no-distribution' -Wait -PassThru; if ($p.ExitCode -eq 3010) { exit 0 }; exit $p.ExitCode } catch { Write-Error $_; exit 1 }",
    ]);
    checked_output(install, 1200).map_err(|error| format!("Windows setup did not complete. Approve the Windows permission prompt and choose Set up and run again.\n{error}"))?;
    let mut recheck = quiet_command("wsl.exe");
    recheck.arg("--status");
    if checked_output(recheck, 30).is_ok() { return Ok(()); }
    Err("RESTART_REQUIRED: Windows setup completed. Save your work and restart your computer, then reopen Kythros and press Run Full 3D.".to_string())
}

// Resolve and test both paths in the actual WSL environment, without depending
// on a separately installed wslpath utility or an already-existing result file.
fn solver_job_paths(request: &Path, result: &Path) -> Result<(String, String), String> {
    if !cfg!(target_os = "windows") {
        return Ok((request.to_string_lossy().to_string(), result.to_string_lossy().to_string()));
    }
    let mut command = quiet_command("wsl.exe");
    command.args(["-d", WSL_DISTRIBUTION, "--cd", "/", "--exec", "python3", "-c", include_str!("job_paths.py")]);
    command.arg(request).arg(result);
    let output = checked_output(command, 60).map_err(|error| format!("The solver cannot access its run files. Retry after restarting Kythros.\n{error}"))?;
    let paths: Vec<String> = serde_json::from_str(output.lines().last().unwrap_or(""))
        .map_err(|error| format!("The solver returned an invalid file-access check: {error}. {output}"))?;
    if paths.len() != 2 { return Err("The solver did not return both run paths.".to_string()); }
    Ok((paths[0].clone(), paths[1].clone()))
}

fn inspect_runtime() -> RuntimeStatus {
    let installed = runtime_installed();
    let identity = installed.then(solver_version).flatten();
    let runtime_version = identity.as_ref().and_then(|value| {
        value.split(';').next()?.split_whitespace().last().map(str::to_string)
    });
    let solver_version = solver_field(identity.as_ref(), "solver=");
    let solver_accelerator = solver_field(identity.as_ref(), "accelerator=");
    let (gpu_name, gpu_memory_gb) = nvidia_gpu();
    let mut details = Vec::new();
    if cfg!(target_os = "windows") {
        details.push(format!("Solver runtime: WSL2 distribution {WSL_DISTRIBUTION}"));
    } else {
        details.push(format!("Solver runtime: {SOLVER_PATH}"));
    }
    if !installed {
        details.push("Choose Set up and run. Kythros will install the included solver and check the connection.".to_string());
    }
    RuntimeStatus {
        api_version: API_VERSION,
        desktop: true,
        runtime_installed: installed,
        runtime_version,
        solver_installed: installed && identity.is_some(),
        solver_name: identity.as_ref().map(|_| "PeleC RDRE solver pack".to_string()),
        solver_version,
        solver_accelerator,
        hardware: HardwareSnapshot {
            platform: platform().to_string(),
            architecture: std::env::consts::ARCH.to_string(),
            logical_cpu_count: std::thread::available_parallelism().map(usize::from).unwrap_or(1),
            memory_gb: total_memory_gb(),
            cuda_available: gpu_name.is_some(),
            gpu_name,
            gpu_memory_gb,
        },
        details,
        desktop_version: env!("CARGO_PKG_VERSION").to_string(),
        setup_message: None,
    }
}

fn install_runtime(app: AppHandle) -> Result<RuntimeStatus, String> {
    if !cfg!(target_os = "windows") {
        return Err("The one-click solver installer currently supports Windows. Linux packages use the signed runtime installation script.".to_string());
    }
    if runtime_installed() {
        return Ok(inspect_runtime());
    }
    let rootfs = bundled_solver_rootfs(&app)?;
    ensure_wsl_available()?;
    if !wsl_distribution_exists() {
        let install_directory = app.path().app_local_data_dir()
            .map_err(|error| format!("Kythros could not create its solver directory: {error}"))?
            .join("solver-wsl");
        fs::create_dir_all(&install_directory)
            .map_err(|error| format!("Kythros could not create its solver directory: {error}"))?;
        let mut command = quiet_command("wsl.exe");
        command.args(["--import", WSL_DISTRIBUTION]).arg(&install_directory).arg(&rootfs).args(["--version", "2"]);
        checked_output(command, 1200).map_err(|error| format!("Windows could not finish installing the solver. Choose Set up and run to retry.\n{error}"))?;
    }
    let status = inspect_runtime();
    if !status.runtime_installed || !status.solver_installed {
        return Err("The existing solver installation is incomplete. Your saved engines are safe. Download the latest Kythros update and retry; if this persists, copy these details for support.".to_string());
    }
    Ok(status)
}

#[tauri::command]
async fn local_runtime_status() -> Result<RuntimeStatus, String> {
    tauri::async_runtime::spawn_blocking(inspect_runtime).await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn install_local_solver_runtime(app: AppHandle) -> Result<RuntimeStatus, String> {
    tauri::async_runtime::spawn_blocking(move || install_runtime(app)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
fn open_desktop_update() -> Result<(), String> {
    // Open a fixed download URL in the user's authenticated browser. No token
    // is embedded in the app and no arbitrary URL or command is accepted.
    let mut command = quiet_command("powershell.exe");
    command.args(["-NoProfile", "-NonInteractive", "-Command", "Start-Process 'https://github.com/Aydin4371/Caelus/releases/latest/download/Kythros-Setup.exe'"]);
    checked_output(command, 30).map(|_| ())
}

fn update_status(record: &JobRecord, state: &str, progress: f64, message: &str) {
    if let Ok(mut status) = record.status.lock() {
        status.state = state.to_string();
        status.progress = progress.clamp(0.0, 1.0);
        status.message = message.to_string();
    }
}

fn fail_job(record: &JobRecord, message: String) {
    if let Ok(mut status) = record.status.lock() {
        status.state = "failed".to_string();
        status.message = "Full 3D solver stopped.".to_string();
        status.error = Some(message);
    }
}

#[tauri::command]
async fn start_local_cfd(app: AppHandle, store: State<'_, JobStore>, request: Value) -> Result<JobStatus, String> {
    let jobs = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || start_job(app, jobs, request)).await.map_err(|error| error.to_string())?
}

fn start_job(app: AppHandle, store: JobStore, request: Value) -> Result<JobStatus, String> {
    let decoded: RunRequest = serde_json::from_value(request.clone()).map_err(|error| format!("Invalid Full 3D run request: {error}"))?;
    if decoded.schema != "kythros-local-rde-3d-request" || decoded.format_version != API_VERSION {
        return Err("Kythros desktop received an incompatible Full 3D run request.".to_string());
    }
    if decoded.run_id.is_empty() || decoded.run_id.len() > 96 || !decoded.run_id.chars().all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_')) {
        return Err("The Full 3D run identifier is invalid.".to_string());
    }
    let _ = decoded.remaining;
    if !runtime_installed() {
        return Err("Install the Kythros Solver Runtime before starting Full 3D.".to_string());
    }
    let base = app.path().app_local_data_dir().map_err(|error| format!("Kythros could not open its local job directory: {error}"))?;
    let job_dir = base.join("cfd-jobs").join(&decoded.run_id);
    fs::create_dir_all(&job_dir).map_err(|error| format!("Kythros could not create the local job directory: {error}"))?;
    let request_path = job_dir.join("request.json");
    let result_path = job_dir.join("kythros-volume-result.json");
    fs::write(&request_path, serde_json::to_vec_pretty(&request).map_err(|error| error.to_string())?).map_err(|error| format!("Kythros could not save the run request: {error}"))?;
    let (solver_request_path, solver_result_path) = solver_job_paths(&request_path, &result_path)?;
    let record = Arc::new(JobRecord {
        status: Mutex::new(JobStatus {
            run_id: decoded.run_id.clone(),
            state: "queued".to_string(),
            progress: 0.0,
            message: "Run accepted by the local desktop runtime.".to_string(),
            result_path: None,
            error: None,
            result: None,
        }),
        cancel: AtomicBool::new(false),
    });
    {
        let mut jobs = store.0.lock().map_err(|_| "The local job store is unavailable.".to_string())?;
        if jobs.contains_key(&decoded.run_id) {
            return Err("A local CFD job already uses this run identifier.".to_string());
        }
        jobs.insert(decoded.run_id.clone(), Arc::clone(&record));
    }
    let run_id = decoded.run_id;
    let thread_record = Arc::clone(&record);
    thread::spawn(move || {
        update_status(&thread_record, "preparing", 0.03, "Preparing the engine geometry and solver case.");
        let mut command = solver_command();
        command.args(["--request", &solver_request_path, "--result", &solver_result_path]);
        let log_path = job_dir.join("desktop-solver.log");
        let log = match fs::File::create(&log_path) {
            Ok(log) => log,
            Err(error) => { fail_job(&thread_record, format!("Could not open solver log: {error}")); return; }
        };
        command.stdout(Stdio::null()).stderr(Stdio::from(log));
        let Ok(mut child) = command.spawn() else {
            fail_job(&thread_record, "The verified PeleC RDRE solver executable could not be started.".to_string());
            return;
        };
        update_status(&thread_record, "solving", 0.08, "The local solver is running. Progress comes from the runtime status file when available.");
        loop {
            if thread_record.cancel.load(Ordering::Relaxed) {
                let _ = child.kill();
                let _ = child.wait();
                update_status(&thread_record, "cancelled", 0.0, "The local CFD job was cancelled.");
                return;
            }
            match child.try_wait() {
                Ok(Some(exit)) if exit.success() => break,
                Ok(Some(exit)) => {
                    let error = fs::read_to_string(&log_path).ok().filter(|value| !value.trim().is_empty())
                        .unwrap_or_else(|| format!("Solver process exited with {exit}."));
                    fail_job(&thread_record, error);
                    return;
                }
                Ok(None) => {
                    let progress_path = job_dir.join("progress.json");
                    if let Ok(content) = fs::read_to_string(progress_path) {
                        if let Ok(progress) = serde_json::from_str::<Value>(&content) {
                            let fraction = progress.get("progress").and_then(Value::as_f64).unwrap_or(0.08);
                            let state = progress.get("state").and_then(Value::as_str).unwrap_or("solving");
                            let message = progress.get("message").and_then(Value::as_str).unwrap_or("The local solver is running.");
                            update_status(&thread_record, state, fraction, message);
                        }
                    }
                    thread::sleep(Duration::from_millis(700));
                }
                Err(error) => {
                    fail_job(&thread_record, format!("Kythros could not monitor the local solver: {error}"));
                    return;
                }
            }
        }
        update_status(&thread_record, "post-processing", 0.96, "Validating and loading the volumetric result.");
        let content = match fs::read_to_string(&result_path) {
            Ok(content) => content,
            Err(error) => {
                fail_job(&thread_record, format!("The solver completed without a readable volume result: {error}"));
                return;
            }
        };
        let result = match serde_json::from_str::<Value>(&content) {
            Ok(result) => result,
            Err(error) => {
                fail_job(&thread_record, format!("The solver result is not valid JSON: {error}"));
                return;
            }
        };
        if result.get("schema").and_then(Value::as_str) != Some("kythros-rde-3d-volume") {
            fail_job(&thread_record, "The solver did not return a Kythros Full 3D volume result.".to_string());
            return;
        }
        if let Ok(mut status) = thread_record.status.lock() {
            status.state = "completed".to_string();
            status.progress = 1.0;
            status.message = "Full 3D calculation completed on this computer.".to_string();
            status.result_path = Some(result_path.to_string_lossy().to_string());
            status.result = Some(result);
        }
        let _ = run_id;
    });
    record.status.lock().map(|status| status.clone()).map_err(|_| "The local CFD job could not be read.".to_string())
}

#[tauri::command]
fn local_cfd_job_status(store: State<'_, JobStore>, run_id: String) -> Result<JobStatus, String> {
    let jobs = store.0.lock().map_err(|_| "The local job store is unavailable.".to_string())?;
    let record = jobs.get(&run_id).ok_or_else(|| "Kythros could not find this local CFD job.".to_string())?;
    record.status.lock().map(|status| status.clone()).map_err(|_| "The local CFD job could not be read.".to_string())
}

#[tauri::command]
fn cancel_local_cfd(store: State<'_, JobStore>, run_id: String) -> Result<JobStatus, String> {
    let jobs = store.0.lock().map_err(|_| "The local job store is unavailable.".to_string())?;
    let record = jobs.get(&run_id).ok_or_else(|| "Kythros could not find this local CFD job.".to_string())?;
    record.cancel.store(true, Ordering::Relaxed);
    record.status.lock().map(|status| status.clone()).map_err(|_| "The local CFD job could not be read.".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(JobStore::default())
        .invoke_handler(tauri::generate_handler![
            local_runtime_status,
            open_desktop_update,
            install_local_solver_runtime,
            start_local_cfd,
            local_cfd_job_status,
            cancel_local_cfd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Kythros desktop");
}
