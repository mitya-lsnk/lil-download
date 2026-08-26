//! Running yt-dlp and turning its chatter into something the queue can draw.
//!
//! yt-dlp reports progress by rewriting one terminal line with `\r`, which is
//! unparseable from a GUI. `--progress-template` fixes that: we ask for the raw
//! numbers, on their own line, prefixed with a marker so they can't be confused
//! with the rest of its output.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::bins::Cmd;

/// Marker in front of every machine-readable progress line. Anything else on
/// stdout is yt-dlp talking to a human, and gets kept as the status text.
const MARK: &str = "@@LD@@";

/// Format selectors per preset (PLAN §3). Data, not branches — a preset is a
/// yt-dlp format string plus a container, and nothing else so far.
/// Containers whose codecs everyday players actually decode.
///
/// This is the crux of the "it downloaded as .webm and macOS won't open it"
/// problem. Asking for an mp4 is not enough on its own — ffmpeg will happily
/// put VP9 and Opus inside one, and QuickTime, iOS and most TVs still refuse
/// it. So picking mp4/mov also asks yt-dlp to *prefer* H.264 and AAC when
/// choosing what to download, which is what makes the file play.
fn prefers_common_codecs(container: &str) -> bool {
    matches!(container, "mp4" | "mov")
}

fn selector(preset: &str) -> (&'static str, Option<&'static str>) {
    match preset {
        // Compatible: H.264 up to 1080p with AAC. Opens in every NLE without
        // transcoding, which is the whole reason this preset exists.
        "compatible" => (
            "bv*[vcodec^=avc1][height<=1080]+ba[ext=m4a]/b[ext=mp4][height<=1080]/b[height<=1080]",
            Some("mp4"),
        ),
        "audio" => ("ba/b", None),
        "compact" => ("bv*[height<=720]+ba/b[height<=720]/b", Some("mp4")),
        // Максимум is the default: take the best of each and remux, never
        // re-encode. Re-encoding "the best" would throw away the point of it.
        _ => ("bv*+ba/b", None),
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct DownloadRequest {
    pub id: u64,
    pub url: String,
    pub dest_dir: String,
    /// One of: max | compatible | audio | compact | custom
    pub preset: String,
    /// Raw yt-dlp format string; wins over the preset when set ("Свой").
    pub format_override: Option<String>,
    /// yt-dlp output template, e.g. "%(title)s.%(ext)s".
    pub filename_template: Option<String>,
    /// Explicitly asked for the whole playlist. Absent/false means one video.
    pub playlist: Option<bool>,
    /// Raw yt-dlp flags typed by the user, appended last so they win.
    pub extra_args: Option<String>,
    /// Browser to lift cookies from ("firefox", "safari", "chrome"…).
    pub cookies: Option<String>,
    /// Cut out sponsor segments using the SponsorBlock database.
    pub sponsorblock: Option<bool>,
    /// "off" | "file" | "embed"
    pub subs: Option<String>,
    /// Comma-separated language codes for subtitles.
    pub sub_langs: Option<String>,
    /// Human-typed start/end of the piece to keep ("2:30", "1:02:03").
    pub trim_start: Option<String>,
    pub trim_end: Option<String>,
    /// Container to end up in: "auto" | "mp4" | "mkv" | "mov" | "webm".
    pub container: Option<String>,
    /// Audio file format for the audio-only preset.
    pub audio_format: Option<String>,
    /// Re-encode into the container instead of just remuxing. Slow and lossy,
    /// but it is the only thing that always works.
    pub recode: Option<bool>,
    /// Cap the picture height (1080, 720…). None means whatever the preset picks.
    pub max_height: Option<u32>,
    /// Preferred video codec: "h264" | "vp9" | "av01".
    pub vcodec: Option<String>,
    /// Preferred audio codec: "aac" | "opus" | "mp3".
    pub acodec: Option<String>,
    /// Put the poster frame inside the file.
    pub embed_thumbnail: Option<bool>,
    /// Speed cap in yt-dlp's own spelling: "500K", "4.5M". None means flat out.
    pub limit_rate: Option<String>,
}

/// Read a timestamp the way a person writes one.
///
/// yt-dlp would accept `1:02:03` verbatim, but then a typo travels all the way
/// into a failed download. Parsing here means "9:99" is refused while the user
/// is still looking at the field, and it lets us check that the end is actually
/// after the start — the one mistake that produces an empty file rather than an
/// error.
pub fn parse_timestamp(raw: &str) -> Option<f64> {
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    let mut parts: Vec<f64> = Vec::new();
    for p in t.split(':') {
        let p = p.trim();
        if p.is_empty() {
            return None;
        }
        parts.push(p.parse::<f64>().ok()?);
    }
    // Everything but the first field is a subdivision, so it can't reach 60.
    if parts.iter().skip(1).any(|v| *v >= 60.0) {
        return None;
    }
    if parts.iter().any(|v| *v < 0.0) {
        return None;
    }
    Some(match parts.len() {
        1 => parts[0],
        2 => parts[0] * 60.0 + parts[1],
        3 => parts[0] * 3600.0 + parts[1] * 60.0 + parts[2],
        _ => return None,
    })
}

/// The `--download-sections` argument for a trim, when one was asked for and
/// makes sense. An open end is allowed: "from 2:30 to the end" is a normal wish.
fn trim_section(start: Option<&str>, end: Option<&str>) -> Option<String> {
    let a = start.and_then(parse_timestamp);
    let b = end.and_then(parse_timestamp);
    match (a, b) {
        (None, None) => None,
        (Some(a), Some(b)) if b <= a => None, // nonsense; silently downloading
        (a, b) => Some(format!(                // the whole thing beats an empty file
            "*{}-{}",
            a.unwrap_or(0.0),
            b.map(|v| v.to_string()).unwrap_or_else(|| "inf".into())
        )),
    }
}

/// Split a line of flags the way a shell would, honouring quotes.
///
/// Needed because the obvious `split_whitespace()` mangles anything with a
/// space in it — `--user-agent "Mozilla 5.0"` would arrive as three arguments
/// and yt-dlp would reject the lot. Backslash escapes are deliberately left
/// alone: a Windows path is the most likely thing to appear here, and eating
/// its separators would be worse than not supporting escapes.
fn split_args(raw: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut has_content = false;

    for ch in raw.chars() {
        match quote {
            Some(q) if ch == q => quote = None,
            Some(_) => cur.push(ch),
            None if ch == '\'' || ch == '"' => {
                quote = Some(ch);
                // An empty quoted string is still an argument.
                has_content = true;
            }
            None if ch.is_whitespace() => {
                if !cur.is_empty() || has_content {
                    out.push(std::mem::take(&mut cur));
                    has_content = false;
                }
            }
            None => cur.push(ch),
        }
    }
    if !cur.is_empty() || has_content {
        out.push(cur);
    }
    out
}

#[derive(Clone, Serialize)]
struct Progress {
    id: u64,
    downloaded: u64,
    total: Option<u64>,
    speed: Option<f64>,
    eta: Option<u64>,
    /// Which file of a multi-file job (video, then audio, then merge).
    stage: String,
}

#[derive(Clone, Serialize)]
struct Finished {
    id: u64,
    ok: bool,
    /// Where the file landed, when we could tell.
    path: Option<String>,
    error: Option<String>,
}

/// Live children, so Cancel has something to kill.
#[derive(Default)]
pub struct Jobs(pub Mutex<HashMap<u64, std::process::Child>>);

fn parse_num(s: &str) -> Option<f64> {
    match s.trim() {
        "" | "NA" | "None" => None,
        v => v.parse::<f64>().ok(),
    }
}

/// Build the argument list. Split out so it can be tested without running anything.
fn build_args(req: &DownloadRequest, out_template: &str, ffmpeg_dir: Option<&Path>) -> Vec<String> {
    // "auto" and "" both mean "no opinion". Treating them as a real choice is
    // how the container's own codec preference gets silently switched off.
    let pick = |v: &Option<String>| {
        v.as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty() && *v != "auto")
            .map(str::to_string)
    };
    let vcodec = pick(&req.vcodec);
    let acodec = pick(&req.acodec);

    let (fmt, container) = selector(&req.preset);

    // A height cap replaces the preset's selector rather than being spliced into
    // it. The preset strings are compound (`bv*+ba/b[ext=mp4]/b`), and editing
    // one by hand produces selectors that look right and silently match nothing.
    let format = req.format_override.clone().unwrap_or_else(|| match req.max_height {
        Some(h) if req.preset != "audio" => {
            format!("bv*[height<={h}]+ba/b[height<={h}]/b")
        }
        _ => fmt.to_string(),
    });

    let mut args: Vec<String> = vec![
        // PLAN §4: this is the flag that actually stops a playlist. Stripping the
        // URL is belt and braces — a link we failed to recognise must still not
        // run away with 92 videos.
        if req.playlist.unwrap_or(false) { "--yes-playlist" } else { "--no-playlist" }.into(),
        "--newline".into(),
        "--no-warnings".into(),
        "-f".into(),
        format,
        "-o".into(),
        out_template.into(),
        "--progress-template".into(),
        format!(
            "download:{MARK}%(progress.downloaded_bytes)s;%(progress.total_bytes,progress.total_bytes_estimate)s;%(progress.speed)s;%(progress.eta)s;%(info.format_note)s"
        ),
        // Print the final path on its own line so we can show "reveal in folder"
        // without guessing at the template's output.
        //
        // `--print` implies BOTH `--simulate` and `--quiet`. The first is undone
        // by `--no-simulate` — the obvious one, since without it nothing
        // downloads at all. The second is the trap: quiet mode silently
        // swallows the progress template, so the download runs perfectly and
        // the queue sits at 0 B with no speed the whole time.
        "--print".into(),
        format!("after_move:{MARK}FILE;%(filepath)s"),
        "--no-simulate".into(),
        "--no-quiet".into(),
    ];

    // yt-dlp finds ffmpeg on PATH by default, which is no good when ours lives
    // in the app's data dir. Point it at the copy we actually resolved.
    if let Some(f) = ffmpeg_dir {
        args.push("--ffmpeg-location".into());
        args.push(f.to_string_lossy().into_owned());
    }

    // The link goes here — before anything the user can influence — and not at
    // the end, where it used to sit. yt-dlp takes options and URLs in any
    // order, and a hand-typed flag left without its value takes the *next*
    // argument as that value. With the link last, `--proxy` typed and never
    // filled in swallowed it whole, and the only remaining candidate for "the
    // URL" was the ffmpeg path we appended after it — hence downloads dying on
    // `'/…/com.lil.download/bin' is not a valid URL`. Nothing after this point
    // can reach the link.
    args.push(req.url.clone());

    // An explicit container beats whatever the preset would have used: the
    // dropdown exists precisely to override that.
    let chosen = req
        .container
        .as_deref()
        .filter(|c| !c.is_empty() && *c != "auto")
        .or(container);

    // Codec preferences are gathered in one place and emitted as a single
    // `-S`. They used to be pushed from two — the container's implicit wish and
    // the user's explicit one — and a second `-S` replaces the first rather
    // than adding to it, so whichever came last quietly won.
    let mut sort: Vec<String> = Vec::new();
    let common = chosen.map(prefers_common_codecs).unwrap_or(false);

    match (&vcodec, common) {
        (Some(v), _) => sort.push(format!("vcodec:{v}")),
        (None, true) => sort.push("vcodec:h264".into()),
        _ => {}
    }
    match (&acodec, common) {
        (Some(a), _) => sort.push(format!("acodec:{a}")),
        (None, true) => sort.push("acodec:aac".into()),
        _ => {}
    }

    if let Some(c) = chosen {
        args.push("--merge-output-format".into());
        args.push(c.into());
        if req.recode.unwrap_or(false) {
            // The last resort that always works, at the cost of time and a
            // generation of quality.
            args.push("--recode-video".into());
            args.push(c.into());
        }
    }

    if !sort.is_empty() {
        args.push("-S".into());
        args.push(sort.join(","));
    }

    if req.embed_thumbnail.unwrap_or(false) {
        args.push("--embed-thumbnail".into());
        // YouTube serves webp posters, which mp4 containers won't carry.
        args.push("--convert-thumbnails".into());
        args.push("jpg".into());
    }

    if req.preset == "audio" {
        args.push("-x".into());
        args.push("--audio-format".into());
        args.push(req.audio_format.clone().unwrap_or_else(|| "m4a".into()));
    }

    if let Some(b) = req.cookies.as_deref().filter(|b| !b.is_empty()) {
        args.push("--cookies-from-browser".into());
        args.push(b.into());
    }

    if let Some(section) = trim_section(req.trim_start.as_deref(), req.trim_end.as_deref()) {
        args.push("--download-sections".into());
        args.push(section);
        // Without this the cut lands on the nearest keyframe, which can be
        // seconds off. Editors notice; it costs a re-encode of the cut ends only.
        args.push("--force-keyframes-at-cuts".into());
    }

    if req.sponsorblock.unwrap_or(false) {
        args.push("--sponsorblock-remove".into());
        args.push("sponsor,selfpromo,interaction".into());
    }

    match req.subs.as_deref() {
        Some("file") => {
            args.push("--write-subs".into());
            args.push("--write-auto-subs".into());
            args.push("--sub-langs".into());
            args.push(req.sub_langs.clone().unwrap_or_else(|| "ru,en".into()));
            // srt opens in every editor; vtt does not.
            args.push("--convert-subs".into());
            args.push("srt".into());
        }
        Some("embed") => {
            args.push("--write-subs".into());
            args.push("--write-auto-subs".into());
            args.push("--sub-langs".into());
            args.push(req.sub_langs.clone().unwrap_or_else(|| "ru,en".into()));
            args.push("--embed-subs".into());
        }
        _ => {}
    }

    if let Some(rate) = req.limit_rate.as_deref().map(str::trim).filter(|r| !r.is_empty()) {
        args.push("--limit-rate".into());
        args.push(rate.into());
    }

    // Last, so a hand-typed flag overrides what the preset chose. Someone who
    // opens this field knows more about their case than our four presets do.
    if let Some(extra) = req.extra_args.as_deref() {
        args.extend(split_args(extra));
    }

    args
}

/// Start a download. Returns immediately; everything else arrives as events
/// (`dl-progress`, `dl-status`, `dl-done`).
pub fn start(
    app: AppHandle,
    jobs: Arc<Jobs>,
    ytdlp: Cmd,
    ffmpeg: Option<PathBuf>,
    req: DownloadRequest,
) -> Result<(), String> {
    let dir = Path::new(&req.dest_dir);
    if !dir.is_dir() {
        return Err(format!("папки нет: {}", dir.display()));
    }
    let template = req
        .filename_template
        .clone()
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| "%(title)s.%(ext)s".into());
    let out_template = dir.join(template).to_string_lossy().into_owned();

    let mut cmd = ytdlp.build();
    cmd.args(build_args(&req, &out_template, ffmpeg.as_ref().and_then(|p| p.parent())));
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("не запустить yt-dlp: {e}"))?;
    let stdout = child.stdout.take().ok_or("нет stdout у yt-dlp")?;
    let stderr = child.stderr.take().ok_or("нет stderr у yt-dlp")?;

    let id = req.id;
    jobs.0.lock().unwrap().insert(id, child);

    // stderr on its own thread: yt-dlp writes errors there while stdout is still
    // streaming progress, and a full pipe nobody drains would deadlock it.
    let err_buf = Arc::new(Mutex::new(String::new()));
    {
        let err_buf = err_buf.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let mut b = err_buf.lock().unwrap();
                b.push_str(&line);
                b.push('\n');
            }
        });
    }

    std::thread::spawn(move || {
        let mut final_path: Option<String> = None;

        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Some(rest) = line.strip_prefix(MARK) else {
                // Not a progress line — yt-dlp explaining itself. Worth showing
                // verbatim: "Merging formats", "Extracting audio" and friends.
                let t = line.trim();
                if !t.is_empty() {
                    let _ = app.emit("dl-status", (id, t.to_string()));
                }
                continue;
            };
            if let Some(p) = rest.strip_prefix("FILE;") {
                final_path = Some(p.trim().to_string());
                continue;
            }
            let f: Vec<&str> = rest.split(';').collect();
            let _ = app.emit(
                "dl-progress",
                Progress {
                    id,
                    downloaded: f.first().and_then(|v| parse_num(v)).unwrap_or(0.0) as u64,
                    total: f.get(1).and_then(|v| parse_num(v)).map(|v| v as u64),
                    speed: f.get(2).and_then(|v| parse_num(v)),
                    eta: f.get(3).and_then(|v| parse_num(v)).map(|v| v as u64),
                    stage: f.get(4).unwrap_or(&"").trim().to_string(),
                },
            );
        }

        // Reclaim the child to wait on it — and to stop Cancel from finding a
        // handle to an already-dead process.
        let status = jobs.0.lock().unwrap().remove(&id).map(|mut c| c.wait());

        let ok = matches!(status, Some(Ok(s)) if s.success());
        let error = if ok {
            None
        } else {
            let raw = err_buf.lock().unwrap().clone();
            Some(if raw.trim().is_empty() {
                // No stderr and a non-zero exit is what a kill looks like.
                "Загрузка отменена".to_string()
            } else {
                crate::probe::humanize(&raw)
            })
        };

        let _ = app.emit("dl-done", Finished { id, ok, path: final_path, error });
    });

    Ok(())
}

