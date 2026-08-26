//! Can we actually read this browser's cookies, and if not, what fixes it.
//!
//! yt-dlp's `--cookies-from-browser` fails in three different ways that look
//! identical from the outside, and each needs a different answer from the user:
//!
//! * the browser isn't installed — nothing to fix, don't offer it;
//! * the file is there but the OS won't let us read it (Safari on macOS lives
//!   behind Full Disk Access) — the user has to grant it in System Settings,
//!   and no app can grant that to itself;
//! * the file reads fine but the contents are encrypted with a Keychain key
//!   (Chrome and relatives) — macOS will put up its own prompt at the moment
//!   yt-dlp reads them.
//!
//! Checking up front costs a couple of `stat` calls and turns "download failed"
//! into "here is the switch to flip".

use std::path::PathBuf;

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    /// Readable, nothing in the way.
    Ok,
    /// Installed, but the OS denied the read. Needs Full Disk Access.
    FullDisk,
    /// Readable, but decryption will make the system ask for the Keychain.
    Keychain,
    NotInstalled,
    /// A platform where we haven't mapped the paths. We don't guess.
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
pub struct CookieStatus {
    pub browser: String,
    pub verdict: Verdict,
    /// The file we looked at, for the "it works on my machine" conversation.
    pub path: Option<String>,
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
}

/// Chromium-derived browsers all share a cookie layout and the Keychain
/// encryption that comes with it.
fn is_chromium_family(browser: &str) -> bool {
    matches!(
        browser,
        "chrome" | "chromium" | "brave" | "edge" | "opera" | "vivaldi" | "whale"
    )
}

/// Can this browser exist on this system at all?
///
/// Safari for Windows was abandoned in 2012 and never existed on Linux, so
/// there is nothing to look for and nothing uncertain about it. Without this
/// the picker offered Safari on Windows with the verdict "непонятно" — an
/// answer that invites someone to go looking for a permission problem that
/// cannot exist.
fn possible_here(browser: &str) -> bool {
    !(browser == "safari" && !cfg!(target_os = "macos"))
}

/// Candidate cookie files, most likely first. Empty when we don't know the
/// platform's layout — which is reported as Unknown rather than NotInstalled,
/// because "we didn't look" and "it isn't there" are different answers.
fn candidates(browser: &str) -> Vec<PathBuf> {
    let Some(h) = home() else {
        return Vec::new();
    };

    #[cfg(target_os = "macos")]
    {
        let app = h.join("Library/Application Support");
        let profile_dir = match browser {
            "chrome" => Some(app.join("Google/Chrome")),
            "chromium" => Some(app.join("Chromium")),
            "brave" => Some(app.join("BraveSoftware/Brave-Browser")),
            "edge" => Some(app.join("Microsoft Edge")),
            "opera" => Some(app.join("com.operasoftware.Opera")),
            "vivaldi" => Some(app.join("Vivaldi")),
            _ => None,
        };
        if let Some(dir) = profile_dir {
            // Chromium moved the file under Network/ some versions ago and kept
            // the old location working; check both rather than pick a side.
            return vec![
                dir.join("Default/Network/Cookies"),
                dir.join("Default/Cookies"),
            ];
        }
        return match browser {
            "safari" => vec![
                h.join("Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies"),
                h.join("Library/Cookies/Cookies.binarycookies"),
            ],
            "firefox" => vec![app.join("Firefox/Profiles")],
            _ => Vec::new(),
        };
    }

    #[cfg(windows)]
    {
        let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or(h.clone());
        let roaming = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or(h.clone());
        let dir = match browser {
            "chrome" => Some(local.join(r"Google\Chrome\User Data")),
            "chromium" => Some(local.join(r"Chromium\User Data")),
            "brave" => Some(local.join(r"BraveSoftware\Brave-Browser\User Data")),
            "edge" => Some(local.join(r"Microsoft\Edge\User Data")),
            "vivaldi" => Some(local.join(r"Vivaldi\User Data")),
            "opera" => Some(roaming.join(r"Opera Software\Opera Stable")),
            _ => None,
        };
        if let Some(d) = dir {
            return vec![d.join(r"Default\Network\Cookies"), d.join(r"Default\Cookies")];
        }
        return match browser {
            "firefox" => vec![roaming.join(r"Mozilla\Firefox\Profiles")],
            _ => Vec::new(),
        };
    }

    #[cfg(target_os = "linux")]
    {
        let cfg = h.join(".config");
        let dir = match browser {
            "chrome" => Some(cfg.join("google-chrome")),
            "chromium" => Some(cfg.join("chromium")),
            "brave" => Some(cfg.join("BraveSoftware/Brave-Browser")),
            "edge" => Some(cfg.join("microsoft-edge")),
            "opera" => Some(cfg.join("opera")),
            "vivaldi" => Some(cfg.join("vivaldi")),
            _ => None,
        };
        if let Some(d) = dir {
            return vec![d.join("Default/Network/Cookies"), d.join("Default/Cookies")];
        }
        return match browser {
            "firefox" => vec![h.join(".mozilla/firefox")],
            _ => Vec::new(),
        };
    }

    #[allow(unreachable_code)]
    Vec::new()
}

