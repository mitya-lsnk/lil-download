mod bins;
mod cookies;
mod dl;
mod probe;
mod urlx;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::async_runtime::spawn_blocking;
use tauri::Manager;

/// Run blocking work off the main thread.
///
/// Tauri executes a non-`async` command on the main thread, which is the UI
/// thread — so `probe_link`, which waits several seconds on yt-dlp talking to a
/// website, froze the entire window for exactly as long as it took. Pasting a
/// link and pressing the button looked like the app had hung, because it had.
///
/// `async` alone would move the work to the async runtime, where a multi-second
/// blocking call starves every other task on that thread instead. The blocking
/// pool is the right home for "waits on a child process".
async fn off_thread<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    spawn_blocking(f).await.map_err(|e| format!("задача сорвалась: {e}"))
}

/// Paths the user set in Settings, passed down from the frontend on every call.
///
/// They live in the webview's localStorage rather than in a Rust-side config
/// file, exactly like every other preference in `lil view` — one place to look,
/// and nothing to keep in sync.
#[derive(Default, serde::Deserialize)]
pub struct ToolPaths {
    ytdlp: Option<String>,
    ffmpeg: Option<String>,
    /// Browser to read cookies from, when the user picked one.
    cookies: Option<String>,
}

/// Locating a tool means running it to read its version — two child processes,
/// and on an unlucky machine a couple of seconds of them.
#[tauri::command]
async fn tool_status(
    app: tauri::AppHandle,
    paths: Option<ToolPaths>,
) -> Result<Vec<bins::ToolStatus>, String> {
    let p = paths.unwrap_or_default();
    off_thread(move || {
        vec![
            bins::locate(&app, bins::Tool::Ytdlp, p.ytdlp.as_deref()),
            bins::locate(&app, bins::Tool::Ffmpeg, p.ffmpeg.as_deref()),
        ]
    })
    .await
}

/// Is the yt-dlp we'd actually use out of date?
#[tauri::command]
async fn check_ytdlp_update(
    app: tauri::AppHandle,
    paths: Option<ToolPaths>,
    channel: Option<bins::Channel>,
) -> Result<bins::UpdateInfo, String> {
    let p = paths.unwrap_or_default();
    bins::check_update(&app, p.ytdlp.as_deref(), channel.unwrap_or_default()).await
}

#[tauri::command]
async fn install_tool(
    app: tauri::AppHandle,
    tool: bins::Tool,
    channel: Option<bins::Channel>,
) -> Result<bins::ToolStatus, String> {
    bins::install(&app, tool, channel.unwrap_or_default()).await
}

/// Parse a pasted link: cut the playlist tail, keep the timecode, name the source.
#[tauri::command]
fn parse_link(input: String) -> Option<urlx::ParsedLink> {
    urlx::parse_link(&input)
}

/// Can we read this browser's cookies, and if not, what fixes it.
#[tauri::command]
async fn cookie_access(browser: String) -> Result<cookies::CookieStatus, String> {
    off_thread(move || cookies::check(&browser)).await
}

#[tauri::command]
fn open_privacy_settings() -> Result<(), String> {
    cookies::open_privacy_settings()
}

fn resolve(
    app: &tauri::AppHandle,
    paths: &ToolPaths,
) -> Result<(bins::Cmd, Option<PathBuf>), String> {
    let y = bins::locate(app, bins::Tool::Ytdlp, paths.ytdlp.as_deref());
    let yt = y
        .cmd
        .ok_or("yt-dlp не найден — установи его на экране настроек")?;
    let f = bins::locate(app, bins::Tool::Ffmpeg, paths.ffmpeg.as_deref());
    Ok((yt, f.path.map(PathBuf::from)))
}

