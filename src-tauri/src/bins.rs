//! Finding — and, if need be, fetching — the two programs that do the actual work.
//!
//! Neither yt-dlp nor ffmpeg is bundled, and both omissions are deliberate:
//!
//! * **yt-dlp** goes stale fast. YouTube changes something every few weeks and a
//!   version frozen at build time would be broken long before most people
//!   updated the app. A copy we can replace on our own schedule is the only
//!   version that keeps working.
//! * **ffmpeg** ships under the GPL. Putting a GPL binary inside the bundle
//!   would pull this MIT app into the GPL's terms. Fetched at runtime into the
//!   user's own data directory, it stays the user's copy of a separate program.
//!
//! Both are looked up in the same order: our managed copy, then whatever the
//! user pointed us at, then the system. A machine that already has ffmpeg from
//! Homebrew should never be made to download a second one.

use std::path::{Path, PathBuf};

use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

/// How a tool is actually launched.
///
/// yt-dlp comes in two shapes and the difference is not cosmetic. The
/// standalone macOS build is a 37 MB PyInstaller bundle that macOS re-scans on
/// every single exec because it isn't notarised — measured here at **11–27
/// seconds of wall time for 0.5 s of CPU**, i.e. almost pure waiting. The
/// 3 MB zipapp run through an existing Python 3.10+ does the same work in
/// **0.26 s**. So when a usable Python is on the machine we install the zipapp,
/// and the binary becomes the fallback for machines without one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Cmd {
    pub program: PathBuf,
    /// Arguments that must come before the tool's own (the zipapp path).
    pub prelude: Vec<String>,
}

impl Cmd {
    pub fn native(p: PathBuf) -> Self {
        Cmd { program: p, prelude: Vec::new() }
    }

    pub fn build(&self) -> std::process::Command {
        let mut c = command(&self.program);
        c.args(&self.prelude);
        c
    }
}

/// Which of the two programs we're talking about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tool {
    Ytdlp,
    Ffmpeg,
    /// Download-only flavour of yt-dlp: the zipapp. Never appears in the UI.
    #[serde(skip)]
    YtdlpZipapp,
}

impl Tool {
    /// The file name to look for on this platform.
    fn exe_name(self) -> &'static str {
        match (self, cfg!(windows)) {
            (Tool::Ytdlp, true) => "yt-dlp.exe",
            (Tool::Ytdlp, false) => "yt-dlp",
            (Tool::YtdlpZipapp, _) => ZIPAPP,
            (Tool::Ffmpeg, true) => "ffmpeg.exe",
            (Tool::Ffmpeg, false) => "ffmpeg",
        }
    }

    /// The spelling this tool actually accepts.
    fn version_flag(self) -> &'static str {
        match self {
            Tool::Ytdlp | Tool::YtdlpZipapp => "--version",
            Tool::Ffmpeg => "-version",
        }
    }

    /// Which tool the UI knows about, given a download flavour.
    fn pick(self, downloaded: Tool) -> Tool {
        match downloaded {
            Tool::YtdlpZipapp => Tool::Ytdlp,
            other => other,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Tool::Ytdlp | Tool::YtdlpZipapp => "yt-dlp",
            Tool::Ffmpeg => "ffmpeg",
        }
    }
}

/// Which build stream to install from.
///
/// Both exist for a reason people actually hit. yt-dlp's stable releases come
/// every few weeks; when YouTube changes something the fix lands in nightly
/// days earlier, and "wait a fortnight" is not an answer when nothing
/// downloads. Stable stays the default because nightly is, by construction,
/// the build nobody has used yet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    #[default]
    Stable,
    Nightly,
}

/// Where a found binary came from — the UI says so out loud, because "it works
/// on my machine but the app says it's missing" is otherwise unanswerable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    /// Our own copy, in the app's data directory. We may update this one.
    Managed,
    /// A path the user typed in Settings.
    Custom,
    /// Found on PATH or in a well-known install location.
    System,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolStatus {
    pub tool: &'static str,
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub origin: Option<Origin>,
    /// "native" or "python" — shown in the UI, because the difference between
    /// them is the difference between a snappy app and a twelve-second wait.
    pub runner: Option<String>,
    /// How the command is assembled. Not shown; used by the callers.
    pub cmd: Option<Cmd>,
    /// Measured cold start, milliseconds. The honest answer to "why is it slow".
    pub startup_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    pub current: Option<String>,
    pub latest: Option<String>,
    /// The installed copy is older than what's published.
    pub stale: bool,
}