/// Turn "does it exist / can we open it" into an answer the UI can act on.
fn judge(browser: &str, existing: Option<(&PathBuf, bool)>) -> Verdict {
    match existing {
        None => Verdict::NotInstalled,
        // The file is there and the OS said no. Only one thing fixes that.
        Some((_, false)) => Verdict::FullDisk,
        Some((_, true)) if is_chromium_family(browser) => Verdict::Keychain,
        Some(_) => Verdict::Ok,
    }
}

pub fn check(browser: &str) -> CookieStatus {
    if !possible_here(browser) {
        return CookieStatus {
            browser: browser.into(),
            verdict: Verdict::NotInstalled,
            path: None,
        };
    }

    let cands = candidates(browser);
    if cands.is_empty() {
        return CookieStatus { browser: browser.into(), verdict: Verdict::Unknown, path: None };
    }

    let found = cands.iter().find(|p| p.exists());
    let readable = found.map(|p| {
        if p.is_dir() {
            std::fs::read_dir(p).is_ok()
        } else {
            std::fs::File::open(p).is_ok()
        }
    });

    let pair = match (found, readable) {
        (Some(p), Some(r)) => Some((p, r)),
        _ => None,
    };

    CookieStatus {
        browser: browser.into(),
        verdict: judge(browser, pair),
        path: found.map(|p| p.to_string_lossy().into_owned()),
    }
}

/// Open the pane where Full Disk Access is granted.
///
/// An app cannot grant itself this permission — macOS deliberately requires the
/// user to do it, and requires the app to be restarted afterwards. The most we
/// can do is put them in front of the right switch instead of describing where
/// it lives.
pub fn open_privacy_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("не открыть настройки: {e}"));
    }
    #[cfg(not(target_os = "macos"))]
    Err("отдельного разрешения на этой системе не требуется".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_browser_is_not_offered_as_an_option() {
        assert_eq!(judge("firefox", None), Verdict::NotInstalled);
    }

    #[test]
    fn a_file_that_exists_but_wont_open_means_full_disk_access() {
        let p = PathBuf::from("/nope");
        assert_eq!(judge("safari", Some((&p, false))), Verdict::FullDisk);
        // Same verdict whatever the browser — it's the OS refusing, not the app.
        assert_eq!(judge("chrome", Some((&p, false))), Verdict::FullDisk);
    }

    #[test]
    fn chromium_family_warns_about_the_keychain_even_when_readable() {
        let p = PathBuf::from("/nope");
        for b in ["chrome", "brave", "edge", "opera", "vivaldi", "chromium"] {
            assert_eq!(judge(b, Some((&p, true))), Verdict::Keychain, "{b}");
        }
        // Firefox stores them unencrypted, so there's nothing to warn about.
        assert_eq!(judge("firefox", Some((&p, true))), Verdict::Ok);
        assert_eq!(judge("safari", Some((&p, true))), Verdict::Ok);
    }

    /// Reflects this machine honestly rather than asserting a fixed answer:
    /// what matters is that a real check produces a real verdict, not Unknown.
    #[test]
    fn the_real_check_reaches_a_verdict_on_a_supported_platform() {
        if cfg!(any(target_os = "macos", windows, target_os = "linux")) {
            for b in ["safari", "chrome", "firefox"] {
                let st = check(b);
                assert_ne!(st.verdict, Verdict::Unknown, "{b} on a mapped platform");
            }
        }
    }

    /// Found by the Windows and Linux runners on the very first CI run, which
    /// is the entire argument for having them: three months of local testing on
    /// one Mac could not have noticed.
    #[test]
    fn safari_is_absent_rather_than_mysterious_off_macos() {
        let st = check("safari");
        if cfg!(target_os = "macos") {
            assert_ne!(st.verdict, Verdict::NotInstalled);
        } else {
            assert_eq!(st.verdict, Verdict::NotInstalled);
            assert_eq!(st.path, None);
        }
    }
}
