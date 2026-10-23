//! The mailbox (PLAN §13, stage 2): how links reach lil download from outside —
//! the Safari helper now, Chrome and Firefox later.
//!
//! Two doors. `lildownload://add?url=…` for one link: any program can open it,
//! and it starts the app when it isn't running. And a folder, `<app data>/inbox`,
//! for anything bigger: a helper drops a JSON file there and knocks with
//! `lildownload://inbox`.
//!
//! They are not trusted the same. A web page can open a custom-scheme link too,
//! so whatever arrives through the link only ever lands on a card the user still
//! has to press Download on. Only the folder — which nothing outside this Mac
//! can write to — may put several files straight into the queue.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use url::Url;

pub const SCHEME: &str = "lildownload";
/// More than this in one go is not a person clicking a button.
const MAX_ITEMS: usize = 200;
const MAX_FILE: u64 = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Item {
    pub url: String,
    /// The page the link was found on; some servers refuse a file without it.
    #[serde(default)]
    pub referer: Option<String>,
    /// "video" or "file" when the sender knows; otherwise the app finds out.
    #[serde(default)]
    pub kind: Option<String>,
    /// Came through the folder rather than the link (see the module note).
    #[serde(default, skip_deserializing)]
    pub trusted: bool,
}

/// Links that arrived before the window was ready to take them.
#[derive(Default)]
pub struct Pending(Mutex<Vec<Item>>);

fn is_web(u: &str) -> bool {
    u.starts_with("http://") || u.starts_with("https://")
}

/// Keep only what is well-formed: a web link, a known kind, a web referer.
fn clean(mut it: Item) -> Option<Item> {
    it.url = it.url.trim().to_string();
    if !is_web(&it.url) || Url::parse(&it.url).is_err() {
        return None;
    }
    it.referer = it.referer.filter(|r| is_web(r));
    it.kind = it.kind.filter(|k| k == "video" || k == "file");
    Some(it)
}

/// `lildownload://add?url=…&referer=…&kind=…` → one item.
pub fn from_link(u: &Url) -> Option<Item> {
    if u.scheme() != SCHEME || u.host_str() != Some("add") {
        return None;
    }
    let q = |k: &str| u.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned());
    clean(Item { url: q("url")?, referer: q("referer"), kind: q("kind"), trusted: false })
}

pub fn dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("inbox"))
}

/// Read and remove every message in the folder, oldest name first. A message
/// is one item or a list of them. Hidden and half-written files (anything not
/// ending in `.json`) are left for their writer to finish.
pub fn drain(dir: &Path) -> Vec<Item> {
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut files: Vec<PathBuf> = rd
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            !name.starts_with('.') && name.ends_with(".json") && p.is_file()
        })
        .collect();
    files.sort();

    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Message {
        One(Item),
        Many(Vec<Item>),
    }

    let mut out = Vec::new();
    for f in files {
        let fits = std::fs::metadata(&f).map(|m| m.len() <= MAX_FILE).unwrap_or(false);
        let parsed = fits
            .then(|| std::fs::read(&f).ok())
            .flatten()
            .and_then(|b| serde_json::from_slice::<Message>(&b).ok());
        // Removed whatever it held: a message that doesn't parse now never will,
        // and leaving it would have it fail again on every knock.
        let _ = std::fs::remove_file(&f);
        let items = match parsed {
            Some(Message::One(i)) => vec![i],
            Some(Message::Many(v)) => v,
            None => continue,
        };
        out.extend(items.into_iter().filter_map(clean).map(|mut i| {
            i.trusted = true;
            i
        }));
        if out.len() >= MAX_ITEMS {
            out.truncate(MAX_ITEMS);
            break;
        }
    }
    out
}

fn bring_forward(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Something knocked: keep what the link carried and tell the window to look.
pub fn on_links(app: &AppHandle, urls: &[Url]) {
    let mine: Vec<&Url> = urls.iter().filter(|u| u.scheme() == SCHEME).collect();
    if mine.is_empty() {
        return;
    }
    {
        let mut p = app.state::<Pending>().inner().0.lock().unwrap();
        p.extend(mine.iter().filter_map(|u| from_link(u)));
        p.truncate(MAX_ITEMS);
    }
    bring_forward(app);
    let _ = app.emit("inbox", ());
}

/// Everything waiting, from both doors. The window calls this when it starts,
/// when it is told something arrived, and whenever it gets focus.
#[tauri::command]
pub fn take_inbox(app: AppHandle) -> Vec<Item> {
    let mut items: Vec<Item> = std::mem::take(&mut *app.state::<Pending>().inner().0.lock().unwrap());
    if let Some(d) = dir(&app) {
        items.extend(drain(&d));
    }
    items
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_carry_one_item() {
        let u = Url::parse(
            "lildownload://add?url=https%3A%2F%2Fex.com%2Fa.zip%3Fsig%3D1&referer=https%3A%2F%2Fex.com%2F&kind=file",
        )
        .unwrap();
        let it = from_link(&u).unwrap();
        assert_eq!(it.url, "https://ex.com/a.zip?sig=1");
        assert_eq!(it.referer.as_deref(), Some("https://ex.com/"));
        assert_eq!(it.kind.as_deref(), Some("file"));
        assert!(!it.trusted);
    }

    #[test]
    fn bad_links_are_refused() {
        for raw in [
            "lildownload://add?url=file%3A%2F%2F%2Fetc%2Fpasswd",
            "lildownload://add?url=javascript%3Aalert(1)",
            "lildownload://add",
            "lildownload://inbox",
            "other://add?url=https%3A%2F%2Fex.com",
        ] {
            assert!(from_link(&Url::parse(raw).unwrap()).is_none(), "{raw}");
        }
        // An unknown kind or a non-web referer is dropped, not the whole item.
        let it = from_link(
            &Url::parse("lildownload://add?url=https%3A%2F%2Fex.com&kind=exe&referer=file%3A%2F%2F%2Fx").unwrap(),
        )
        .unwrap();
        assert_eq!((it.kind, it.referer), (None, None));
    }

    #[test]
    fn the_folder_is_read_in_order_and_emptied() {
        let d = std::env::temp_dir().join(format!("lildl-inbox-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("2.json"), r#"[{"url":"https://b.com/2"},{"url":"ftp://no"}]"#).unwrap();
        std::fs::write(d.join("1.json"), r#"{"url":"https://a.com/1","kind":"video"}"#).unwrap();
        std::fs::write(d.join("3.json"), "not json").unwrap();
        std::fs::write(d.join("4.json.tmp"), r#"{"url":"https://c.com"}"#).unwrap();

        let got = drain(&d);
        let urls: Vec<&str> = got.iter().map(|i| i.url.as_str()).collect();
        assert_eq!(urls, ["https://a.com/1", "https://b.com/2"]);
        assert!(got.iter().all(|i| i.trusted));
        assert_eq!(got[0].kind.as_deref(), Some("video"));
        // Read messages are gone; the half-written one is left for its writer.
        let left: Vec<String> = std::fs::read_dir(&d)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(left, ["4.json.tmp"]);
        let _ = std::fs::remove_dir_all(&d);
    }
}
