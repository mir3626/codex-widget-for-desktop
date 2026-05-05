use std::{
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewWindow,
};

const DAEMON_PORT: &str = "4128";
const DAEMON_RESTART_BASE_DELAY_MS: u64 = 750;
const DAEMON_RESTART_MAX_DELAY_MS: u64 = 15_000;
const DAEMON_STABLE_RUNTIME_MS: u64 = 10_000;
const DAEMON_STATUS_POLL_MS: u64 = 500;

type DaemonDiagnostics = Arc<Mutex<NativeDaemonStatus>>;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeDaemonStatus {
    enabled: bool,
    state: String,
    pid: Option<u32>,
    restart_count: u32,
    last_event: Option<String>,
    last_error: Option<String>,
}

impl Default for NativeDaemonStatus {
    fn default() -> Self {
        Self {
            enabled: false,
            state: "disabled".to_string(),
            pid: None,
            restart_count: 0,
            last_event: None,
            last_error: None,
        }
    }
}

struct DaemonSupervisor {
    child: Arc<Mutex<Option<Child>>>,
    stop: Arc<AtomicBool>,
    thread: Mutex<Option<JoinHandle<()>>>,
    diagnostics: DaemonDiagnostics,
}

impl DaemonSupervisor {
    fn new() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            stop: Arc::new(AtomicBool::new(false)),
            thread: Mutex::new(None),
            diagnostics: Arc::new(Mutex::new(NativeDaemonStatus::default())),
        }
    }

    fn start(&self, app: &tauri::AppHandle) {
        if !should_spawn_daemon() {
            update_daemon_status(&self.diagnostics, |status| {
                status.enabled = false;
                status.state = "disabled".to_string();
                status.last_event = Some("native daemon spawn disabled in dev mode".to_string());
            });
            return;
        }

        if self
            .thread
            .lock()
            .map(|thread| thread.is_some())
            .unwrap_or(true)
        {
            return;
        }

        let Some(script) = resolve_daemon_script(app) else {
            eprintln!("[codex-widget] daemon script could not be resolved");
            update_daemon_status(&self.diagnostics, |status| {
                status.enabled = true;
                status.state = "error".to_string();
                status.last_error = Some("daemon script could not be resolved".to_string());
            });
            return;
        };
        let node_runtime = resolve_node_runtime(app);

        update_daemon_status(&self.diagnostics, |status| {
            status.enabled = true;
            status.state = "starting".to_string();
            status.last_event = Some(format!(
                "native daemon supervisor starting with {}",
                node_runtime.display()
            ));
            status.last_error = None;
        });

        let child = Arc::clone(&self.child);
        let stop = Arc::clone(&self.stop);
        let diagnostics = Arc::clone(&self.diagnostics);
        let handle = thread::Builder::new()
            .name("codex-widget-daemon-supervisor".to_string())
            .spawn(move || supervise_daemon(node_runtime, script, child, stop, diagnostics));

        match handle {
            Ok(handle) => {
                if let Ok(mut slot) = self.thread.lock() {
                    *slot = Some(handle);
                }
            }
            Err(error) => {
                eprintln!("[codex-widget] failed to start daemon supervisor: {error}");
                update_daemon_status(&self.diagnostics, |status| {
                    status.enabled = true;
                    status.state = "error".to_string();
                    status.last_error = Some(error.to_string());
                });
            }
        }
    }
}

impl Drop for DaemonSupervisor {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Ok(mut child) = self.child.lock() {
            if let Some(process) = child.as_mut() {
                let _ = process.kill();
            }
        }
        if let Ok(mut thread) = self.thread.lock() {
            if let Some(handle) = thread.take() {
                let _ = handle.join();
            }
        }
    }
}

struct PinState(Mutex<bool>);

#[tauri::command]
fn toggle_pin(window: WebviewWindow, state: tauri::State<'_, PinState>) -> Result<bool, String> {
    let mut pinned = state
        .0
        .lock()
        .map_err(|_| "failed to lock pin state".to_string())?;
    *pinned = !*pinned;
    apply_pin_state(&window, *pinned)?;
    Ok(*pinned)
}

