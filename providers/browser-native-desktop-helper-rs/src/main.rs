use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::io::{self, Read};
use std::thread::sleep;
use std::time::Duration;
use sysinfo::System;
use uiautomation::patterns::{UIInvokePattern, UISelectionItemPattern, UITogglePattern, UIValuePattern};
use uiautomation::types::{ControlType, Rect as UiaRect, ToggleState};
use uiautomation::{UIAutomation, UIElement};

const SCHEMA_VERSION: &str = "browser-native-desktop-helper.v1";
const HELPER_VERSION: &str = "0.1.0";
const MAX_VISITED_NODES: usize = 450;
const MAX_ELEMENTS: usize = 120;
const MAX_DEPTH: usize = 9;
const BROWSER_PROCESS_NAMES: &[&str] = &["chrome", "msedge", "chromium", "brave", "firefox"];

fn main() {
    let response = match run() {
        Ok(response) => response,
        Err(error) => error_response(error.to_string(), json!({})),
    };
    let output = serde_json::to_string(&response).unwrap_or_else(|error| {
        format!(
            "{{\"ok\":false,\"error\":\"failed to serialize helper response: {}\",\"metadata\":{{\"helper\":\"browser-native-desktop-helper\",\"helperImplementation\":\"rust-native\"}}}}",
            json_escape(&error.to_string())
        )
    });
    print!("{output}");
}