/// Compare yt-dlp's date-shaped versions ("2026.08.19", nightlies add a fourth
/// part). Split on dots and compare numerically — string order would put
/// "2026.7.4" after "2026.08.19".
fn version_parts(v: &str) -> Vec<u64> {
    v.trim()
        .trim_start_matches(['v', 'V'])
        .split('.')
        .map(|p| p.trim().parse::<u64>().unwrap_or(0))
        .collect()
}

fn is_older(current: &str, latest: &str) -> bool {
    let (a, b) = (version_parts(current), version_parts(latest));
    // Compare position by position so a nightly's extra component doesn't make
    // it look older than the release it was built from.
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x < y;
        }
    }
    false
}

#[doc(hidden)]
pub fn __test_is_older(a: &str, b: &str) -> bool {
    is_older(a, b)
}

/// Ask GitHub what the newest yt-dlp is.
///
/// This is not a nicety. YouTube breaks yt-dlp every few weeks, and the failure
/// it produces is a plain `HTTP 403` on the media URL *after* the format list
/// came back fine — so the app looks like it's working right up until nothing
/// downloads. A version check turns that into one sentence the user can act on.
pub async fn check_update(
    app: &AppHandle,
    custom: Option<&str>,
    ch: Channel,
) -> Result<UpdateInfo, String> {
    let current = locate(app, Tool::Ytdlp, custom).version;

    // Compared against the same stream the install button would fetch —
    // checking stable while running a nightly would report "устарел" forever.
    let repo = match ch {
        Channel::Stable => "yt-dlp/yt-dlp",
        Channel::Nightly => "yt-dlp/yt-dlp-nightly-builds",
    };
    let body = github(&format!("https://api.github.com/repos/{repo}/releases/latest")).await?;
    let json: serde_json::Value =
        serde_json::from_slice(&body).map_err(|e| format!("GitHub вернул не JSON: {e}"))?;
    let latest = json.get("tag_name").and_then(|v| v.as_str()).map(str::to_string);

    let stale = match (current.as_deref(), latest.as_deref()) {
        (Some(c), Some(l)) => is_older(c, l),
        _ => false,
    };
    Ok(UpdateInfo { current, latest, stale })
}

/// One GET against the GitHub API.
///
/// reqwest here is built without its `json` feature (fewer deps, and the same
/// choice lil edit made), so callers decode the bytes themselves.
async fn github(url: &str) -> Result<Vec<u8>, String> {
    reqwest::Client::builder()
        .user_agent(concat!("lil-download/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("не спросить GitHub: {e}"))?
        .bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| e.to_string())
}

/// `<app data>/bin` — where managed copies live.
pub fn bin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("не найдена папка данных приложения: {e}"))?
        .join("bin");
    std::fs::create_dir_all(&dir).map_err(|e| format!("не создать {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Places worth checking beyond PATH. Homebrew on Apple silicon in particular
/// isn't on PATH for a GUI app launched from Finder — the app doesn't inherit
/// the shell's environment, which is why "but it works in my terminal".
fn well_known_dirs() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = Vec::new();
    if cfg!(target_os = "macos") {
        v.push(PathBuf::from("/opt/homebrew/bin"));
        v.push(PathBuf::from("/usr/local/bin"));
        v.push(PathBuf::from("/opt/local/bin"));
    } else if cfg!(target_os = "linux") {
        v.push(PathBuf::from("/usr/bin"));
        v.push(PathBuf::from("/usr/local/bin"));
        v.push(PathBuf::from("/snap/bin"));
        if let Some(home) = std::env::var_os("HOME") {
            v.push(PathBuf::from(home).join(".local/bin"));
        }
    } else if let Some(pf) = std::env::var_os("ProgramFiles") {
        v.push(PathBuf::from(pf));
    }
    v
}

/// A Python new enough to run the yt-dlp zipapp (3.10+).
///
/// macOS ships /usr/bin/python3 at 3.9, which yt-dlp refuses outright — so the
/// check has to be for the actual version, not for the file existing. Getting
/// that wrong means shipping a zipapp that dies with an ImportError.
pub fn find_python() -> Option<(PathBuf, (u32, u32))> {
    let names = [
        "python3.14", "python3.13", "python3.12", "python3.11", "python3.10", "python3",
    ];
    let mut seen: Vec<PathBuf> = Vec::new();
    for name in names {
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Some(p) = search_path(name) {
            candidates.push(p);
        }
        for d in well_known_dirs() {
            candidates.push(d.join(name));
        }
        for path in candidates {
            if seen.contains(&path) || !is_executable(&path) {
                continue;
            }
            seen.push(path.clone());
            let out = command(&path)
                .args(["-c", "import sys;print(sys.version_info[0],sys.version_info[1])"])
                .output()
                .ok()?;
            if !out.status.success() {
                continue;
            }
            let text = String::from_utf8_lossy(&out.stdout);
            let mut it = text.split_whitespace().filter_map(|n| n.parse::<u32>().ok());
            if let (Some(maj), Some(min)) = (it.next(), it.next()) {
                if maj > 3 || (maj == 3 && min >= 10) {
                    return Some((path, (maj, min)));
                }
            }
        }
    }
    None
}

fn is_executable(p: &Path) -> bool {
    if !p.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(p)
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    true
}

fn search_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|d| d.join(name))
        .find(|c| is_executable(c))
}