#[tauri::command]
fn minimize_window(window: WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
fn toggle_maximize_window(
    window: WebviewWindow,
    state: tauri::State<'_, PinState>,
) -> Result<bool, String> {
    let is_maximized = window.is_maximized().map_err(|error| error.to_string())?;
    let pinned = *state
        .0
        .lock()
        .map_err(|_| "failed to lock pin state".to_string())?;
    if is_maximized {
        window.unmaximize().map_err(|error| error.to_string())?;
        remove_native_window_frame(&window);
        apply_pin_state(&window, pinned)?;
        Ok(false)
    } else {
        window
            .set_always_on_top(false)
            .map_err(|error| error.to_string())?;
        window.maximize().map_err(|error| error.to_string())?;
        remove_native_window_frame(&window);
        Ok(true)
    }
}

fn apply_pin_state(window: &WebviewWindow, pinned: bool) -> Result<(), String> {
    let is_maximized = window.is_maximized().unwrap_or(false);
    window
        .set_always_on_top(pinned && !is_maximized)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn close_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn set_window_frame(
    window: WebviewWindow,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    set_native_window_frame(&window, x, y, width, height)
}

#[tauri::command]
fn start_window_resize(window: WebviewWindow, direction: String) -> Result<(), String> {
    start_native_window_resize(&window, &direction)
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let lower_url = url.to_ascii_lowercase();
    if !(lower_url.starts_with("http://") || lower_url.starts_with("https://")) {
        return Err("only http and https URLs can be opened".to_string());
    }

    open_url_with_system_browser(&url)
}

#[tauri::command]
fn get_autostart_enabled() -> Result<bool, String> {
    read_autostart_enabled()
}

#[tauri::command]
fn set_autostart_enabled(enabled: bool) -> Result<bool, String> {
    write_autostart_enabled(enabled)?;
    read_autostart_enabled()
}

#[tauri::command]
fn get_native_daemon_status(
    state: tauri::State<'_, DaemonSupervisor>,
) -> Result<NativeDaemonStatus, String> {
    state
        .diagnostics
        .lock()
        .map(|status| status.clone())
        .map_err(|_| "failed to lock daemon supervisor status".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DaemonSupervisor::new())
        .manage(PinState(Mutex::new(true)))
        .invoke_handler(tauri::generate_handler![
            toggle_pin,
            minimize_window,
            toggle_maximize_window,
            close_window,
            set_window_frame,
            start_window_resize,
            open_external_url,
            get_autostart_enabled,
            set_autostart_enabled,
            get_native_daemon_status
        ])
        .setup(|app| {
            if let Some(state) = app.try_state::<DaemonSupervisor>() {
                state.start(&app.handle());
            }

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_shadow(false);
                let _ = window.set_resizable(true);
                remove_native_window_frame(&window);
                if std::env::var("CODEX_WIDGET_START_HIDDEN").as_deref() == Ok("1") {
                    let _ = window.hide();
                }
            }

            let show_item = MenuItem::with_id(app, "show", "Show widget", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "Hide widget", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .tooltip("Codex Widget")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } => {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let is_visible = window.is_visible().unwrap_or(false);
                            if is_visible {
                                let _ = window.hide();
                            } else {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Codex Widget");
}

#[cfg(target_os = "windows")]
fn remove_native_window_frame(window: &WebviewWindow) {
    use std::ffi::c_void;

    const GWL_STYLE: i32 = -16;
    const WS_BORDER: isize = 0x00800000;
    const WS_CAPTION: isize = 0x00C00000;
    const WS_DLGFRAME: isize = 0x00400000;
    const WS_THICKFRAME: isize = 0x00040000;
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_FRAMECHANGED: u32 = 0x0020;

    extern "system" {
        fn GetWindowLongPtrW(hwnd: *mut c_void, index: i32) -> isize;
        fn SetWindowLongPtrW(hwnd: *mut c_void, index: i32, new_long: isize) -> isize;
        fn SetWindowPos(
            hwnd: *mut c_void,
            hwnd_insert_after: *mut c_void,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            flags: u32,
        ) -> i32;
    }

    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let current_style = GetWindowLongPtrW(hwnd.0, GWL_STYLE);
            let borderless_style =
                current_style & !(WS_CAPTION | WS_BORDER | WS_DLGFRAME | WS_THICKFRAME);
            if borderless_style != current_style {
                let _ = SetWindowLongPtrW(hwnd.0, GWL_STYLE, borderless_style);
                let _ = SetWindowPos(
                    hwnd.0,
                    std::ptr::null_mut(),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
                );
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn remove_native_window_frame(_window: &WebviewWindow) {}

#[cfg(target_os = "windows")]
fn set_native_window_frame(
    window: &WebviewWindow,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    use std::ffi::c_void;

    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;

    extern "system" {
        fn SetWindowPos(
            hwnd: *mut c_void,
            hwnd_insert_after: *mut c_void,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            flags: u32,
        ) -> i32;
    }

    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let result = unsafe {
        SetWindowPos(
            hwnd.0,
            std::ptr::null_mut(),
            x,
            y,
            width as i32,
            height as i32,
            SWP_NOZORDER | SWP_NOACTIVATE,
        )
    };

    if result == 0 {
        Err(std::io::Error::last_os_error().to_string())
    } else {
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
fn set_native_window_frame(
    window: &WebviewWindow,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    window
        .set_size(tauri::PhysicalSize::new(width, height))
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn start_native_window_resize(window: &WebviewWindow, direction: &str) -> Result<(), String> {
    use std::{
        ffi::c_void,
        thread,
        time::{Duration, Instant},
    };

    const GWL_STYLE: i32 = -16;
    const WS_BORDER: isize = 0x00800000;
    const WS_CAPTION: isize = 0x00C00000;
    const WS_DLGFRAME: isize = 0x00400000;
    const WS_THICKFRAME: isize = 0x00040000;
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_FRAMECHANGED: u32 = 0x0020;
    const WM_NCLBUTTONDOWN: u32 = 0x00A1;
    const VK_LBUTTON: i32 = 0x01;

    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }

    extern "system" {
        fn GetWindowLongPtrW(hwnd: *mut c_void, index: i32) -> isize;
        fn SetWindowLongPtrW(hwnd: *mut c_void, index: i32, new_long: isize) -> isize;
        fn SetWindowPos(
            hwnd: *mut c_void,
            hwnd_insert_after: *mut c_void,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            flags: u32,
        ) -> i32;
        fn GetCursorPos(point: *mut Point) -> i32;
        fn ReleaseCapture() -> i32;
        fn PostMessageW(hwnd: *mut c_void, message: u32, wparam: usize, lparam: isize) -> i32;
        fn GetAsyncKeyState(virtual_key: i32) -> i16;
    }

    let hit_test = resize_hit_test(direction)?;
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let hwnd_value = hwnd.0 as isize;
    let original_style = unsafe { GetWindowLongPtrW(hwnd.0, GWL_STYLE) };
    let resize_style = (original_style | WS_THICKFRAME) & !(WS_CAPTION | WS_BORDER | WS_DLGFRAME);

    unsafe {
        let mut point = Point { x: 0, y: 0 };
        if GetCursorPos(&mut point as *mut Point) == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let lparam = (((point.y as u32) & 0xffff) << 16 | ((point.x as u32) & 0xffff)) as isize;

        let _ = SetWindowLongPtrW(hwnd.0, GWL_STYLE, resize_style);
        let _ = SetWindowPos(
            hwnd.0,
            std::ptr::null_mut(),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );

        let _ = ReleaseCapture();
        if PostMessageW(hwnd.0, WM_NCLBUTTONDOWN, hit_test, lparam) == 0 {
            let error = std::io::Error::last_os_error().to_string();
            let _ = SetWindowLongPtrW(hwnd.0, GWL_STYLE, original_style);
            let _ = SetWindowPos(
                hwnd.0,
                std::ptr::null_mut(),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
            return Err(error);
        }
    }

    thread::spawn(move || {
        let hwnd = hwnd_value as *mut c_void;
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            let is_left_button_down = unsafe { GetAsyncKeyState(VK_LBUTTON) } < 0;
            if !is_left_button_down || Instant::now() >= deadline {
                break;
            }
            thread::sleep(Duration::from_millis(16));
        }

        unsafe {
            let _ = SetWindowLongPtrW(hwnd, GWL_STYLE, original_style);
            let _ = SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    });

    Ok(())
}

#[cfg(target_os = "windows")]
fn resize_hit_test(direction: &str) -> Result<usize, String> {
    match direction {
        "West" => Ok(10),
        "East" => Ok(11),
        "North" => Ok(12),
        "NorthWest" => Ok(13),
        "NorthEast" => Ok(14),
        "South" => Ok(15),
        "SouthWest" => Ok(16),
        "SouthEast" => Ok(17),
        _ => Err("invalid resize direction".to_string()),
    }
}

#[cfg(not(target_os = "windows"))]
fn start_native_window_resize(_window: &WebviewWindow, _direction: &str) -> Result<(), String> {
    Err("native resize command is only implemented on Windows".to_string())
}

#[cfg(target_os = "windows")]
fn open_url_with_system_browser(url: &str) -> Result<(), String> {
    Command::new("rundll32.exe")
        .arg("url.dll,FileProtocolHandler")
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn open_url_with_system_browser(url: &str) -> Result<(), String> {
    Command::new("open")
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_url_with_system_browser(url: &str) -> Result<(), String> {
    Command::new("xdg-open")
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn read_autostart_enabled() -> Result<bool, String> {
    let output = Command::new("reg.exe")
        .args([
            "query",
            "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
            "/v",
            "Codex Widget",
        ])
        .stdin(Stdio::null())
        .output()
        .map_err(|error| error.to_string())?;

    Ok(output.status.success())
}

#[cfg(not(target_os = "windows"))]
fn read_autostart_enabled() -> Result<bool, String> {
    Ok(false)
}

#[cfg(target_os = "windows")]
fn write_autostart_enabled(enabled: bool) -> Result<(), String> {
    let key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    if enabled {
        let exe = std::env::current_exe().map_err(|error| error.to_string())?;
        let value = format!("\"{}\"", exe.display());
        let status = Command::new("reg.exe")
            .args([
                "add",
                key,
                "/v",
                "Codex Widget",
                "/t",
                "REG_SZ",
                "/d",
                &value,
                "/f",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|error| error.to_string())?;
        if !status.success() {
            return Err("failed to enable start at login".to_string());
        }
        return Ok(());
    }

    let status = Command::new("reg.exe")
        .args(["delete", key, "/v", "Codex Widget", "/f"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| error.to_string())?;
    if !status.success() && read_autostart_enabled()? {
        return Err("failed to disable start at login".to_string());
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn write_autostart_enabled(_enabled: bool) -> Result<(), String> {
    Err("start at login is currently implemented on Windows only".to_string())
}

fn should_spawn_daemon() -> bool {
    !(cfg!(debug_assertions)
        && std::env::var("CODEX_WIDGET_DEV_SPAWN_DAEMON").as_deref() != Ok("1"))
}

fn supervise_daemon(
    node_runtime: PathBuf,
    script: PathBuf,
    child_slot: Arc<Mutex<Option<Child>>>,
    stop: Arc<AtomicBool>,
    diagnostics: DaemonDiagnostics,
) {
    let mut crash_count = 0u32;

    while !stop.load(Ordering::SeqCst) {
        let started_at = Instant::now();

        match spawn_daemon_child(&node_runtime, &script) {
            Ok(child) => {
                let pid = child.id();
                if let Ok(mut slot) = child_slot.lock() {
                    *slot = Some(child);
                } else {
                    return;
                }

                eprintln!("[codex-widget] daemon started pid={pid}");
                update_daemon_status(&diagnostics, |status| {
                    status.enabled = true;
                    status.state = "running".to_string();
                    status.pid = Some(pid);
                    status.last_event = Some(format!("daemon started pid={pid}"));
                    status.last_error = None;
                });
                wait_for_daemon_exit(&child_slot, &stop, &diagnostics);

                if stop.load(Ordering::SeqCst) {
                    break;
                }

                if started_at.elapsed() >= Duration::from_millis(DAEMON_STABLE_RUNTIME_MS) {
                    crash_count = 0;
                } else {
                    crash_count = crash_count.saturating_add(1);
                }
            }
            Err(error) => {
                crash_count = crash_count.saturating_add(1);
                update_daemon_status(&diagnostics, |status| {
                    status.enabled = true;
                    status.state = "error".to_string();
                    status.pid = None;
                    status.last_error = Some(error);
                });
            }
        }

        if stop.load(Ordering::SeqCst) {
            break;
        }

        let delay = daemon_restart_delay(crash_count.saturating_sub(1));
        eprintln!(
            "[codex-widget] daemon restart scheduled in {}ms",
            delay.as_millis()
        );
        update_daemon_status(&diagnostics, |status| {
            status.enabled = true;
            status.state = "restarting".to_string();
            status.pid = None;
            status.restart_count = status.restart_count.saturating_add(1);
            status.last_event = Some(format!(
                "daemon restart scheduled in {}ms",
                delay.as_millis()
            ));
        });
        sleep_until_restart_or_stop(&stop, delay);
    }

    kill_daemon_child(&child_slot);
    update_daemon_status(&diagnostics, |status| {
        status.state = "stopped".to_string();
        status.pid = None;
        status.last_event = Some("native daemon supervisor stopped".to_string());
    });
}

fn wait_for_daemon_exit(
    child_slot: &Arc<Mutex<Option<Child>>>,
    stop: &Arc<AtomicBool>,
    diagnostics: &DaemonDiagnostics,
) {
    loop {
        if stop.load(Ordering::SeqCst) {
            kill_daemon_child(child_slot);
            return;
        }

        let status = match child_slot.lock() {
            Ok(mut slot) => match slot.as_mut() {
                Some(child) => child.try_wait(),
                None => return,
            },
            Err(_) => return,
        };

        match status {
            Ok(Some(status)) => {
                if let Ok(mut slot) = child_slot.lock() {
                    *slot = None;
                }
                eprintln!("[codex-widget] daemon exited with {status}");
                update_daemon_status(diagnostics, |diagnostics| {
                    diagnostics.state = "restarting".to_string();
                    diagnostics.pid = None;
                    diagnostics.last_event = Some(format!("daemon exited with {status}"));
                });
                return;
            }
            Ok(None) => thread::sleep(Duration::from_millis(DAEMON_STATUS_POLL_MS)),
            Err(error) => {
                if let Ok(mut slot) = child_slot.lock() {
                    *slot = None;
                }
                eprintln!("[codex-widget] failed to inspect daemon status: {error}");
                update_daemon_status(diagnostics, |diagnostics| {
                    diagnostics.state = "error".to_string();
                    diagnostics.pid = None;
                    diagnostics.last_error = Some(error.to_string());
                });
                return;
            }
        }
    }
}

fn kill_daemon_child(child_slot: &Arc<Mutex<Option<Child>>>) {
    if let Ok(mut slot) = child_slot.lock() {
        if let Some(mut child) = slot.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn sleep_until_restart_or_stop(stop: &Arc<AtomicBool>, delay: Duration) {
    let deadline = Instant::now() + delay;
    while !stop.load(Ordering::SeqCst) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(100));
    }
}

fn daemon_restart_delay(crash_count: u32) -> Duration {
    let multiplier = 1u64 << crash_count.min(5);
    let delay_ms = (DAEMON_RESTART_BASE_DELAY_MS * multiplier).min(DAEMON_RESTART_MAX_DELAY_MS);
    Duration::from_millis(delay_ms)
}

fn update_daemon_status(
    diagnostics: &DaemonDiagnostics,
    update: impl FnOnce(&mut NativeDaemonStatus),
) {
    if let Ok(mut status) = diagnostics.lock() {
        update(&mut status);
    }
}

fn spawn_daemon_child(node_runtime: &PathBuf, script: &PathBuf) -> Result<Child, String> {
    Command::new(node_runtime)
        .arg(script)
        .env("CODEX_WIDGET_PORT", DAEMON_PORT)
        .env(
            "CODEX_WIDGET_NATIVE_PARENT_PID",
            std::process::id().to_string(),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            eprintln!("[codex-widget] failed to start daemon: {error}");
            error.to_string()
        })
}

fn resolve_daemon_script(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dev_script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist/daemon/standalone.js");
    if cfg!(debug_assertions) && dev_script.exists() {
        return Some(dev_script);
    }

    for resource_dir in resource_roots(app) {
        let bundled_script = resource_dir.join("dist/daemon-bundle/standalone.js");
        if bundled_script.exists() {
            return Some(bundled_script);
        }

        let legacy_script = resource_dir.join("dist/daemon/standalone.js");
        if legacy_script.exists() {
            return Some(legacy_script);
        }
    }

    if dev_script.exists() {
        return Some(dev_script);
    }

    None
}

fn resolve_node_runtime(app: &tauri::AppHandle) -> PathBuf {
    for resource_dir in resource_roots(app) {
        let bundled_runtime = resource_dir
            .join("dist/node-runtime")
            .join(node_runtime_filename());
        if bundled_runtime.exists() {
            return bundled_runtime;
        }
    }

    PathBuf::from("node")
}

fn resource_roots(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        roots.push(resource_dir);
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            roots.push(exe_dir.join("_up_"));
            roots.push(exe_dir.to_path_buf());
        }
    }

    roots
}

fn node_runtime_filename() -> &'static str {
    if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn daemon_restart_delay_uses_capped_exponential_backoff() {
        assert_eq!(daemon_restart_delay(0), Duration::from_millis(750));
        assert_eq!(daemon_restart_delay(1), Duration::from_millis(1_500));
        assert_eq!(daemon_restart_delay(2), Duration::from_millis(3_000));
        assert_eq!(daemon_restart_delay(3), Duration::from_millis(6_000));
        assert_eq!(daemon_restart_delay(4), Duration::from_millis(12_000));
        assert_eq!(daemon_restart_delay(5), Duration::from_millis(15_000));
        assert_eq!(daemon_restart_delay(99), Duration::from_millis(15_000));
    }

    #[test]
    fn daemon_supervisor_restarts_exited_child() {
        if Command::new("node").arg("--version").output().is_err() {
            eprintln!("skipping daemon supervisor restart test because node is unavailable");
            return;
        }

        let test_dir = std::env::temp_dir().join(format!(
            "codex-widget-supervisor-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock before unix epoch")
                .as_millis()
        ));
        fs::create_dir_all(&test_dir).expect("failed to create supervisor test dir");
        let script = test_dir.join("daemon-exit.js");
        let counter = test_dir.join("restart-count.txt");
        fs::write(
            &script,
            r#"const fs = require("fs");
const file = process.env.CODEX_WIDGET_SUPERVISOR_TEST_COUNTER;
const current = fs.existsSync(file) ? Number(fs.readFileSync(file, "utf8")) : 0;
fs.writeFileSync(file, String(current + 1));
process.exit(1);
"#,
        )
        .expect("failed to write supervisor test script");

        std::env::set_var("CODEX_WIDGET_SUPERVISOR_TEST_COUNTER", &counter);
        let child_slot = Arc::new(Mutex::new(None));
        let stop = Arc::new(AtomicBool::new(false));
        let diagnostics = Arc::new(Mutex::new(NativeDaemonStatus::default()));
        let node_runtime = PathBuf::from("node");
        let worker_child_slot = Arc::clone(&child_slot);
        let worker_stop = Arc::clone(&stop);
        let worker_diagnostics = Arc::clone(&diagnostics);
        let handle = thread::spawn(move || {
            supervise_daemon(
                node_runtime,
                script,
                worker_child_slot,
                worker_stop,
                worker_diagnostics,
            )
        });

        let deadline = Instant::now() + Duration::from_secs(6);
        let mut restart_count = 0;
        while Instant::now() < deadline {
            restart_count = fs::read_to_string(&counter)
                .ok()
                .and_then(|value| value.parse::<u32>().ok())
                .unwrap_or(0);
            if restart_count >= 2 {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }

        stop.store(true, Ordering::SeqCst);
        kill_daemon_child(&child_slot);
        handle.join().expect("supervisor thread panicked");
        std::env::remove_var("CODEX_WIDGET_SUPERVISOR_TEST_COUNTER");
        let _ = fs::remove_dir_all(&test_dir);

        assert!(
            restart_count >= 2,
            "expected supervisor to restart exited child at least once, saw {restart_count}"
        );
        let snapshot = diagnostics
            .lock()
            .expect("diagnostics lock poisoned")
            .clone();
        assert!(
            snapshot.restart_count >= 1,
            "expected diagnostics to record at least one restart, saw {}",
            snapshot.restart_count
        );
    }
}