fn run() -> Result<HelperResponse> {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .context("Native desktop helper failed to read stdin.")?;
    if input.trim().is_empty() {
        return Ok(error_response(
            "Native desktop helper received an empty request.".to_string(),
            json!({}),
        ));
    }

    let request: HelperRequest = serde_json::from_str(&input).context("Native desktop helper received invalid JSON.")?;
    if request.schema_version != SCHEMA_VERSION {
        return Ok(error_response(
            format!(
                "Unsupported native desktop helper schemaVersion: {}",
                request.schema_version
            ),
            json!({ "schemaVersion": request.schema_version }),
        ));
    }

    match request.command.as_str() {
        "status" => command_status(&request),
        "observe" => command_observe(&request),
        "execute" => command_execute(&request),
        other => Ok(error_response(
            format!("Unsupported native desktop helper command: {other}"),
            json!({ "command": other }),
        )),
    }
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
#[serde(rename_all = "camelCase")]
struct HelperRequest {
    schema_version: String,
    request_id: Option<String>,
    command: String,
    timeout_ms: Option<u64>,
    session: HelperSession,
    action: Option<BrowserAction>,
    target: Option<BrowserElementTarget>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
#[serde(rename_all = "camelCase")]
struct HelperSession {
    id: Option<String>,
    mode: Option<String>,
    source: Option<BrowserActionSource>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
#[serde(rename_all = "camelCase")]
struct BrowserActionSource {
    kind: Option<String>,
    browser: Option<String>,
    tab_id: Option<String>,
    url: Option<String>,
    title: Option<String>,
    window_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
#[serde(tag = "type", rename_all = "camelCase")]
enum BrowserAction {
    Read {
        reason: Option<String>,
    },
    Click {
        target: Option<ElementTarget>,
        button: Option<String>,
    },
    #[serde(rename = "type")]
    TypeText {
        target: Option<ElementTarget>,
        text: Option<String>,
        clear_first: Option<bool>,
        submit: Option<bool>,
    },
    Select {
        target: Option<ElementTarget>,
        value: Option<String>,
    },
    Check {
        target: Option<ElementTarget>,
        checked: Option<bool>,
    },
    Scroll {
        direction: Option<String>,
        amount: Option<Value>,
        target: Option<ElementTarget>,
    },
    Navigate {
        url: Option<String>,
    },
    Back,
    Forward,
    Reload,
    Hotkey {
        keys: Vec<String>,
    },
    Screenshot {
        full_page: Option<bool>,
    },
    Evaluate {
        code: Option<String>,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum ElementTarget {
    ElementId { id: String },
    Selector { selector: String },
    Text { text: String, role: Option<String> },
    Bbox { bbox: Rect },
    Focused,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
#[serde(rename_all = "camelCase")]
struct BrowserElementTarget {
    id: Option<String>,
    role: Option<String>,
    tag_name: Option<String>,
    label: Option<String>,
    text: Option<String>,
    value: Option<String>,
    selector: Option<String>,
    bbox: Option<Rect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Rect {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HelperResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    observation: Option<HelperSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    after: Option<HelperSnapshot>,
    metadata: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HelperSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    title: String,
    text: String,
    windows: Vec<WindowInfo>,
    elements: Vec<ElementInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowInfo {
    process_name: String,
    id: u32,
    title: String,
}

#[derive(Clone)]
struct BrowserWindow {
    info: WindowInfo,
    element: UIElement,
}

#[derive(Clone)]
struct ElementEntry {
    element: UIElement,
    info: ElementInfo,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ElementInfo {
    id: String,
    role: String,
    tag_name: String,
    label: String,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<String>,
    selector: String,
    visible: bool,
    enabled: bool,
    editable: bool,
    confidence: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    bbox: Option<Rect>,
    risk_hints: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    checked: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    selected: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    automation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    class_name: Option<String>,
}

fn command_status(request: &HelperRequest) -> Result<HelperResponse> {
    let resolved = resolve_browser_window(request)?;
    let observation = HelperSnapshot {
        url: None,
        title: "Windows browser UIA native helper status".to_string(),
        text: "Bounded browser-window UI Automation native helper is available.".to_string(),
        windows: resolved.windows.iter().map(|window| window.info.clone()).collect(),
        elements: Vec::new(),
    };
    Ok(HelperResponse {
        ok: true,
        error: None,
        observation: Some(observation),
        after: None,
        metadata: metadata(
            "status",
            None,
            json!({
                "scope": "browser_windows_only",
                "windows": resolved.windows.len(),
                "capabilities": ["read", "click", "type", "select", "check", "scroll", "navigate", "back", "forward", "reload"]
            }),
        ),
    })
}

fn command_observe(request: &HelperRequest) -> Result<HelperResponse> {
    let resolved = resolve_browser_window(request)?;
    Ok(HelperResponse {
        ok: true,
        error: None,
        observation: Some(build_observation(&resolved)?),
        after: None,
        metadata: metadata("observe", None, json!({ "scope": "browser_windows_only" })),
    })
}

fn command_execute(request: &HelperRequest) -> Result<HelperResponse> {
    let action = match request.action.clone() {
        Some(action) => action,
        None => {
            return Ok(error_response(
                "Native desktop helper execute request is missing action.type.".to_string(),
                metadata("execute", None, json!({})),
            ))
        }
    };

    if matches!(action, BrowserAction::Evaluate { .. }) {
        return Ok(error_response(
            "Native desktop helper does not support evaluate. Use explicit full_control_dev adapter policy outside UIA helper.".to_string(),
            metadata("execute", Some("evaluate"), json!({})),
        ));
    }

    if let BrowserAction::TypeText { text, .. } = &action {
        if is_sensitive_text(text.as_deref().unwrap_or_default()) {
            return Ok(error_response(
                "Native desktop helper blocked sensitive text input.".to_string(),
                metadata("execute", Some("type"), json!({ "method": "blocked_sensitive_text" })),
            ));
        }
    }

    let resolved = resolve_browser_window(request)?;
    let action_label = action_type(&action);
    if matches!(action, BrowserAction::Read { .. }) {
        return Ok(HelperResponse {
            ok: true,
            error: None,
            observation: None,
            after: Some(build_observation(&resolved)?),
            metadata: metadata("execute", Some("read"), json!({})),
        });
    }

    let method = execute_action(&resolved, &action, request)?;
    if method.starts_with("missing_")
        || method.starts_with("blocked_")
        || method.starts_with("failed_")
        || method.starts_with("unsupported")
    {
        return Ok(HelperResponse {
            ok: false,
            error: Some(format!(
                "Native desktop helper could not execute {}: {}",
                action_label, method
            )),
            observation: None,
            after: None,
            metadata: metadata(
                "execute",
                Some(action_label),
                json!({ "method": method }),
            ),
        });
    }

    sleep(Duration::from_millis(180));
    let after = resolve_browser_window(request)?;
    Ok(HelperResponse {
        ok: true,
        error: None,
        observation: None,
        after: Some(build_observation(&after)?),
        metadata: metadata(
            "execute",
            Some(action_label),
            json!({ "method": method }),
        ),
    })
}

struct ResolvedWindow {
    selected: Option<BrowserWindow>,
    windows: Vec<BrowserWindow>,
}

fn resolve_browser_window(request: &HelperRequest) -> Result<ResolvedWindow> {
    let automation = UIAutomation::new().context("Windows UI Automation is unavailable.")?;
    let windows = list_browser_windows(&automation)?;
    if windows.is_empty() {
        return Ok(ResolvedWindow {
            selected: None,
            windows,
        });
    }

    if let Some(source) = &request.session.source {
        if let Some(window_id) = &source.window_id {
            if let Ok(pid) = window_id.parse::<u32>() {
                if let Some(window) = windows.iter().find(|window| window.info.id == pid) {
                    return Ok(ResolvedWindow {
                        selected: Some(window.clone()),
                        windows,
                    });
                }
            }
        }
    }

    if let Ok(focused) = automation.get_focused_element() {
        if let Ok(focused_pid) = focused.get_process_id() {
            if let Some(window) = windows.iter().find(|window| window.info.id == focused_pid) {
                return Ok(ResolvedWindow {
                    selected: Some(window.clone()),
                    windows,
                });
            }
        }
    }

    Ok(ResolvedWindow {
        selected: Some(windows[0].clone()),
        windows,
    })
}

fn list_browser_windows(automation: &UIAutomation) -> Result<Vec<BrowserWindow>> {
    let root = automation.get_root_element()?;
    let walker = automation.get_control_view_walker()?;
    let process_names = process_name_map();
    let mut windows = Vec::new();

    for child in walker.get_children(&root).unwrap_or_default() {
        let control_type = child.get_control_type().ok();
        if control_type != Some(ControlType::Window) {
            continue;
        }
        let title = safe_string(child.get_name().unwrap_or_default(), 300);
        if title.trim().is_empty() {
            continue;
        }
        let pid = child.get_process_id().unwrap_or_default();
        let process_name = process_names
            .get(&pid)
            .cloned()
            .unwrap_or_else(|| format!("pid-{pid}"));
        if !is_browser_process_name(&process_name) && !looks_like_browser_window(&title) {
            continue;
        }
        windows.push(BrowserWindow {
            info: WindowInfo {
                process_name,
                id: pid,
                title,
            },
            element: child,
        });
    }

    windows.sort_by(|a, b| {
        a.info
            .process_name
            .cmp(&b.info.process_name)
            .then(a.info.id.cmp(&b.info.id))
    });
    Ok(windows)
}

fn process_name_map() -> std::collections::HashMap<u32, String> {
    let system = System::new_all();
    system
        .processes()
        .iter()
        .map(|(pid, process)| {
            (
                pid.as_u32(),
                process
                    .name()
                    .to_string_lossy()
                    .trim_end_matches(".exe")
                    .to_string(),
            )
        })
        .collect()
}

fn build_observation(resolved: &ResolvedWindow) -> Result<HelperSnapshot> {
    let windows: Vec<WindowInfo> = resolved
        .windows
        .iter()
        .map(|window| window.info.clone())
        .collect();
    let entries = match &resolved.selected {
        Some(window) => collect_elements(&window.element)?,
        None => Vec::new(),
    };
    let title = resolved
        .selected
        .as_ref()
        .map(|window| window.info.title.clone())
        .unwrap_or_else(|| "Windows browser UIA native helper".to_string());

    let mut lines: Vec<String> = windows
        .iter()
        .map(|window| format!("{} {}: {}", window.process_name, window.id, window.title))
        .collect();
    lines.extend(
        entries
            .iter()
            .filter_map(|entry| {
                let label = entry.info.label.trim();
                if label.is_empty() {
                    None
                } else {
                    Some(label.to_string())
                }
            })
            .take(80),
    );

    Ok(HelperSnapshot {
        url: None,
        title,
        text: lines.join("\n"),
        windows,
        elements: entries.into_iter().map(|entry| entry.info).collect(),
    })
}

fn collect_elements(root: &UIElement) -> Result<Vec<ElementEntry>> {
    let automation = UIAutomation::new()?;
    let walker = automation.get_control_view_walker()?;
    let mut queue = VecDeque::new();
    let mut entries = Vec::new();
    let mut visited = 0usize;
    queue.push_back((root.clone(), 0usize));

    while let Some((element, depth)) = queue.pop_front() {
        if visited >= MAX_VISITED_NODES || entries.len() >= MAX_ELEMENTS {
            break;
        }
        visited += 1;
        if is_interesting_element(&element, depth) {
            let index = entries.len();
            if let Some(info) = convert_element_for_observation(&element, index) {
                entries.push(ElementEntry {
                    element: element.clone(),
                    info,
                });
            }
        }
        if depth >= MAX_DEPTH {
            continue;
        }
        for child in walker.get_children(&element).unwrap_or_default() {
            if queue.len() >= MAX_VISITED_NODES {
                break;
            }
            queue.push_back((child, depth + 1));
        }
    }
    Ok(entries)
}

fn is_interesting_element(element: &UIElement, depth: usize) -> bool {
    let role = role_name(element);
    let name = safe_string(element.get_name().unwrap_or_default(), 160);
    let automation_id = safe_string(element.get_automation_id().unwrap_or_default(), 120);
    let has_bounds = element_bbox(element).is_some();
    let interesting_roles = [
        "button",
        "hyperlink",
        "edit",
        "combobox",
        "checkbox",
        "radiobutton",
        "tabitem",
        "menuitem",
        "listitem",
        "dataitem",
        "treeitem",
        "document",
        "pane",
        "window",
    ];
    interesting_roles.contains(&role.as_str())
        || (depth <= 4 && has_bounds && (!name.trim().is_empty() || !automation_id.trim().is_empty()))
}

fn convert_element_for_observation(element: &UIElement, index: usize) -> Option<ElementInfo> {
    let role = role_name(element);
    let name = safe_string(element.get_name().unwrap_or_default(), 180);
    let automation_id = safe_string(element.get_automation_id().unwrap_or_default(), 120);
    let class_name = safe_string(element.get_classname().unwrap_or_default(), 80);
    let selector = runtime_selector(element).unwrap_or_else(|| format!("uia:fallback-{index}"));
    let is_password = element.is_password().unwrap_or(false);
    let mut risk_hints = Vec::new();
    if is_password || is_sensitive_text(&name) || is_sensitive_text(&automation_id) {
        risk_hints.push("password".to_string());
        risk_hints.push("auth".to_string());
    }
    if role == "button" && contains_any_ci(&name, &["delete", "remove", "discard"]) {
        risk_hints.push("delete".to_string());
    }
    if role == "button"
        && contains_any_ci(
            &name,
            &["submit", "send", "post", "publish", "pay", "purchase", "buy"],
        )
    {
        risk_hints.push("submit".to_string());
    }
    risk_hints.sort();
    risk_hints.dedup();

    let id = selector.replace(':', "-");
    let bbox = element_bbox(element);
    let selected = element
        .get_pattern::<UISelectionItemPattern>()
        .ok()
        .and_then(|pattern| pattern.is_selected().ok());
    let checked = element
        .get_pattern::<UITogglePattern>()
        .ok()
        .and_then(|pattern| pattern.get_toggle_state().ok())
        .map(|state| state == ToggleState::On);
    Some(ElementInfo {
        id,
        role: role.clone(),
        tag_name: format!("uia-{role}"),
        label: name.clone(),
        text: name,
        value: element_value(element),
        selector,
        visible: !element.is_offscreen().unwrap_or(false),
        enabled: element.is_enabled().unwrap_or(true),
        editable: role == "edit" || role == "combobox",
        confidence: 0.78,
        bbox,
        risk_hints,
        checked,
        selected,
        automation_id: non_empty(automation_id),
        class_name: non_empty(class_name),
    })
}

fn execute_action(resolved: &ResolvedWindow, action: &BrowserAction, request: &HelperRequest) -> Result<String> {
    let window = match &resolved.selected {
        Some(window) => window,
        None => return Ok("missing_browser_window".to_string()),
    };

    match action {
        BrowserAction::Back => invoke_tab_command(&window.element, "{alt}{left}", "alt_left"),
        BrowserAction::Forward => invoke_tab_command(&window.element, "{alt}{right}", "alt_right"),
        BrowserAction::Reload => invoke_tab_command(&window.element, "{f5}", "f5"),
        BrowserAction::Navigate { url } => {
            let url = safe_string(url.clone().unwrap_or_default(), 2048);
            if url.trim().is_empty() || is_sensitive_text(&url) {
                return Ok("blocked_invalid_or_sensitive_url".to_string());
            }
            window.element.set_focus().ok();
            sleep(Duration::from_millis(50));
            window.element.send_keys("{ctrl}l", 10)?;
            sleep(Duration::from_millis(40));
            window.element.send_text(&url, 1)?;
            window.element.send_keys("{enter}", 10)?;
            Ok("ctrl_l_url_enter".to_string())
        }
        BrowserAction::Click { target, .. } => {
            let element = find_element_by_target(resolved, target.as_ref(), request.target.as_ref())?;
            invoke_element_default(element.as_ref())
        }
        BrowserAction::TypeText {
            target,
            text,
            clear_first,
            submit,
        } => {
            let element = find_element_by_target(resolved, target.as_ref(), request.target.as_ref())?;
            set_element_text(
                element.as_ref(),
                &safe_string(text.clone().unwrap_or_default(), 4096),
                clear_first.unwrap_or(false),
                submit.unwrap_or(false),
            )
        }
        BrowserAction::Check { target, checked } => {
            let element = find_element_by_target(resolved, target.as_ref(), request.target.as_ref())?;
            set_element_checked(element.as_ref(), checked.unwrap_or(true))
        }
        BrowserAction::Select { target, value } => {
            let element = find_element_by_target(resolved, target.as_ref(), request.target.as_ref())?;
            select_element(element.as_ref(), value.as_deref().unwrap_or_default())
        }
        BrowserAction::Scroll { direction, .. } => {
            let key = match direction.as_deref().unwrap_or("down") {
                "up" | "left" => "{pgup}",
                _ => "{pgdn}",
            };
            window.element.set_focus().ok();
            window.element.send_keys(key, 10)?;
            Ok("page_key".to_string())
        }
        BrowserAction::Hotkey { keys } => {
            if keys.is_empty() || keys.iter().any(|key| is_sensitive_text(key)) {
                return Ok("blocked_invalid_hotkey".to_string());
            }
            let sequence = keys
                .iter()
                .map(|key| format!("{{{}}}", key.to_lowercase()))
                .collect::<Vec<_>>()
                .join("");
            window.element.set_focus().ok();
            window.element.send_keys(&sequence, 10)?;
            Ok("hotkey".to_string())
        }
        BrowserAction::Screenshot { .. } => Ok("unsupported_screenshot".to_string()),
        BrowserAction::Evaluate { .. } => Ok("blocked_evaluate".to_string()),
        BrowserAction::Read { .. } => Ok("read".to_string()),
    }
}

fn find_element_by_target(
    resolved: &ResolvedWindow,
    action_target: Option<&ElementTarget>,
    request_target: Option<&BrowserElementTarget>,
) -> Result<Option<UIElement>> {
    let selected = match &resolved.selected {
        Some(window) => window,
        None => return Ok(None),
    };

    if matches!(action_target, Some(ElementTarget::Focused)) {
        return Ok(UIAutomation::new()?.get_focused_element().ok());
    }
    if let Some(ElementTarget::Bbox { bbox }) = action_target {
        let automation = UIAutomation::new()?;
        let point = uiautomation::types::Point::new(bbox.x + bbox.w / 2, bbox.y + bbox.h / 2);
        return Ok(automation.element_from_point(point).ok());
    }
    if let Some(target) = request_target {
        if let Some(bbox) = &target.bbox {
            let automation = UIAutomation::new()?;
            let point = uiautomation::types::Point::new(bbox.x + bbox.w / 2, bbox.y + bbox.h / 2);
            if let Ok(element) = automation.element_from_point(point) {
                return Ok(Some(element));
            }
        }
    }

    let mut selector = String::new();
    let mut id = String::new();
    let mut target_text = String::new();
    if let Some(target) = request_target {
        selector = target.selector.clone().unwrap_or_default();
        id = target.id.clone().unwrap_or_default();
        target_text = target
            .label
            .clone()
            .or_else(|| target.text.clone())
            .or_else(|| target.value.clone())
            .unwrap_or_default();
    }
    if let Some(action_target) = action_target {
        match action_target {
            ElementTarget::ElementId { id: target_id } => id = target_id.clone(),
            ElementTarget::Selector { selector: target_selector } => selector = target_selector.clone(),
            ElementTarget::Text { text, .. } => target_text = text.clone(),
            ElementTarget::Bbox { .. } | ElementTarget::Focused => {}
        }
    }

    let entries = collect_elements(&selected.element)?;
    for entry in &entries {
        if !selector.trim().is_empty() && entry.info.selector == selector {
            return Ok(Some(entry.element.clone()));
        }
        if !id.trim().is_empty() && (entry.info.id == id || entry.info.selector == id) {
            return Ok(Some(entry.element.clone()));
        }
    }
    if !target_text.trim().is_empty() {
        let needle = target_text.to_lowercase();
        for entry in &entries {
            let label = entry.info.label.to_lowercase();
            let text = entry.info.text.to_lowercase();
            if label == needle || text == needle || (!label.is_empty() && label.contains(&needle)) {
                return Ok(Some(entry.element.clone()));
            }
        }
    }
    Ok(None)
}

fn invoke_element_default(element: Option<&UIElement>) -> Result<String> {
    let Some(element) = element else {
        return Ok("missing_target".to_string());
    };
    if let Ok(pattern) = element.get_pattern::<UIInvokePattern>() {
        if pattern.invoke().is_ok() {
            return Ok("invoke_pattern".to_string());
        }
    }
    if let Ok(pattern) = element.get_pattern::<UISelectionItemPattern>() {
        if pattern.select().is_ok() {
            return Ok("selection_item_pattern".to_string());
        }
    }
    if element.click().is_ok() {
        return Ok("uia_click".to_string());
    }
    if element.set_focus().is_ok() {
        sleep(Duration::from_millis(50));
        if element.send_keys("{enter}", 10).is_ok() {
            return Ok("focus_enter".to_string());
        }
    }
    Ok("failed_default_action".to_string())
}

fn set_element_text(element: Option<&UIElement>, text: &str, clear_first: bool, submit: bool) -> Result<String> {
    let Some(element) = element else {
        return Ok("missing_target".to_string());
    };
    if element.is_password().unwrap_or(false) || is_sensitive_text(text) {
        return Ok("blocked_sensitive_text".to_string());
    }
    if let Ok(value_pattern) = element.get_pattern::<UIValuePattern>() {
        if !value_pattern.is_readonly().unwrap_or(false) && value_pattern.set_value(text).is_ok() {
            if submit {
                element.send_keys("{enter}", 10).ok();
            }
            return Ok("value_pattern".to_string());
        }
    }
    element.set_focus().ok();
    sleep(Duration::from_millis(50));
    if clear_first {
        element.send_keys("{ctrl}a", 10)?;
        sleep(Duration::from_millis(20));
    }
    element.send_text(text, 1)?;
    if submit {
        sleep(Duration::from_millis(40));
        element.send_keys("{enter}", 10)?;
    }
    Ok("send_text".to_string())
}

fn set_element_checked(element: Option<&UIElement>, checked: bool) -> Result<String> {
    let Some(element) = element else {
        return Ok("missing_target".to_string());
    };
    if let Ok(pattern) = element.get_pattern::<UITogglePattern>() {
        let current = pattern.get_toggle_state().ok();
        let desired = if checked { ToggleState::On } else { ToggleState::Off };
        if current != Some(desired) {
            pattern.toggle()?;
        }
        return Ok("toggle_pattern".to_string());
    }
    invoke_element_default(Some(element))
}

fn select_element(element: Option<&UIElement>, value: &str) -> Result<String> {
    let Some(element) = element else {
        return Ok("missing_target".to_string());
    };
    if is_sensitive_text(value) {
        return Ok("blocked_sensitive_select_value".to_string());
    }
    if let Ok(pattern) = element.get_pattern::<UISelectionItemPattern>() {
        pattern.select()?;
        return Ok("selection_item_pattern".to_string());
    }
    if !value.trim().is_empty() {
        return set_element_text(Some(element), value, true, false);
    }
    invoke_element_default(Some(element))
}

fn invoke_tab_command(window: &UIElement, keys: &str, method: &str) -> Result<String> {
    window.set_focus().ok();
    sleep(Duration::from_millis(50));
    window.send_keys(keys, 10)?;
    Ok(method.to_string())
}

fn role_name(element: &UIElement) -> String {
    element
        .get_control_type()
        .map(|control_type| format!("{control_type:?}").to_lowercase())
        .unwrap_or_else(|_| "unknown".to_string())
}

fn runtime_selector(element: &UIElement) -> Option<String> {
    let runtime_id = element.get_runtime_id().ok()?;
    if runtime_id.is_empty() {
        return None;
    }
    let joined = runtime_id
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(".");
    let digest = Sha256::digest(joined.as_bytes());
    Some(format!("uia:{}", hex::encode(&digest[..8])))
}

fn element_bbox(element: &UIElement) -> Option<Rect> {
    let rect = element.get_bounding_rectangle().ok()?;
    rect_to_bbox(rect)
}

fn rect_to_bbox(rect: UiaRect) -> Option<Rect> {
    let width = rect.get_right() - rect.get_left();
    let height = rect.get_bottom() - rect.get_top();
    if width <= 0 || height <= 0 {
        return None;
    }
    Some(Rect {
        x: rect.get_left(),
        y: rect.get_top(),
        w: width,
        h: height,
    })
}

fn element_value(element: &UIElement) -> Option<String> {
    if element.is_password().unwrap_or(false) {
        return None;
    }
    let value = element
        .get_pattern::<UIValuePattern>()
        .ok()
        .and_then(|pattern| pattern.get_value().ok())?;
    if is_sensitive_text(&value) {
        None
    } else {
        non_empty(safe_string(value, 160))
    }
}

fn action_type(action: &BrowserAction) -> &'static str {
    match action {
        BrowserAction::Read { .. } => "read",
        BrowserAction::Click { .. } => "click",
        BrowserAction::TypeText { .. } => "type",
        BrowserAction::Select { .. } => "select",
        BrowserAction::Check { .. } => "check",
        BrowserAction::Scroll { .. } => "scroll",
        BrowserAction::Navigate { .. } => "navigate",
        BrowserAction::Back => "back",
        BrowserAction::Forward => "forward",
        BrowserAction::Reload => "reload",
        BrowserAction::Hotkey { .. } => "hotkey",
        BrowserAction::Screenshot { .. } => "screenshot",
        BrowserAction::Evaluate { .. } => "evaluate",
    }
}

fn metadata(command: &str, action: Option<&str>, extra: Value) -> Value {
    let mut base = json!({
        "helper": "browser-native-desktop-helper",
        "helperImplementation": "rust-native",
        "helperVersion": HELPER_VERSION,
        "schemaVersion": SCHEMA_VERSION,
        "command": command
    });
    if let Some(action) = action {
        base["action"] = json!(action);
    }
    merge_json(base, extra)
}

fn error_response(error: String, metadata_extra: Value) -> HelperResponse {
    HelperResponse {
        ok: false,
        error: Some(error),
        observation: None,
        after: None,
        metadata: if metadata_extra.get("helper").is_some() {
            metadata_extra
        } else {
            metadata("error", None, metadata_extra)
        },
    }
}

fn merge_json(mut base: Value, extra: Value) -> Value {
    if let (Some(base_obj), Some(extra_obj)) = (base.as_object_mut(), extra.as_object()) {
        for (key, value) in extra_obj {
            base_obj.insert(key.clone(), value.clone());
        }
    }
    base
}

fn safe_string(value: String, max_length: usize) -> String {
    let trimmed = value.trim().to_string();
    if trimmed.chars().count() <= max_length {
        return trimmed;
    }
    trimmed.chars().take(max_length).collect()
}

fn non_empty(value: String) -> Option<String> {
    if value.trim().is_empty() {
        None
    } else {
        Some(value)
    }
}

fn is_browser_process_name(process_name: &str) -> bool {
    let lower = process_name
        .trim_end_matches(".exe")
        .to_ascii_lowercase();
    BROWSER_PROCESS_NAMES.iter().any(|name| lower == *name)
}

fn looks_like_browser_window(title: &str) -> bool {
    contains_any_ci(
        title,
        &[
            "google chrome",
            "microsoft edge",
            "mozilla firefox",
            "chromium",
            "brave",
        ],
    )
}

fn contains_any_ci(haystack: &str, needles: &[&str]) -> bool {
    let lower = haystack.to_ascii_lowercase();
    needles
        .iter()
        .any(|needle| lower.contains(&needle.to_ascii_lowercase()))
}

fn is_sensitive_text(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    [
        "password",
        "passwd",
        "passcode",
        "token",
        "cookie",
        "secret",
        "api_key",
        "api-key",
        "bearer ",
        "sk-",
        "payment",
        "card number",
        "cvv",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn json_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}
