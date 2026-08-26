//! Asking yt-dlp what's behind a link, before committing to downloading it.
//!
//! The whole point of the card in the UI is that you see the title, the channel
//! and the length *before* anything starts. That costs one `--dump-single-json`
//! call, which is also the cheapest possible way to find out that a link is
//! dead, private, or geo-blocked — failing here is much kinder than failing
//! three minutes into a download.

use serde::Serialize;

use crate::bins::Cmd;

#[derive(Debug, Clone, Serialize)]
pub struct FormatInfo {
    pub id: String,
    pub ext: String,
    pub height: Option<u64>,
    pub fps: Option<f64>,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub filesize: Option<u64>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MediaInfo {
    pub id: String,
    pub title: String,
    pub uploader: Option<String>,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    pub webpage_url: String,
    /// yt-dlp's name for the site — handy as a fallback source label.
    pub extractor: Option<String>,
    pub upload_date: Option<String>,
    pub formats: Vec<FormatInfo>,
    /// Set when the link turned out to be a playlist/channel after all.
    pub playlist_count: Option<u64>,
    /// True when the codec picked by "Максимум" is one the common NLEs choke on.
    /// PLAN §3: we don't override the choice, we just say so out loud.
    pub warns_editors: bool,
}

fn s(v: &serde_json::Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(str::to_string)
}

/// VP9 and AV1 in a webm container is what YouTube hands out above 1080p, and
/// it's exactly what DaVinci Resolve on macOS either refuses to open or opens
/// without sound. Worth a line in the UI, not worth overriding the user.
fn codec_is_awkward(vcodec: Option<&str>, ext: Option<&str>) -> bool {
    let v = vcodec.unwrap_or("").to_ascii_lowercase();
    let e = ext.unwrap_or("").to_ascii_lowercase();
    v.starts_with("vp9") || v.starts_with("vp09") || v.starts_with("av01") || e == "webm"
}

fn parse_formats(v: &serde_json::Value) -> Vec<FormatInfo> {
    v.get("formats")
        .and_then(|f| f.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|f| {
                    Some(FormatInfo {
                        id: s(f, "format_id")?,
                        ext: s(f, "ext").unwrap_or_default(),
                        height: f.get("height").and_then(|x| x.as_u64()),
                        fps: f.get("fps").and_then(|x| x.as_f64()),
                        vcodec: s(f, "vcodec").filter(|c| c != "none"),
                        acodec: s(f, "acodec").filter(|c| c != "none"),
                        filesize: f
                            .get("filesize")
                            .or_else(|| f.get("filesize_approx"))
                            .and_then(|x| x.as_u64()),
                        note: s(f, "format_note"),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Run `yt-dlp -J` against one link.
///
/// `--no-playlist` is passed here as well as at download time on purpose: the
/// card should describe the one video the user pasted, not the 92-video
/// playlist it happens to live in.
pub fn probe(ytdlp: &Cmd, url: &str, cookies: Option<&str>) -> Result<MediaInfo, String> {
    let mut cmd = ytdlp.build();
    cmd.args(["--dump-single-json", "--no-playlist", "--no-warnings", "--no-progress"]);
    // The card is fetched with the same credentials the download will use —
    // otherwise a members-only video looks fine here and fails later.
    if let Some(b) = cookies {
        cmd.arg("--cookies-from-browser").arg(b);
    }
    let out = cmd
        .arg(url)
        .output()
        .map_err(|e| format!("не запустить yt-dlp: {e}"))?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(humanize(&err));
    }

    let v: serde_json::Value =
        serde_json::from_slice(&out.stdout).map_err(|e| format!("yt-dlp вернул не JSON: {e}"))?;

    let formats = parse_formats(&v);
    // The card's warning is about what "Максимум" would actually pick, so look at
    // the best video format rather than at the container of the whole entry.
    let warns_editors = formats
        .iter()
        .filter(|f| f.vcodec.is_some())
        .max_by_key(|f| f.height.unwrap_or(0))
        .map(|f| codec_is_awkward(f.vcodec.as_deref(), Some(&f.ext)))
        .unwrap_or(false);

    Ok(MediaInfo {
        id: s(&v, "id").unwrap_or_default(),
        title: s(&v, "title").unwrap_or_else(|| "без названия".into()),
        uploader: s(&v, "uploader").or_else(|| s(&v, "channel")).or_else(|| s(&v, "creator")),
        duration: v.get("duration").and_then(|x| x.as_f64()),
        thumbnail: s(&v, "thumbnail"),
        webpage_url: s(&v, "webpage_url").unwrap_or_else(|| url.to_string()),
        extractor: s(&v, "extractor_key").or_else(|| s(&v, "extractor")),
        upload_date: s(&v, "upload_date"),
        formats,
        playlist_count: v.get("playlist_count").and_then(|x| x.as_u64()),
        warns_editors,
    })
}

/// Count the entries behind a playlist link without resolving each one — that's
/// what makes "в ссылке был плейлист, 92 видео" cheap enough to show every time.
pub fn playlist_size(ytdlp: &Cmd, url: &str, cookies: Option<&str>) -> Option<u64> {
    let mut cmd = ytdlp.build();
    cmd.args(["--flat-playlist", "--dump-single-json", "--no-warnings"]);
    if let Some(b) = cookies {
        cmd.arg("--cookies-from-browser").arg(b);
    }
    let out = cmd.arg(url).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    v.get("playlist_count")
        .and_then(|x| x.as_u64())
        .or_else(|| v.get("entries").and_then(|e| e.as_array()).map(|a| a.len() as u64))
}

/// yt-dlp's stderr is written for a terminal. These are the failures people
/// actually hit, rewritten as something you can act on.
pub fn humanize(stderr: &str) -> String {
    let low = stderr.to_ascii_lowercase();
    // A 403 on the media URL after the format list arrived fine is the
    // signature of a yt-dlp that YouTube has outgrown. It reads like a
    // permissions problem and is nothing of the sort, so say so plainly.
    // Argument trouble, not site trouble. A flag typed by hand and left without
    // its value takes the next argument as that value, and what follows in the
    // command line is never something the user meant to hand over. Saying
    // "not a valid URL" about a path nobody typed is unanswerable; naming the
    // real cause is not.
    let msg = if low.contains("is not a valid url")
        || low.contains("you must provide at least one url")
        || (low.contains("error:") && low.contains("requires an argument"))
    {
        "Похоже, в своих флагах последний флаг остался без значения — yt-dlp принял за это значение то, что шло следом. Проверь поле со своими флагами."
    } else if low.contains("403") && low.contains("forbidden") {
        "YouTube отдал 403 — почти наверняка yt-dlp устарел. Обнови его в настройках."
    } else if low.contains("sign in to confirm") || low.contains("bot") {
        "YouTube просит подтвердить, что ты не робот. Нажми 🍪 и выбери браузер, где ты залогинен."
    } else if low.contains("private video") {
        "Видео приватное. Нажми 🍪 и выбери браузер с аккаунтом, у которого есть доступ."
    } else if low.contains("members-only") || low.contains("join this channel") {
        "Видео только для спонсоров канала. Нажми 🍪 и выбери браузер, где оформлено спонсорство."
    } else if low.contains("video unavailable") || low.contains("removed") {
        "Видео недоступно или удалено."
    } else if low.contains("geo") && low.contains("block") {
        "Видео заблокировано в этом регионе. Поможет прокси в настройках."
    } else if low.contains("could not copy") && low.contains("cookie") {
        "Не вышло прочитать куки браузера. Закрой его полностью и попробуй ещё раз — Chrome держит базу открытой."
    } else if low.contains("unsupported url") {
        "yt-dlp не знает этот сайт."
    } else if low.contains("age") && low.contains("restrict") {
        "Возрастное ограничение. Нажми 🍪 и выбери браузер, где ты залогинен."
    } else if low.contains("network") || low.contains("timed out") || low.contains("connection") {
        "Не достучались до сайта — похоже, проблема с сетью."
    } else {
        // Nothing matched: show yt-dlp's own last line rather than swallowing it.
        return stderr
            .lines()
            .filter(|l| !l.trim().is_empty())
            .next_back()
            .unwrap_or("yt-dlp не смог разобрать ссылку")
            .trim()
            .trim_start_matches("ERROR:")
            .trim()
            .to_string();
    };
    msg.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn youtube_4k_codecs_are_flagged_for_editors() {
        assert!(codec_is_awkward(Some("vp9"), Some("webm")));
        assert!(codec_is_awkward(Some("av01.0.08M.08"), Some("mp4")));
        assert!(!codec_is_awkward(Some("avc1.640028"), Some("mp4")));
    }

    #[test]
    fn known_failures_become_actionable_russian() {
        let m = humanize("ERROR: [youtube] abc: Private video. Sign in if you've been granted access");
        assert!(m.contains("приватное"), "{m}");
        let m = humanize("ERROR: unable to download video data: <urlopen error timed out>");
        assert!(m.contains("сет"), "{m}");
    }

    #[test]
    fn a_403_is_explained_as_a_stale_ytdlp() {
        let m = humanize("ERROR: unable to download video data: HTTP Error 403: Forbidden");
        assert!(m.contains("устарел"), "{m}");
    }

    #[test]
    fn version_ordering_is_numeric_not_alphabetic() {
        use crate::bins::__test_is_older as is_older;
        assert!(is_older("2026.07.04", "2026.08.19"));
        assert!(!is_older("2026.08.19", "2026.07.04"));
        assert!(!is_older("2026.08.19", "2026.08.19"));
        // A nightly built from a release is not "older" than it.
        assert!(!is_older("2026.08.19.232319", "2026.08.19"));
    }

    #[test]
    fn an_unknown_failure_keeps_yt_dlps_own_words() {
        let m = humanize(
            "ERROR: [generic] '/Users/x/Library/Application Support/com.lil.download/bin' is not a valid URL",
        );
        assert!(m.contains("флаг"), "an argument mistake must not read as a bad link: {m}");

        let m = humanize("ERROR: something nobody predicted\n");
        assert_eq!(m, "something nobody predicted");
    }
}
