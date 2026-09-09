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
    time::Duration,
};
use tauri::{AppHandle, Manager, State};

const API_VERSION: u32 = 1;
const SOLVER_PATH: &str = "/opt/kythros/bin/kythros-pelec-rdre";


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

#[derive(Default)]
struct JobStore(Mutex<HashMap<String, Arc<JobRecord>>>);

fn command_output(mut command: Command) -> Option<String> {
    command.stdout(Stdio::piped()).stderr(Stdio::null());
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!value.is_empty()).then_some(value)
}

fn quiet_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

fn native_runner(resources: &Path) -> Result<PathBuf, String> {
    for root in [resources.join("resources/native-runtime"), resources.join("native-runtime")] {
        let runner = root.join("kythros-runtime.exe");
        if runner.is_file() && root.join("kythros-pelec-rdre.exe").is_file() && root.join("inputs.template").is_file() {
            return Ok(runner);
        }
    }
    Err("The native Full 3D package is missing. Reinstall Kythros using the latest complete Windows installer.".to_string())
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

fn solver_command(resources: &Path) -> Result<Command, String> {
    if cfg!(target_os = "windows") {
        Ok(quiet_command(native_runner(resources)?))
    } else {
        Ok(quiet_command(SOLVER_PATH))
    }
}

fn solver_version(resources: &Path) -> Option<String> {
    let mut command = solver_command(resources).ok()?;
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

fn runtime_installed(resources: &Path) -> bool {
    if cfg!(target_os = "windows") { native_runner(resources).is_ok() }
    else { Path::new(SOLVER_PATH).is_file() }
}

fn inspect_runtime(resources: &Path) -> RuntimeStatus {
    let installed = runtime_installed(resources);
    let identity = installed.then(|| solver_version(resources)).flatten();
    let runtime_version = identity.as_ref().and_then(|value| {
        value.split(';').next()?.split_whitespace().last().map(str::to_string)
    });
    let solver_version = solver_field(identity.as_ref(), "solver=");
    let solver_accelerator = solver_field(identity.as_ref(), "accelerator=");
    let (gpu_name, gpu_memory_gb) = nvidia_gpu();
    let mut details = Vec::new();
    if cfg!(target_os = "windows") {
        details.push("Native Windows CPU solver included with Kythros.".to_string());
    } else {
        details.push(format!("Solver runtime: {SOLVER_PATH}"));
    }
    if !installed {
        details.push("Reinstall Kythros using the complete Windows installer to restore the included solver.".to_string());
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
            cuda_available: !cfg!(target_os = "windows") && gpu_name.is_some(),
            gpu_name,
            gpu_memory_gb,
        },
        details,
    }
}

#[tauri::command]
async fn local_runtime_status(app: AppHandle) -> Result<RuntimeStatus, String> {
    let resources = app.path().resource_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || inspect_runtime(&resources))
        .await.map_err(|error| error.to_string())
}

// Compatibility for older UI clients: the solver is now installed with the app.
#[tauri::command]
async fn install_local_solver_runtime(app: AppHandle) -> Result<RuntimeStatus, String> {
    let status = local_runtime_status(app).await?;
    if !status.solver_installed {
        return Err("The included solver did not pass its check. Reinstall the latest complete Kythros Windows installer.".to_string());
    }
    Ok(status)
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
fn start_local_cfd(app: AppHandle, store: State<'_, JobStore>, request: Value) -> Result<JobStatus, String> {
    let decoded: RunRequest = serde_json::from_value(request.clone()).map_err(|error| format!("Invalid Full 3D run request: {error}"))?;
    if decoded.schema != "kythros-local-rde-3d-request" || decoded.format_version != API_VERSION {
        return Err("Kythros desktop received an incompatible Full 3D run request.".to_string());
    }
    if decoded.run_id.is_empty() || decoded.run_id.len() > 96 || !decoded.run_id.chars().all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_')) {
        return Err("The Full 3D run identifier is invalid.".to_string());
    }
    let _ = decoded.remaining;
    let resources = app.path().resource_dir().map_err(|error| error.to_string())?;
    let mut command = solver_command(&resources)?;
    let base = app.path().app_local_data_dir().map_err(|error| format!("Kythros could not open its local job directory: {error}"))?;
    let job_dir = base.join("cfd-jobs").join(&decoded.run_id);
    fs::create_dir_all(base.join("cfd-jobs")).map_err(|error| error.to_string())?;
    fs::create_dir(&job_dir).map_err(|error| format!("Kythros could not create the local job directory: {error}"))?;
    let request_path = job_dir.join("request.json");
    let result_path = job_dir.join("kythros-volume-result.json");
    fs::write(&request_path, serde_json::to_vec_pretty(&request).map_err(|error| error.to_string())?).map_err(|error| format!("Kythros could not save the run request: {error}"))?;
    command.arg("--request").arg(&request_path).arg("--result").arg(&result_path);
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
        let runtime_log = job_dir.join("runtime.log");
        let log = match fs::File::create(&runtime_log) {
            Ok(log) => log,
            Err(error) => { fail_job(&thread_record, error.to_string()); return; }
        };
        command.current_dir(&job_dir).stdout(Stdio::null()).stderr(Stdio::from(log));
        let Ok(mut child) = command.spawn() else {
            fail_job(&thread_record, "The verified PeleC RDRE solver executable could not be started.".to_string());
            return;
        };
        update_status(&thread_record, "solving", 0.08, "The local solver is running. Progress comes from the runtime status file when available.");
        loop {
            if thread_record.cancel.load(Ordering::Relaxed) {
                let _ = fs::write(job_dir.join("cancel.flag"), b"cancel");
                for _ in 0..50 {
                    if matches!(child.try_wait(), Ok(Some(_))) { break; }
                    thread::sleep(Duration::from_millis(200));
                }
                if matches!(child.try_wait(), Ok(None)) {
                    if cfg!(target_os = "windows") {
                        let _ = quiet_command("taskkill.exe").args(["/PID", &child.id().to_string(), "/T", "/F"]).status();
                    }
                    let _ = child.kill();
                }
                let _ = child.wait();
                update_status(&thread_record, "cancelled", 0.0, "The local CFD job was cancelled.");
                return;
            }
            match child.try_wait() {
                Ok(Some(exit)) if exit.success() => break,
                Ok(Some(exit)) => {
                    let detail = fs::read_to_string(&runtime_log).unwrap_or_default();
                    let error = format!("Full 3D stopped ({exit}). {}\nRun files: {}", detail.trim(), job_dir.display());
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
    // CI invokes the installed app to check the same resource lookup and launcher
    // used by the Run Full 3D command, without opening a WebView.
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_some_and(|arg| arg == "--test-native-runtime") {
        let result = (|| -> Result<bool, String> {
            let executable = std::env::current_exe().map_err(|error| error.to_string())?;
            let root = executable.parent().ok_or("Missing application directory")?;
            let destination = args.get(2).ok_or("Missing test directory")?;
            let mut command = solver_command(root)?;
            Ok(command.arg("--self-test").arg(destination).status().map_err(|error| error.to_string())?.success())
        })();
        match result { Ok(true) => std::process::exit(0), other => { eprintln!("Native package test failed: {other:?}"); std::process::exit(1); } }
    }
    tauri::Builder::default()
        .manage(JobStore::default())
        .invoke_handler(tauri::generate_handler![
            local_runtime_status,
            install_local_solver_runtime,
            start_local_cfd,
            local_cfd_job_status,
            cancel_local_cfd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Kythros desktop");
}