/// Kill a running job. Partial `.part` files are left to yt-dlp's own resume
/// logic rather than deleted — a cancelled 2 GB download is worth resuming.
pub fn cancel(jobs: &Jobs, id: u64) -> Result<(), String> {
    let mut map = jobs.0.lock().unwrap();
    match map.get_mut(&id) {
        Some(child) => child.kill().map_err(|e| format!("не остановить: {e}")),
        None => Ok(()), // already finished; cancelling twice is not an error
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(preset: &str) -> DownloadRequest {
        DownloadRequest {
            id: 1,
            url: "https://youtu.be/abc".into(),
            dest_dir: "/tmp".into(),
            preset: preset.into(),
            format_override: None,
            filename_template: None,
            playlist: None,
            extra_args: None,
            cookies: None,
            sponsorblock: None,
            subs: None,
            sub_langs: None,
            trim_start: None,
            trim_end: None,
            container: None,
            audio_format: None,
            recode: None,
            max_height: None,
            vcodec: None,
            acodec: None,
            embed_thumbnail: None,
            limit_rate: None,
        }
    }

    #[test]
    fn codec_preferences_are_emitted_as_one_sort_not_two() {
        let mut r = req("max");
        r.container = Some("mp4".into());
        r.vcodec = Some("av01".into());
        r.acodec = Some("opus".into());
        let a = build_args(&r, "/tmp/x.%(ext)s", None);
        // A second -S replaces the first, so there must only ever be one.
        assert_eq!(a.iter().filter(|x| *x == "-S").count(), 1, "{a:?}");
        let i = a.iter().position(|x| x == "-S").unwrap();
        assert_eq!(a[i + 1], "vcodec:av01,acodec:opus");
    }

    #[test]
    fn a_chosen_audio_codec_survives_the_containers_preference() {
        let mut r = req("max");
        r.container = Some("mp4".into());
        r.acodec = Some("opus".into());
        let a = build_args(&r, "/tmp/x.%(ext)s", None).join(" ");
        // Video still falls back to the container's wish; audio does not.
        assert!(a.contains("-S vcodec:h264,acodec:opus"), "{a}");
    }

    #[test]
    fn the_poster_is_converted_because_mp4_cannot_carry_webp() {
        let mut r = req("max");
        r.embed_thumbnail = Some(true);
        let a = build_args(&r, "/tmp/x.%(ext)s", None).join(" ");
        assert!(a.contains("--embed-thumbnail"), "{a}");
        assert!(a.contains("--convert-thumbnails jpg"), "{a}");
    }

    #[test]
    fn a_height_cap_replaces_the_selector_rather_than_being_spliced_in() {
        let mut r = req("max");
        r.max_height = Some(1080);
        let a = build_args(&r, "/tmp/x.%(ext)s", None).join(" ");
        assert!(a.contains("bv*[height<=1080]+ba"), "{a}");
        // The compound preset string must be gone, not edited.
        assert!(!a.contains("bv*+ba/b "), "{a}");
    }

    #[test]
    fn capping_height_does_not_break_the_audio_preset() {
        let mut r = req("audio");
        r.max_height = Some(720);
        let a = build_args(&r, "/tmp/x.%(ext)s", None).join(" ");
        assert!(a.contains("-x"), "{a}");
        assert!(!a.contains("height<="), "{a}");
    }

    #[test]
    fn a_chosen_codec_is_a_preference_and_wins_over_the_containers_guess() {
        let mut r = req("max");
        r.container = Some("mp4".into());
        r.vcodec = Some("av01".into());
        let a = build_args(&r, "/tmp/x.%(ext)s", None).join(" ");
        assert!(a.contains("-S vcodec:av01"), "{a}");
        // mp4 would otherwise have asked for h264; the explicit choice wins.
        assert!(!a.contains("vcodec:h264"), "{a}");
    }

    #[test]
    fn auto_codec_leaves_the_container_preference_alone() {
        let mut r = req("max");
        r.container = Some("mp4".into());
        r.vcodec = Some("auto".into());
        let a = build_args(&r, "/tmp/x.%(ext)s", None).join(" ");
        assert!(a.contains("vcodec:h264,acodec:aac"), "{a}");
    }

    #[test]
    fn asking_for_mp4_also_asks_for_codecs_that_actually_play() {
        let mut r = req("max");
        r.container = Some("mp4".into());
        let a = build_args(&r, "/tmp/x.%(ext)s", None).join(" ");
        assert!(a.contains("--merge-output-format mp4"), "{a}");
        // Without this an mp4 can still arrive full of VP9/Opus and refuse to
        // open in QuickTime — the whole reason this option exists.
        assert!(a.contains("-S vcodec:h264,acodec:aac"), "{a}");
    }

    #[test]
    fn mkv_takes_whatever_codecs_are_best_since_it_plays_them_all() {
        let mut r = req("max");
        r.container = Some("mkv".into());
        let a = build_args(&r, "/tmp/x.%(ext)s", None).join(" ");
        assert!(a.contains("--merge-output-format mkv"), "{a}");
        assert!(!a.contains("vcodec:h264"), "{a}");
    }

    #[test]
    fn an_explicit_container_overrides_the_preset() {
        let mut r = req("compatible"); // preset would have chosen mp4
        r.container = Some("mkv".into());
        let a = build_args(&r, "/tmp/x.%(ext)s", None).join(" ");
        assert!(a.contains("--merge-output-format mkv"), "{a}");
        assert!(!a.contains("--merge-output-format mp4"), "{a}");
    }

    #[test]
    fn auto_container_leaves_the_preset_alone() {
        let mut r = req("compatible");
        r.container = Some("auto".into());
        let a = build_args(&r, "/tmp/x.%(ext)s", None).join(" ");
        assert!(a.contains("--merge-output-format mp4"), "{a}");
    }

    #[test]
    fn recoding_is_opt_in_and_never_happens_by_itself() {
        let mut r = req("max");
        r.container = Some("mp4".into());
        assert!(!build_args(&r, "/tmp/x.%(ext)s", None).join(" ").contains("--recode-video"));
        r.recode = Some(true);
        assert!(build_args(&r, "/tmp/x.%(ext)s", None).join(" ").contains("--recode-video mp4"));
    }

    #[test]
    fn the_audio_preset_honours_the_chosen_file_format() {
        let mut r = req("audio");
        r.audio_format = Some("mp3".into());
        let a = build_args(&r, "/tmp/x.%(ext)s", None).join(" ");
        assert!(a.contains("--audio-format mp3"), "{a}");
    }

    #[test]
    fn timestamps_are_read_the_way_people_write_them() {
        assert_eq!(parse_timestamp("90"), Some(90.0));
        assert_eq!(parse_timestamp("2:30"), Some(150.0));
        assert_eq!(parse_timestamp("1:02:03"), Some(3723.0));
        assert_eq!(parse_timestamp(" 2:30.5 "), Some(150.5));
    }

    #[test]
    fn nonsense_timestamps_are_refused_rather_than_guessed_at() {
        assert_eq!(parse_timestamp("9:99"), None); // 99 seconds is not a thing
        assert_eq!(parse_timestamp("1:2:3:4"), None);
        assert_eq!(parse_timestamp("abc"), None);
        assert_eq!(parse_timestamp("-5"), None);
        assert_eq!(parse_timestamp(""), None);
        assert_eq!(parse_timestamp("2::30"), None);
    }

    #[test]
    fn a_trim_becomes_a_download_section() {
        assert_eq!(trim_section(Some("2:30"), Some("5:00")).as_deref(), Some("*150-300"));
        // Open end: "from here to the end" is a normal thing to want.
        assert_eq!(trim_section(Some("2:30"), None).as_deref(), Some("*150-inf"));
        assert_eq!(trim_section(None, Some("0:30")).as_deref(), Some("*0-30"));
    }

    #[test]
    fn a_backwards_trim_downloads_everything_instead_of_nothing() {
        // An end before the start would hand yt-dlp an empty range and produce
        // a zero-length file. Ignoring the trim is the lesser surprise.
        assert_eq!(trim_section(Some("5:00"), Some("2:30")), None);
        assert_eq!(trim_section(None, None), None);
    }

    #[test]
    fn trimming_asks_for_accurate_cuts() {
        let mut r = req("max");
        r.trim_start = Some("0:10".into());
        r.trim_end = Some("0:40".into());
        let a = build_args(&r, "/tmp/x.%(ext)s", None).join(" ");
        assert!(a.contains("--download-sections *10-40"), "{a}");
        assert!(a.contains("--force-keyframes-at-cuts"), "{a}");
    }

    #[test]
    fn subtitles_land_as_srt_because_vtt_does_not_open_in_editors() {
        let mut r = req("max");
        r.subs = Some("file".into());
        let a = build_args(&r, "/tmp/x.%(ext)s", None).join(" ");
        assert!(a.contains("--convert-subs srt"), "{a}");
        assert!(a.contains("--write-subs"), "{a}");
    }

    #[test]
    fn sponsorblock_is_off_unless_asked_for() {
        let a = build_args(&req("max"), "/tmp/x.%(ext)s", None).join(" ");
        assert!(!a.contains("--sponsorblock"), "{a}");
        let mut r = req("max");
        r.sponsorblock = Some(true);
        let a = build_args(&r, "/tmp/x.%(ext)s", None).join(" ");
        assert!(a.contains("--sponsorblock-remove"), "{a}");
    }

    #[test]
    fn a_chosen_browser_becomes_cookies_from_browser() {
        let mut r = req("max");
        r.cookies = Some("firefox".into());
        let a = build_args(&r, "/tmp/x.%(ext)s", None);
        let i = a.iter().position(|x| x == "--cookies-from-browser").unwrap();
        assert_eq!(a[i + 1], "firefox");
    }

    #[test]
    fn no_browser_chosen_means_the_flag_is_absent() {
        let a = build_args(&req("max"), "/tmp/x.%(ext)s", None);
        assert!(!a.iter().any(|x| x == "--cookies-from-browser"));
    }

    #[test]
    fn hand_typed_flags_are_split_like_a_shell() {
        assert_eq!(split_args("--no-mtime"), vec!["--no-mtime"]);
        assert_eq!(
            split_args("--user-agent \"Mozilla 5.0\" --no-mtime"),
            vec!["--user-agent", "Mozilla 5.0", "--no-mtime"]
        );
        assert_eq!(split_args("  "), Vec::<String>::new());
        // A Windows path must survive intact.
        assert_eq!(
            split_args(r"--ffmpeg-location C:\ffmpeg\bin"),
            vec!["--ffmpeg-location", r"C:\ffmpeg\bin"]
        );
    }

    #[test]
    fn hand_typed_flags_come_after_the_preset_so_they_win() {
        let mut r = req("compatible");
        r.extra_args = Some("--no-mtime".into());
        let a = build_args(&r, "/tmp/x.%(ext)s", None);
        let flag = a.iter().position(|x| x == "--no-mtime").unwrap();
        let fmt = a.iter().position(|x| x == "-f").unwrap();
        assert!(flag > fmt, "hand-typed flags must come last");
    }

    /// The bug this guards against cost a working download and produced an
    /// error naming a directory nobody had typed: a flag left without its
    /// value takes the next argument, and with the link at the end that
    /// argument was the link.
    #[test]
    fn nothing_the_user_types_can_swallow_the_link() {
        let mut r = req("max");
        r.extra_args = Some("--proxy".into());
        let a = build_args(&r, "/tmp/x.%(ext)s", Some(Path::new("/opt/bin")));

        let url = a.iter().position(|x| x == &r.url).unwrap();
        let proxy = a.iter().position(|x| x == "--proxy").unwrap();
        let ff = a.iter().position(|x| x == "/opt/bin").unwrap();
        assert!(url < proxy, "a dangling flag must not be able to reach the link");
        assert!(ff < url, "the ffmpeg path must never be the argument after the link");
    }

    #[test]
    fn a_speed_cap_is_passed_through_but_can_still_be_overridden() {
        let mut r = req("max");
        r.limit_rate = Some("500K".into());
        r.extra_args = Some("--limit-rate 2M".into());
        let a = build_args(&r, "/tmp/x.%(ext)s", None);
        let first = a.iter().position(|x| x == "--limit-rate").unwrap();
        let last = a.iter().rposition(|x| x == "--limit-rate").unwrap();
        assert_ne!(first, last, "both should be present");
        // yt-dlp keeps the last occurrence, so the hand-typed one has to win.
        assert_eq!(a[last + 1], "2M");
    }

    #[test]
    fn the_ffmpeg_path_travels_with_its_flag() {
        let a = build_args(&req("max"), "/tmp/x.%(ext)s", Some(Path::new("/opt/bin")));
        let i = a.iter().position(|x| x == "--ffmpeg-location").unwrap();
        assert_eq!(a[i + 1], "/opt/bin");
    }

    /// Guards the `--print` / `--quiet` interaction: the symptom is a download
    /// that works while reporting no progress at all, which looks like a
    /// parsing bug and isn't one.
    #[test]
    fn printing_the_final_path_does_not_silence_progress() {
        let a = build_args(&req("max"), "/tmp/x.%(ext)s", None);
        assert!(a.contains(&"--print".to_string()));
        assert!(
            a.contains(&"--no-quiet".to_string()),
            "--print implies --quiet, which suppresses --progress-template"
        );
    }

    #[test]
    fn playlists_are_off_unless_explicitly_asked_for() {
        let a = build_args(&req("max"), "/tmp/x.%(ext)s", None);
        assert!(a.contains(&"--no-playlist".to_string()));

        let mut r = req("max");
        r.playlist = Some(true);
        let a = build_args(&r, "/tmp/x.%(ext)s", None);
        assert!(a.contains(&"--yes-playlist".to_string()));
    }

    #[test]
    fn compatible_preset_asks_for_h264_and_caps_at_1080() {
        let a = build_args(&req("compatible"), "/tmp/x.%(ext)s", None).join(" ");
        assert!(a.contains("avc1"), "{a}");
        assert!(a.contains("height<=1080"), "{a}");
        assert!(a.contains("--merge-output-format mp4"), "{a}");
    }

    #[test]
    fn max_preset_never_re_encodes() {
        let a = build_args(&req("max"), "/tmp/x.%(ext)s", None).join(" ");
        assert!(a.contains("bv*+ba"), "{a}");
        assert!(!a.contains("--recode-video"), "{a}");
    }

    #[test]
    fn a_custom_format_wins_over_the_preset() {
        let mut r = req("compatible");
        r.format_override = Some("248+251".into());
        let a = build_args(&r, "/tmp/x.%(ext)s", None).join(" ");
        assert!(a.contains("248+251"), "{a}");
        assert!(!a.contains("avc1"), "{a}");
    }
}