/// The slow one: a full yt-dlp extractor run against the site, seconds at best.
#[tauri::command]
async fn probe_link(
    app: tauri::AppHandle,
    url: String,
    paths: Option<ToolPaths>,
) -> Result<probe::MediaInfo, String> {
    let p = paths.unwrap_or_default();
    off_thread(move || {
        let (yt, _) = resolve(&app, &p)?;
        probe::probe(&yt, &url, p.cookies.as_deref())
    })
    .await?
}

#[tauri::command]
async fn playlist_size(
    app: tauri::AppHandle,
    url: String,
    paths: Option<ToolPaths>,
) -> Option<u64> {
    let p = paths.unwrap_or_default();
    off_thread(move || {
        let (yt, _) = resolve(&app, &p).ok()?;
        probe::playlist_size(&yt, &url, p.cookies.as_deref())
    })
    .await
    .ok()
    .flatten()
}

/// Also off the main thread: before anything is spawned this locates both
/// tools, which runs both of them to read their versions. That is the pause
/// between pressing Download and the row starting to move.
#[tauri::command]
async fn start_download(
    app: tauri::AppHandle,
    req: dl::DownloadRequest,
    paths: Option<ToolPaths>,
) -> Result<(), String> {
    let mut req = req;
    let p = paths.unwrap_or_default();
    off_thread(move || {
    let (yt, ff) = resolve(&app, &p)?;
    // Checked here rather than left to yt-dlp: an empty or mangled link there
    // comes back as a parser complaint about whatever argument followed it.
    if !req.url.starts_with("http://") && !req.url.starts_with("https://") {
        return Err("ссылка пустая или не похожа на ссылку".into());
    }
    req.cookies = req.cookies.or_else(|| p.cookies.clone());
        let jobs = app.state::<Arc<dl::Jobs>>().inner().clone();
        dl::start(app.clone(), jobs, yt, ff, req)
    })
    .await?
}

#[tauri::command]
fn cancel_download(app: tauri::AppHandle, id: u64) -> Result<(), String> {
    dl::cancel(&app.state::<Arc<dl::Jobs>>(), id)
}

/// The system's Downloads folder — the default destination (PLAN §4).
#[tauri::command]
fn default_download_dir(app: tauri::AppHandle) -> Option<String> {
    app.path()
        .download_dir()
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

/// Move a downloaded file to the system Trash.
///
/// Trash, not delete. The row this is reached from sits next to "показать в
/// папке" and gets clicked by mistake; a download that took an hour should
/// survive a misplaced click, and every desktop already has the mechanism for
/// that. Nothing here removes anything permanently.
#[tauri::command]
async fn trash_file(path: String) -> Result<(), String> {
    off_thread(move || {
        let p = PathBuf::from(&path);
        // Refuse anything that isn't a plain file we can see. A directory here
        // would mean the path came from somewhere it shouldn't have.
        if !p.is_file() {
            return Err("файла уже нет на месте".to_string());
        }
        trash::delete(&p).map_err(|e| format!("не убрать в корзину: {e}"))
    })
    .await?
}

/// Show a finished file in Finder/Explorer/the file manager. Three platforms,
/// three completely different incantations.
#[tauri::command]
fn reveal(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err("файла уже нет на месте".into());
    }
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg("-R").arg(&p);
        c
    };
    #[cfg(windows)]
    let mut cmd = {
        let mut c = std::process::Command::new("explorer");
        // No space after the comma — explorer is picky about this exact form.
        c.arg(format!("/select,{}", p.display()));
        c
    };
    #[cfg(target_os = "linux")]
    let mut cmd = {
        // No portable "select the file", so open the folder that contains it.
        let mut c = std::process::Command::new("xdg-open");
        c.arg(p.parent().unwrap_or(&p));
        c
    };
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(Arc::new(dl::Jobs::default()))
        .invoke_handler(tauri::generate_handler![
            tool_status,
            install_tool,
            check_ytdlp_update,
            parse_link,
            cookie_access,
            open_privacy_settings,
            probe_link,
            playlist_size,
            start_download,
            cancel_download,
            default_download_dir,
            reveal,
            trash_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
