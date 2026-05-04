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
    window
        .set_always_on_top(*pinned)
        .map_err(|error| error.to_string())?;
    Ok(*pinned)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DaemonProcess(Mutex::new(None)))
        .manage(PinState(Mutex::new(true)))
        .invoke_handler(tauri::generate_handler![toggle_pin])
        .setup(|app| {
            if let Some(state) = app.try_state::<DaemonProcess>() {
                if let Ok(mut slot) = state.0.lock() {
                    *slot = spawn_daemon(&app.handle());
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

fn spawn_daemon(app: &tauri::AppHandle) -> Option<Child> {
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
