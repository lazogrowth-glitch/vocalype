use log::error;
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindowBuilder};

const AGENT_OVERLAY_WIDTH: f64 = 480.0;
const AGENT_OVERLAY_HEIGHT: f64 = 300.0;

pub fn create_agent_overlay(app: &AppHandle) {
    if app.get_webview_window("agent_overlay").is_some() {
        return;
    }

    let builder = WebviewWindowBuilder::new(
        app,
        "agent_overlay",
        tauri::WebviewUrl::App("src/agent/index.html".into()),
    )
    .title("AI Assistant")
    .inner_size(AGENT_OVERLAY_WIDTH, AGENT_OVERLAY_HEIGHT)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .visible(false);

    if let Err(e) = builder.build() {
        error!("Failed to create agent overlay: {}", e);
    }
}

pub fn show_agent_overlay(app: &AppHandle) {
    // Fallback: create the overlay if deferred creation hasn't fired yet
    if app.get_webview_window("agent_overlay").is_none() {
        create_agent_overlay(app);
    }
    let Some(window) = app.get_webview_window("agent_overlay") else {
        return;
    };

    // Center on the monitor containing the cursor (or primary monitor)
    if let Ok(monitors) = app.available_monitors() {
        let monitor = app
            .cursor_position()
            .ok()
            .and_then(|pos| {
                monitors.iter().find(|m| {
                    let p = m.position();
                    let s = m.size();
                    let x = pos.x as i32;
                    let y = pos.y as i32;
                    x >= p.x && x < p.x + s.width as i32 && y >= p.y && y < p.y + s.height as i32
                })
            })
            .or_else(|| monitors.first())
            .cloned();

        if let Some(mon) = monitor {
            let scale = mon.scale_factor();
            let mon_w = mon.size().width as f64 / scale;
            let mon_h = mon.size().height as f64 / scale;
            let mon_x = mon.position().x as f64;
            let mon_y = mon.position().y as f64;

            let x = mon_x + (mon_w - AGENT_OVERLAY_WIDTH) / 2.0 * scale;
            let y = mon_y + (mon_h - AGENT_OVERLAY_HEIGHT) / 2.0 * scale;

            let _ = window.set_position(PhysicalPosition::new(x as i32, y as i32));
        }
    }

    let _ = window.show();
    let _ = window.set_focus();

    // Windows: force topmost so it appears above all other windows
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
        };
        let window_clone = window.clone();
        let _ = window.run_on_main_thread(move || {
            if let Ok(hwnd) = window_clone.hwnd() {
                unsafe {
                    let _ = SetWindowPos(
                        hwnd,
                        Some(HWND_TOPMOST),
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
                    );
                }
            }
        });
    }
}

#[allow(dead_code)]
pub fn hide_agent_overlay(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("agent_overlay") {
        let _ = window.hide();
    }
}
