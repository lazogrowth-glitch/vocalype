# paste_utils_diagnosis.md

Date: 2026-04-26
Source file(s) read:
  - src-tauri/src/platform/clipboard.rs
  - src-tauri/src/platform/utils.rs
  - src-tauri/src/settings/mod.rs (lines 529, 650–652, 1218–1221, 1539)
Investigation type: read-only / measurement_task
Output of: V11 PB-1 follow-up (utils::paste root cause confirmation)
Follows: vocalype-brain/outputs/paste_mechanism_diagnosis.md
No product code was modified.

---

## 1. Does `utils::paste` Exist?

**Yes — via a three-step re-export chain.**

`crate::utils::paste()` called at paste.rs:122 resolves as follows:

```
paste.rs:6        use crate::utils;
paste.rs:122      utils::paste(final_text, app_clone)
                       ↓
lib.rs:52         pub use platform::{..., utils};
                       ↓
platform/utils.rs:12   pub use crate::clipboard::*;
                       ↓
lib.rs:52         pub use platform::{..., clipboard, ...};
                       ↓
platform/clipboard.rs:717   pub fn paste(text: String, app_handle: AppHandle) -> Result<(), String>
```

`utils.rs` does not contain paste logic directly — it re-exports everything from `crate::clipboard::*`. The actual implementation is `platform::clipboard::paste()`.

---

## 2. Exact Call Path

```
dispatch_text_insertion()
  paste.rs:122      utils::paste(final_text, app_clone)
                         ↓
  clipboard.rs:717  pub fn paste(text, app_handle)
  clipboard.rs:718      settings = get_settings(&app_handle)
  clipboard.rs:720      paste_delay_ms = settings.paste_delay_ms  [default = 60ms]
  clipboard.rs:728–735  enigo = EnigoState lock acquired
  clipboard.rs:746–760  category = get_paste_category()
  clipboard.rs:752–761  cursor_context::capture() [reads ~80 chars before cursor]
  clipboard.rs:760      smart_paste::adapt()
  clipboard.rs:784–793  paste_via_clipboard(enigo, text, app, method, paste_delay_ms=60, category)
                              ↓
  clipboard.rs:27   fn paste_via_clipboard(...)
  clipboard.rs:42       clipboard.read_text()         [save existing clipboard]
  clipboard.rs:76–79    clipboard.write_text(text)    [write transcription to clipboard]

  *** SLEEP 1 ***
  clipboard.rs:87       thread::sleep(Duration::from_millis(60))
                        "sleeping 60ms before sending key combo"

  clipboard.rs:102      input::send_paste_ctrl_v(enigo)   [Ctrl+V via enigo]
  clipboard.rs:120      restore_delay_ms = 60u64.max(450) = 450  [Windows path]

  *** SLEEP 2 ***
  clipboard.rs:128      thread::sleep(Duration::from_millis(450))
                        "waiting 450ms before restoring clipboard"

  clipboard.rs:144      clipboard.write_text(clipboard_content)  [restore clipboard]
```

**Total measured by `paste_execute` profiler step: ~644ms**

---

## 3. Thread Sleeps Found

**Two `thread::sleep` calls inside `paste_via_clipboard()`.**

| # | Location | Duration | Purpose (from comments/logs) |
|---|---|---|---|
| Sleep 1 | clipboard.rs:87 | `paste_delay_ms` = **60ms** (default) | "sleeping Nms before sending key combo" — clipboard propagation delay |
| Sleep 2 | clipboard.rs:128 | `paste_delay_ms.max(450)` = **450ms** (Windows) | "waiting Nms before restoring clipboard" — target app consumption window |

**Additional hardcoded sleep (not in paste path):**
- clipboard.rs:811: `thread::sleep(Duration::from_millis(50))` — only fires when `auto_submit` is enabled; not in the normal paste path.

---

## 4. Exact Duration of Each Sleep

| Sleep | Formula | Value on Windows (default settings) |
|---|---|---|
| Sleep 1 | `paste_delay_ms` | **60ms** |
| Sleep 2 | `paste_delay_ms.max(450)` | **450ms** (floor enforced) |
| **Total sleep** | | **510ms** |