/// Build a Command that never flashes a console window on Windows. Without this
/// every metadata probe pops a black cmd box for a fraction of a second.
pub fn command(program: &Path) -> std::process::Command {
    let cmd = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut cmd = cmd;
        cmd.creation_flags(CREATE_NO_WINDOW);
        return cmd;
    }
    #[cfg(not(windows))]
    cmd
}

/// Ask a binary for its version — doubles as proof that it actually runs. A file
/// that exists but won't execute (wrong architecture, quarantined, half-downloaded)
/// is worse than a missing one, because it fails later and more confusingly.
fn probe_version(cmd: &Cmd, tool: Tool) -> Option<(String, u64)> {
    // ffmpeg wants `-version`, yt-dlp wants `--version`, and each *runs* on the
    // other's spelling while exiting non-zero. So the test has to be "did it
    // exit successfully", not "did it start" — getting that wrong reports a
    // perfectly good Homebrew install as missing.
    let started = std::time::Instant::now();
    let out = [tool.version_flag(), "--version", "-version"]
        .iter()
        .filter_map(|flag| cmd.build().arg(flag).output().ok())
        .find(|o| o.status.success())?;
    let ms = started.elapsed().as_millis() as u64;
    let text = String::from_utf8_lossy(&out.stdout);
    let first = text.lines().next()?.trim();
    let version = match tool {
        // "ffmpeg version 7.1 Copyright (c) …" → "7.1"
        Tool::Ffmpeg => first
            .strip_prefix("ffmpeg version ")
            .and_then(|r| r.split_whitespace().next())
            .unwrap_or(first)
            .to_string(),
        Tool::Ytdlp | Tool::YtdlpZipapp => first.to_string(),
    };
    Some((version, ms))
}

/// Name of the managed zipapp. Kept distinct from the native binary so both can
/// sit in the bin directory and the faster one simply wins.
const ZIPAPP: &str = "yt-dlp.pyz";

