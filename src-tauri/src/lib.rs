use std::{
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewWindow,
};

struct DaemonProcess(Mutex<Option<Child>>);

impl Drop for DaemonProcess {
    fn drop(&mut self) {
        if let Ok(mut child) = self.0.lock() {
            if let Some(process) = child.as_mut() {
                let _ = process.kill();
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
    window.close().map_err(|error| error.to_string())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DaemonProcess(Mutex::new(None)))
        .manage(PinState(Mutex::new(true)))
        .invoke_handler(tauri::generate_handler![
            toggle_pin,
            minimize_window,
            toggle_maximize_window,
            close_window,
            set_window_frame,
            start_window_resize,
            open_external_url
        ])
        .setup(|app| {
            if let Some(state) = app.try_state::<DaemonProcess>() {
                if let Ok(mut slot) = state.0.lock() {
                    *slot = spawn_daemon(&app.handle());
                }
            }

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_shadow(false);
                let _ = window.set_resizable(true);
                remove_native_window_frame(&window);
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

fn spawn_daemon(app: &tauri::AppHandle) -> Option<Child> {
    if cfg!(debug_assertions)
        && std::env::var("CODEX_WIDGET_DEV_SPAWN_DAEMON").as_deref() != Ok("1")
    {
        return None;
    }

    let script = resolve_daemon_script(app)?;
    Command::new("node")
        .arg(script)
        .env("CODEX_WIDGET_PORT", "4128")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()
}

fn resolve_daemon_script(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dev_script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist/daemon/standalone.js");
    if dev_script.exists() {
        return Some(dev_script);
    }

    app.path()
        .resource_dir()
        .ok()
        .map(|resource_dir| resource_dir.join("dist/daemon/standalone.js"))
}