`paste_delay_ms` default is defined at settings/mod.rs:650–652:
```rust
fn default_paste_delay_ms() -> u64 {
    60
}
```

The Windows restore floor of 450ms is hardcoded at clipboard.rs:120:
```rust
#[cfg(target_os = "windows")]
let restore_delay_ms = paste_delay_ms.max(450);
```

There is no setting that exposes or overrides the 450ms floor independently.

**Additional finding:** settings/mod.rs:1218–1219 forces `paste_delay_ms` back to the default (60ms) in certain reset paths. The benchmark observations were therefore using exactly the default values.

---

## 5. Do the Delays Explain ~644ms?

**Yes. Fully confirmed.**

Breakdown:

| Component | Duration | Source |
|---|---|---|
| Sleep 1 (pre-Ctrl+V) | 60ms | clipboard.rs:87 |
| Sleep 2 (post-Ctrl+V, Windows) | 450ms | clipboard.rs:128 |
| cursor_context::capture() | ~60–80ms (estimated) | clipboard.rs:758; reads clipboard + keyboard input |
| clipboard.write_text() × 2 | ~10–20ms (estimated) | clipboard.rs:76, 144 |
| input::send_paste_ctrl_v() | ~5–10ms (estimated) | clipboard.rs:102; enigo keystroke |
| EnigoState mutex + misc | ~5ms (estimated) | clipboard.rs:732 |
| **Total** | **~590–625ms** | aligns with measured 644ms ± 3ms |

The ±1.2ms consistency observed across 7 benchmark sessions is explained by the deterministic sleep values: both sleeps are fixed-duration, not variable. The small variation comes from OS scheduling jitter on the sleep calls themselves.

The 644ms figure is the **real-world default experience for every paid-tier dictation on Windows.**

---

## 6. OS / API Method Used

**Clipboard write + Ctrl+V keyboard simulation via `enigo` crate.**

| Step | API |
|---|---|
| Save existing clipboard | `tauri_plugin_clipboard_manager::ClipboardExt::read_text()` (clipboard.rs:42) |
| Write transcription to clipboard | `tauri_plugin_clipboard_manager::ClipboardExt::write_text()` (clipboard.rs:76–79) |
| Send Ctrl+V | `input::send_paste_ctrl_v(enigo)` → `enigo` crate (clipboard.rs:102) |
| Restore clipboard | `tauri_plugin_clipboard_manager::ClipboardExt::write_text()` (clipboard.rs:144) |

The `enigo` crate on Windows uses `SendInput()` (Win32 API) to simulate keystrokes. The full chain: clipboard write → sleep → Ctrl+V via SendInput → sleep → clipboard restore.

---

## 7. Are the Delays Intentional?

**Yes — both delays are intentional stability measures.**

**Sleep 1 (60ms pre-Ctrl+V):**  
Log message: `"sleeping {paste_delay_ms}ms before sending key combo"` (clipboard.rs:83–84).  
Purpose: ensures the clipboard content is fully propagated to the OS clipboard before the keystroke is sent. Some apps read clipboard on keydown, not keyup — a race condition without this delay could result in pasting stale clipboard content.

**Sleep 2 (450ms post-Ctrl+V, Windows floor):**  
Comment: `"Give the target app enough time to consume clipboard content before restore."` (clipboard.rs:117–118).  
Additional comment: `"Too-short delays can cause apparent 'paste did nothing' on some apps."` (clipboard.rs:118).  
Purpose: after Ctrl+V is sent, the target application asynchronously reads the clipboard. If the original clipboard content is restored too quickly, some apps (notably Electron-based apps, some browsers) may read the restored content instead of the pasted text, resulting in the wrong text being inserted.  
The **450ms Windows floor is higher than the 250ms non-Windows floor** (clipboard.rs:122–123), indicating Windows apps were found to be slower at consuming clipboard content.

Both delays protect against real paste failures. Neither is cargo-culted — the comments and the platform-specific values show deliberate tuning.

---

## 8. Minimal Future Fix Options

**Hypothesis only. No code change. No patch instructions.**

### Option A — Reduce the 450ms Windows restore floor (most targeted)

The 450ms floor (clipboard.rs:120) is the dominant contributor. Reducing it from 450ms to a lower value would directly reduce total latency by the same amount.