/// Locate a tool. `custom` is the path from Settings, when the user set one.
///
/// Order: the user's explicit choice, then our managed copies (zipapp before
/// binary, because of the 40× startup difference), then the system. An explicit
/// choice winning over ours is the point of offering the field at all.
pub fn locate(app: &AppHandle, tool: Tool, custom: Option<&str>) -> ToolStatus {
    let name = tool.exe_name();
    let mut candidates: Vec<(Cmd, Origin, &'static str)> = Vec::new();

    if let Some(c) = custom.filter(|c| !c.trim().is_empty()) {
        let p = PathBuf::from(c);
        // Accept both "the binary" and "the folder it's in" — people paste either.
        candidates.push((
            Cmd::native(if p.is_dir() { p.join(name) } else { p }),
            Origin::Custom,
            "native",
        ));
    }

    if let Ok(dir) = bin_dir(app) {
        if tool == Tool::Ytdlp {
            let pyz = dir.join(ZIPAPP);
            if pyz.is_file() {
                if let Some((py, _)) = find_python() {
                    candidates.push((
                        Cmd { program: py, prelude: vec![pyz.to_string_lossy().into_owned()] },
                        Origin::Managed,
                        "python",
                    ));
                }
            }
        }
        candidates.push((Cmd::native(dir.join(name)), Origin::Managed, "native"));
    }

    if let Some(p) = search_path(name) {
        candidates.push((Cmd::native(p), Origin::System, "native"));
    }
    for d in well_known_dirs() {
        candidates.push((Cmd::native(d.join(name)), Origin::System, "native"));
    }

    for (cmd, origin, runner) in candidates {
        if !is_executable(&cmd.program) {
            continue;
        }
        if let Some((version, ms)) = probe_version(&cmd, tool) {
            return ToolStatus {
                tool: tool.label(),
                found: true,
                path: Some(if cmd.prelude.is_empty() {
                    cmd.program.to_string_lossy().into_owned()
                } else {
                    cmd.prelude[0].clone()
                }),
                version: Some(version),
                origin: Some(origin),
                runner: Some(runner.into()),
                cmd: Some(cmd),
                startup_ms: Some(ms),
            };
        }
    }

    ToolStatus {
        tool: tool.label(),
        found: false,
        path: None,
        version: None,
        origin: None,
        runner: None,
        cmd: None,
        startup_ms: None,
    }
}

// ---------------------------------------------------------------- downloading

/// Where each tool comes from. yt-dlp publishes bare binaries; ffmpeg only ever
/// comes as an archive, and a different one per platform.
///
/// Async because one case can't be a constant: BtbN name their stable ffmpeg
/// zips after the version inside them (`ffmpeg-n9.0-latest-win64-gpl-9.0.zip`),
/// so a hardcoded URL there would rot the day ffmpeg 9.1 ships. That one is
/// looked up; every other combination is a fixed address.
async fn download_url(tool: Tool, ch: Channel) -> Result<String, String> {
    // yt-dlp's nightlies live in a separate repository with identical asset
    // names, so the channel is only ever a change of owner/repo.
    let repo = match ch {
        Channel::Stable => "yt-dlp/yt-dlp",
        Channel::Nightly => "yt-dlp/yt-dlp-nightly-builds",
    };
    let asset = |name: &str| format!("https://github.com/{repo}/releases/latest/download/{name}");

    Ok(match tool {
        Tool::Ytdlp => {
            if cfg!(target_os = "macos") {
                asset("yt-dlp_macos")
            } else if cfg!(windows) {
                asset("yt-dlp.exe")
            } else {
                asset("yt-dlp_linux")
            }
        }
        // The plain asset is the 3 MB Python zipapp — same program, none of the
        // PyInstaller weight.
        Tool::YtdlpZipapp => asset("yt-dlp"),
        Tool::Ffmpeg => {
            if cfg!(target_os = "macos") {
                // evermeet publish both streams behind two stable addresses.
                match ch {
                    Channel::Stable => "https://evermeet.cx/ffmpeg/getrelease/zip".into(),
                    Channel::Nightly => "https://evermeet.cx/ffmpeg/get/zip".into(),
                }
            } else if cfg!(windows) {
                match ch {
                    Channel::Nightly => "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip".into(),
                    Channel::Stable => newest_btbn_release().await?,
                }
            } else {
                match ch {
                    Channel::Stable => "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz".into(),
                    Channel::Nightly => "https://johnvansickle.com/ffmpeg/builds/ffmpeg-git-amd64-static.tar.xz".into(),
                }
            }
        }
    })
}

/// The newest versioned win64 GPL zip in BtbN's latest release.
///
/// Picks by asset name rather than trusting order: the release carries several
/// ffmpeg lines at once (8.1 and 9.0 side by side today), and "whichever came
/// back first" would install an older one at random.
async fn newest_btbn_release() -> Result<String, String> {
    let body = github("https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest").await?;
    let json: serde_json::Value =
        serde_json::from_slice(&body).map_err(|e| format!("GitHub вернул не JSON: {e}"))?;

    let mut best: Option<(Vec<u32>, String)> = None;
    for a in json.get("assets").and_then(|v| v.as_array()).into_iter().flatten() {
        let name = a.get("name").and_then(|v| v.as_str()).unwrap_or_default();
        // Shared builds put the DLLs beside the exe; we copy out one file.
        if !name.starts_with("ffmpeg-n") || !name.contains("win64-gpl") || name.contains("shared") {
            continue;
        }
        let ver: Vec<u32> = name
            .trim_start_matches("ffmpeg-n")
            .split(['-', '.'])
            .map_while(|p| p.parse::<u32>().ok())
            .collect();
        let url = a.get("browser_download_url").and_then(|v| v.as_str()).unwrap_or_default();
        if url.is_empty() || ver.is_empty() {
            continue;
        }
        if best.as_ref().is_none_or(|(b, _)| *b < ver) {
            best = Some((ver, url.to_string()));
        }
    }
    best.map(|(_, u)| u)
        .ok_or_else(|| "у BtbN нет стабильной сборки ffmpeg для Windows".into())
}

#[derive(Clone, Serialize)]
struct InstallProgress {
    tool: &'static str,
    /// Bytes received so far.
    done: u64,
    /// Total size, when the server bothered to send one.
    total: Option<u64>,
    /// "download" | "extract" | "done"
    stage: &'static str,
}

/// Fetch a URL to a file, emitting progress as it goes. Returns the sha256, which
/// gets logged so a corrupted download can be told apart from a broken build.
async fn fetch_to_file(
    app: &AppHandle,
    tool: Tool,
    url: &str,
    dest: &Path,
) -> Result<String, String> {
    let resp = reqwest::Client::builder()
        .user_agent(concat!("lil-download/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("не скачать {}: {e}", tool.label()))?;

    if !resp.status().is_success() {
        return Err(format!("{} ответил {}", url, resp.status()));
    }

    let total = resp.content_length();
    let mut file = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut done: u64 = 0;
    let mut last_emit: u64 = 0;
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("обрыв загрузки: {e}"))?;
        use std::io::Write;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        hasher.update(&chunk);
        done += chunk.len() as u64;
        // Emitting on every chunk floods the webview; a step of 256 KiB is
        // smooth to look at and cheap.
        if done - last_emit > 256 * 1024 {
            last_emit = done;
            let _ = app.emit(
                "install-progress",
                InstallProgress { tool: tool.label(), done, total, stage: "download" },
            );
        }
    }
    drop(file);

    // A stream that ends early is not an error on its own — it just stops. Left
    // unchecked it surfaces much later as "corrupt deflate stream" from the
    // extractor, which blames the archive for a network problem.
    if let Some(expected) = total {
        if done < expected {
            let _ = std::fs::remove_file(dest);
            return Err(format!(
                "загрузка {} оборвалась: {} из {} байт",
                tool.label(),
                done,
                expected
            ));
        }
    }

    Ok(hex::encode(hasher.finalize()))
}

#[cfg(unix)]
fn make_executable(p: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(p).map_err(|e| e.to_string())?.permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(p, perms).map_err(|e| e.to_string())
}

#[cfg(not(unix))]
fn make_executable(_p: &Path) -> Result<(), String> {
    Ok(())
}

/// Pull one named file out of a zip, wherever it sits in the tree. The Windows
/// ffmpeg build nests it under `ffmpeg-*/bin/`, the macOS one has it at the root.
fn extract_from_zip(archive: &Path, want: &str, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("битый архив: {e}"))?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let is_match = entry
            .enclosed_name()
            .and_then(|p| p.file_name().map(|f| f.to_string_lossy().into_owned()))
            .map(|n| n == want)
            .unwrap_or(false);
        if !is_match || !entry.is_file() {
            continue;
        }
        let mut out = std::fs::File::create(dest).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        return Ok(());
    }
    Err(format!("в архиве нет {want}"))
}

