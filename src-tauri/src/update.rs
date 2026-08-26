// Lightweight update check. Ask GitHub for the latest published release, compare
// its tag to the running build, and hand the frontend everything it needs to
// offer a download. Nothing is installed here — the app ships unsigned, so the
// user downloads and installs the new build themselves.

use serde::Serialize;

const REPO: &str = "mitya-lsnk/lil-download";

#[derive(Serialize)]
pub struct UpdateInfo {
    /// True when the latest release is strictly newer than the running build.
    available: bool,
    current: String,
    latest: String,
    /// Release notes (the GitHub release body); may be empty.
    notes: String,
    /// The release page — always present, used as the download fallback.
    url: String,
    /// Direct download for this platform, when the release carries one.
    asset: Option<String>,
}

// Parse "1.2.3" (tolerating a leading "v" and a `-pre`/`+meta` suffix) into
// comparable numbers. Missing parts are 0, so "0.2" == "0.2.0". None on garbage.
fn parse_semver(s: &str) -> Option<(u64, u64, u64)> {
    let s = s.trim().trim_start_matches(['v', 'V']);
    let core = s.split(['-', '+']).next().unwrap_or(s);
    let mut it = core.split('.').map(|p| p.parse::<u64>().unwrap_or(0));
    Some((it.next()?, it.next().unwrap_or(0), it.next().unwrap_or(0)))
}

fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_semver(latest), parse_semver(current)) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    }
}

// Pick the download that suits the system this copy is running on. lil edit is
// macOS-only, but lil view and lil download publish for three platforms, and
// handing a Windows user a .dmg is worse than handing them the release page.
fn pick_asset(assets: &[serde_json::Value]) -> Option<String> {
    let url = |a: &serde_json::Value| {
        a.get("browser_download_url")
            .and_then(|v| v.as_str())
            .map(String::from)
    };
    let name = |a: &serde_json::Value| {
        a.get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase()
    };

    // Most specific first: the installer for this platform, then anything that
    // merely looks like it belongs here.
    let exact: &[&str] = if cfg!(target_os = "macos") {
        &[".dmg"]
    } else if cfg!(windows) {
        &["-setup.exe", ".msi"]
    } else {
        &[".appimage", ".deb", ".rpm"]
    };
    for ext in exact {
        if let Some(a) = assets.iter().find(|a| name(a).ends_with(ext)) {
            return url(a);
        }
    }
    None
}

#[tauri::command]
pub async fn check_update() -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let client = reqwest::Client::builder()
        .user_agent(format!("lil-download/{current}"))
        .build()
        .map_err(|e| e.to_string())?;

    let api = format!("https://api.github.com/repos/{REPO}/releases/latest");
    let resp = client
        .get(&api)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("bad status: {e}"))?;

    // reqwest is built without its `json` feature, so pull the body as text and
    // parse it with serde_json (already a dependency).
    let body = resp
        .text()
        .await
        .map_err(|e| format!("read body failed: {e}"))?;
    let json: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("bad json: {e}"))?;

    let tag = json
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let latest = tag.trim_start_matches(['v', 'V']).to_string();
    let notes = json
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let url = json
        .get("html_url")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| format!("https://github.com/{REPO}/releases"));
    let asset = json
        .get("assets")
        .and_then(|v| v.as_array())
        .and_then(|a| pick_asset(a));

    Ok(UpdateInfo {
        available: is_newer(&latest, &current),
        current,
        latest,
        notes,
        url,
        asset,
    })
}