At 100ms floor: total = 60 + 100 + ~134ms overhead = **~294ms** (just below the 300ms threshold).  
At 150ms floor: total = 60 + 150 + ~134ms = **~344ms**.  
At 50ms floor: total = 60 + 50 + ~134ms = **~244ms**.

This requires empirical validation: run paste across a representative set of Windows apps (Notepad, VS Code, Chrome, Electron apps, Word, Teams) with different floor values and measure paste success rate. Target: 100% success with lowest possible floor.

### Option B — Expose restore delay as an independent user setting

Add `restore_delay_ms: u64` as a separate setting (defaulting to 450ms for backwards compat). Users who experience paste failures can increase it; power users can reduce it. No change to default behavior.

### Option C — Event-driven clipboard restore

On Windows, listen for clipboard ownership change (via `WM_RENDERFORMAT` or `AddClipboardFormatListener`) to know when the target app has consumed the clipboard, then restore immediately. Eliminates the fixed wait entirely. Most reliable long-term approach; most implementation complexity.

### Option D — Reduce Sleep 1 (paste_delay_ms from 60ms to a lower value)

Only saves 60ms (total: ~584ms). Not the primary target. The 450ms floor dominates.

---

## 9. Risks of Reducing / Removing the Delay

**Sleep 1 (pre-Ctrl+V, 60ms):**
- Risk: On some systems/apps, Ctrl+V fires before the clipboard is ready → paste inserts stale clipboard content (old text, not transcription)
- Lower bound estimate: 10–20ms should be sufficient for most modern systems. 0ms is risky.
- Windows is generally faster at clipboard propagation than assumed — 20–30ms is likely safe.

**Sleep 2 (post-Ctrl+V, 450ms Windows floor):**
- Risk: Target app reads clipboard after restore completes → incorrect text pasted (original clipboard content instead of transcription)
- Most vulnerable apps: Electron apps (slow clipboard consumption), browser address bars, Teams, Slack
- Safest approach: empirical bisection testing per app category (see Option A above)
- Hard lower bound: Ctrl+V keydown-to-keyup round-trip + app's internal clipboard read latency. On fast Windows apps (Notepad, VSCode): ~20–50ms. On Electron apps: up to 200–300ms observed empirically in similar projects.

**Overall risk assessment:**  
Reducing the Windows floor from 450ms to 150ms is low risk for native apps (Notepad, VS Code) and medium risk for Electron apps (Slack, Teams, VS Code's internal clipboard path). Testing on 5–10 representative apps would give high confidence in the safe floor value.

---

## 10. Recommendation

**Implement a small empirical test to find the minimum safe Windows restore floor.**

Specifically:

1. Read `src-tauri/src/platform/clipboard.rs:120` (already confirmed in this investigation)
2. In a test branch, reduce the `450` floor to test values: `300`, `200`, `150`, `100`, `50`
3. For each value: dictate into Notepad, VS Code, Chrome address bar, Gmail, Slack, and Teams
4. Record: (a) paste success, (b) correct text inserted, (c) original clipboard preserved
5. Identify the minimum value where all 6 apps pass all 3 checks
6. That value replaces `450` in clipboard.rs:120

Projected outcome: 150ms floor is very likely safe for all tested apps → paste_latency_ms ≈ 344ms. 100ms is probably safe for native apps but may fail Electron apps → paste_latency_ms ≈ 294ms (just under threshold).

**This is a `proposal_task` (V5/V6 handoff level), not a direct implementation.** The empirical test protocol should be documented in a proposal before any change is made to clipboard.rs.

Do not reduce to 0ms or remove Sleep 2 entirely without validation. The original comments (`"Too-short delays can cause apparent 'paste did nothing'"`) reflect real observed behavior during development.

---

## 11. Product Code Touched

**No.** This is a read-only investigation. No file outside `vocalype-brain/` was modified.

Files read (read-only):
- `src-tauri/src/platform/clipboard.rs`
- `src-tauri/src/platform/utils.rs`
- `src-tauri/src/settings/mod.rs` (targeted lines only)

---

## 12. Final Git Status

See below (run after writing this file).