#[cfg(target_os = "linux")]
fn extract_from_tar_xz(archive: &Path, want: &str, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut tar = tar::Archive::new(xz2::read::XzDecoder::new(file));
    for entry in tar.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let matches = entry
            .path()
            .ok()
            .and_then(|p| p.file_name().map(|f| f.to_string_lossy().into_owned()))
            .map(|n| n == want)
            .unwrap_or(false);
        if !matches {
            continue;
        }
        let mut out = std::fs::File::create(dest).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        return Ok(());
    }
    Err(format!("в архиве нет {want}"))
}

#[cfg(not(target_os = "linux"))]
fn extract_from_tar_xz(_a: &Path, _w: &str, _d: &Path) -> Result<(), String> {
    Err("tar.xz только на linux".into())
}

/// Download a tool into the managed bin directory, replacing any copy already
/// there. The new file is written beside the old one and swapped in at the end,
/// so a failed download can't leave a half-written binary behind.
pub async fn install(app: &AppHandle, tool: Tool, ch: Channel) -> Result<ToolStatus, String> {
    let dir = bin_dir(app)?;

    // Pick the flavour before anything is fetched. On a machine with Python
    // 3.10+ the zipapp is 3 MB and starts in a quarter-second; the standalone
    // binary is 37 MB and, on macOS, waits ~12 s on Gatekeeper every run. Same
    // program either way — this only decides how much the user waits.
    let python = if tool == Tool::Ytdlp { find_python() } else { None };
    let tool = match (tool, &python) {
        (Tool::Ytdlp, Some(_)) => Tool::YtdlpZipapp,
        (t, _) => t,
    };

    let final_path = dir.join(tool.exe_name());
    let url = download_url(tool, ch).await?;
    let tmp = dir.join(format!("{}.part", tool.exe_name()));

    let sha = fetch_to_file(app, tool, &url, &tmp).await?;

    let staged = dir.join(format!("{}.new", tool.exe_name()));
    if url.ends_with(".zip") || url.ends_with("/zip") {
        let _ = app.emit(
            "install-progress",
            InstallProgress { tool: tool.label(), done: 0, total: None, stage: "extract" },
        );
        extract_from_zip(&tmp, tool.exe_name(), &staged)?;
        let _ = std::fs::remove_file(&tmp);
    } else if url.ends_with(".tar.xz") {
        let _ = app.emit(
            "install-progress",
            InstallProgress { tool: tool.label(), done: 0, total: None, stage: "extract" },
        );
        extract_from_tar_xz(&tmp, tool.exe_name(), &staged)?;
        let _ = std::fs::remove_file(&tmp);
    } else {
        std::fs::rename(&tmp, &staged).map_err(|e| e.to_string())?;
    }

    make_executable(&staged)?;

    let verify = match &python {
        Some((py, _)) if tool == Tool::YtdlpZipapp => Cmd {
            program: py.clone(),
            prelude: vec![staged.to_string_lossy().into_owned()],
        },
        _ => Cmd::native(staged.clone()),
    };

    // Verify before swapping: something that downloaded fine but won't run
    // (wrong arch, a Python too old for the zipapp) must not replace a working
    // copy.
    if probe_version(&verify, tool).is_none() {
        let _ = std::fs::remove_file(&staged);
        return Err(format!(
            "{} скачался (sha256 {}), но не запускается — возможно, не та архитектура",
            tool.label(),
            &sha[..12]
        ));
    }

    let _ = std::fs::remove_file(&final_path);
    std::fs::rename(&staged, &final_path).map_err(|e| e.to_string())?;

    // Installing the zipapp makes any older standalone binary dead weight —
    // 37 MB that will never be chosen again.
    if tool == Tool::YtdlpZipapp {
        let _ = std::fs::remove_file(dir.join(Tool::Ytdlp.exe_name()));
    }

    let _ = app.emit(
        "install-progress",
        InstallProgress { tool: tool.label(), done: 0, total: None, stage: "done" },
    );
    Ok(locate(app, Tool::Ytdlp.pick(tool), None))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Runs only where the tools are actually installed. The bug this guards
    /// against — a working binary reported as missing because the version flag
    /// exited non-zero — is invisible to any test that stubs the process out.
    #[test]
    fn a_real_install_is_recognised_by_both_spellings() {
        for (tool, name) in [(Tool::Ytdlp, "yt-dlp"), (Tool::Ffmpeg, "ffmpeg")] {
            let Some(path) = search_path(name) else {
                continue; // not installed here; nothing to check
            };
            let v = probe_version(&Cmd::native(path.clone()), tool);
            assert!(v.is_some(), "{name} at {} reported as unusable", path.display());
            let (version, _ms) = v.unwrap();
            assert!(!version.trim().is_empty(), "{name} version came back blank");
        }
    }

    /// The zipapp exists precisely because the standalone build is slow, so a
    /// Python that can't run it is worse than no Python at all — it would send
    /// us down the fast path into an ImportError. macOS ships 3.9 for exactly
    /// this trap.
    #[test]
    fn only_a_python_new_enough_for_yt_dlp_is_accepted() {
        if let Some((path, (maj, min))) = find_python() {
            assert!(
                maj > 3 || (maj == 3 && min >= 10),
                "picked {} which is {maj}.{min} — yt-dlp needs 3.10+",
                path.display()
            );
        }
    }
}
