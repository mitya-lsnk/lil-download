//! "Don't sleep while something is downloading".
//!
//! On macOS this is a `caffeinate` child tied to this process with `-w`, so it
//! dies with the app — a crash or a force-quit can't leave the Mac unable to
//! sleep. `-i` blocks idle sleep, `-m` keeps the disk spinning, `-s` blocks
//! system sleep while on mains power.
//!
//! What it cannot do is override the lid. Closing the lid of a MacBook sleeps it
//! unless it is on power with an external display attached; only
//! `pmset disablesleep` gets past that, and that needs administrator rights and
//! stays on if whoever set it forgets to turn it off — so it is not done here.

use std::sync::Mutex;

static HELD: Mutex<Option<std::process::Child>> = Mutex::new(None);

pub fn set(on: bool) {
    let mut held = HELD.lock().unwrap_or_else(|e| e.into_inner());
    // A guard that already exited (killed from outside) counts as released.
    if let Some(c) = held.as_mut() {
        if matches!(c.try_wait(), Ok(Some(_))) {
            *held = None;
        }
    }
    if on == held.is_some() {
        return;
    }
    if !on {
        if let Some(mut c) = held.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
        return;
    }
    #[cfg(target_os = "macos")]
    {
        *held = std::process::Command::new("/usr/bin/caffeinate")
            .args(["-i", "-m", "-s", "-w", &std::process::id().to_string()])
            .spawn()
            .ok();
    }
}

#[tauri::command]
pub fn keep_awake(on: bool) {
    set(on);
}
