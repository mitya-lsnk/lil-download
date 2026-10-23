//! Plain files over HTTP — the «Файлы» tab (PLAN §13).
//!
//! yt-dlp is for pages that have a video on them; this is for links that *are*
//! the file. Two things it does that a browser download doesn't: several
//! connections at once, and picking up exactly where it stopped — after a
//! pause, a dropped network, or a quit.
//!
//! On disk a download in progress is two files next to where it will land:
//! `name.ext.lildownload` with the bytes, and a hidden `.name.ext.lildownload.json`
//! saying which ranges of it are already filled. Both travel with the folder,
//! so nothing about a half-done download lives anywhere the user can't see.

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::header::{self, HeaderMap, HeaderValue};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

const PART: &str = ".lildownload";
/// Never split a piece smaller than this: below it a new connection's
/// handshake costs more than the bytes it would save.
const MIN_SPLIT: u64 = 2 * 1024 * 1024;
pub const MAX_THREADS: usize = 16;
/// Failures in a row, with not a single byte between them, before a
/// connection gives up. With the backoff below that is about half a minute.
const RETRIES: u32 = 6;
/// A connection that has sent nothing for this long is treated as dropped.
const STALL: Duration = Duration::from_secs(30);

// ---- what the server says about a link ----

#[derive(Debug, Clone, Serialize)]
pub struct FileInfo {
    /// Where the redirects ended — what actually gets downloaded.
    pub url: String,
    pub name: String,
    pub size: Option<u64>,
    /// The server hands the file out in pieces, so several connections and
    /// resuming both work. Without it there is one connection and no resume.
    pub ranges: bool,
    pub mime: Option<String>,
    /// The link is a web page rather than a file — a job for the Видео tab.
    pub page: bool,
}

/// What tells "the same file" from "a new version under the same link".
#[derive(Debug, Clone, Default)]
struct Validators {
    etag: Option<String>,
    last_modified: Option<String>,
}

fn client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        let mut h = HeaderMap::new();
        // Compressed responses and byte ranges don't mix: the range would be
        // into the compressed stream, which is not the file.
        h.insert(header::ACCEPT_ENCODING, HeaderValue::from_static("identity"));
        reqwest::Client::builder()
            .user_agent(concat!("lil-download/", env!("CARGO_PKG_VERSION")))
            .default_headers(h)
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("http client")
    })
}

fn request(url: &str, referer: Option<&str>) -> reqwest::RequestBuilder {
    let mut rq = client().get(url);
    if let Some(r) = referer.filter(|r| r.starts_with("http")) {
        rq = rq.header(header::REFERER, r);
    }
    rq
}

fn net_err(e: reqwest::Error) -> String {
    if e.is_connect() {
        // Usually not the internet at all: a server that has had enough of
        // one address stops taking its connections for a while.
        "Сервер не пускает. Если интернет работает — сервер мог на время закрыть доступ (так бывает, если стучаться часто). Подожди немного и нажми «Продолжить».".into()
    } else if e.is_timeout() {
        "Сервер не отвечает.".into()
    } else {
        format!("Связь оборвалась: {e}")
    }
}

/// Plain words for a status that ends the attempt, or None when it doesn't.
fn status_err(s: StatusCode) -> Option<String> {
    if s.is_success() {
        return None;
    }
    let code = s.as_u16();
    Some(match code {
        401 | 403 => format!(
            "Сервер не пускает ({code}). Ссылка могла устареть или нужен вход на сайте — возьми свежую ссылку на странице."
        ),
        404 | 410 => format!("Файла по этой ссылке нет ({code}) — ссылка устарела или файл убрали."),
        429 => "Сервер просит не так часто (429) — подожди немного и попробуй снова.".into(),
        500..=599 => format!("Сервер сломался на своей стороне ({code}) — попробуй позже."),
        _ => format!("Сервер ответил {code}."),
    })
}

fn header_str<'a>(h: &'a HeaderMap, name: header::HeaderName) -> Option<&'a str> {
    h.get(name).and_then(|v| v.to_str().ok())
}

/// `bytes 0-0/12345` → 12345. `*` for the total means the server doesn't know.
fn range_total(h: &HeaderMap) -> Option<u64> {
    header_str(h, header::CONTENT_RANGE)?
        .rsplit('/')
        .next()?
        .trim()
        .parse()
        .ok()
}

async fn ask(url: &str, referer: Option<&str>) -> Result<(FileInfo, Validators), String> {
    // One byte rather than HEAD: plenty of servers answer HEAD differently from
    // GET, or not at all, and a range request answers "do you do ranges" and
    // "how big" in one go. The body is dropped unread.
    let resp = request(url, referer)
        .header(header::RANGE, "bytes=0-0")
        .send()
        .await
        .map_err(net_err)?;
    let status = resp.status();
    let h = resp.headers();
    let mime = header_str(h, header::CONTENT_TYPE)
        .and_then(|m| m.split(';').next())
        .map(|m| m.trim().to_ascii_lowercase())
        .filter(|m| !m.is_empty());

    let (size, ranges) = match status {
        StatusCode::PARTIAL_CONTENT => match range_total(h) {
            Some(n) => (Some(n), true),
            // Pieces of a file of unknown length can't be planned.
            None => (None, false),
        },
        // An empty file can't satisfy "byte 0".
        StatusCode::RANGE_NOT_SATISFIABLE => (Some(range_total(h).unwrap_or(0)), false),
        s => {
            if let Some(e) = status_err(s) {
                return Err(e);
            }
            (resp.content_length(), false)
        }
    };

    let page = matches!(mime.as_deref(), Some("text/html" | "application/xhtml+xml"));
    let name = file_name(h, resp.url(), mime.as_deref());
    let v = Validators {
        etag: header_str(h, header::ETAG).map(str::to_string),
        last_modified: header_str(h, header::LAST_MODIFIED).map(str::to_string),
    };
    Ok((
        FileInfo { url: resp.url().to_string(), name, size, ranges, mime, page },
        v,
    ))
}

/// `ask`, given a second and a third chance when the server is only busy.
/// Right after a pause it may still be counting the connections that were
/// just closed, and turning the resume down for that would be silly.
async fn ask_patiently(url: &str, referer: Option<&str>) -> Result<(FileInfo, Validators), String> {
    let mut wait = 1;
    loop {
        match ask(url, referer).await {
            Err(e) if wait <= 4 && (e.contains("(429)") || e.contains("(5")) => {
                tokio::time::sleep(Duration::from_secs(wait)).await;
                wait *= 2;
            }
            r => return r,
        }
    }
}

pub async fn probe(url: &str, referer: Option<&str>) -> Result<FileInfo, String> {
    ask_patiently(url, referer).await.map(|(i, _)| i)
}

// ---- naming ----

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() && b[i + 1].is_ascii_hexdigit() && b[i + 2].is_ascii_hexdigit() {
            let hex = |c: u8| (c as char).to_digit(16).unwrap() as u8;
            out.push(hex(b[i + 1]) * 16 + hex(b[i + 2]));
            i += 3;
            continue;
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The name from `Content-Disposition`. The RFC 5987 form (`filename*=UTF-8''…`)
/// wins, because that is the one that can carry anything but ASCII.
fn disposition_name(raw: &str) -> Option<String> {
    let mut plain = None;
    for part in raw.split(';') {
        let part = part.trim();
        let Some((k, v)) = part.split_once('=') else { continue };
        let k = k.trim().to_ascii_lowercase();
        let v = v.trim();
        if k == "filename*" {
            // charset'language'value
            let value = v.splitn(3, '\'').nth(2).unwrap_or(v);
            let n = percent_decode(value.trim_matches('"'));
            if !n.trim().is_empty() {
                return Some(n);
            }
        } else if k == "filename" {
            let n = v.trim_matches('"').to_string();
            if !n.trim().is_empty() {
                plain = Some(n);
            }
        }
    }
    plain
}

fn ext_for(mime: &str) -> Option<&'static str> {
    Some(match mime {
        "application/pdf" => "pdf",
        "application/zip" => "zip",
        "application/x-apple-diskimage" => "dmg",
        "application/gzip" | "application/x-gzip" => "gz",
        "application/x-tar" => "tar",
        "application/x-7z-compressed" => "7z",
        "application/json" => "json",
        "text/plain" => "txt",
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "video/mp4" => "mp4",
        "video/quicktime" => "mov",
        "audio/mpeg" => "mp3",
        "audio/mp4" => "m4a",
        _ => return None,
    })
}

/// A name that is safe to create on every platform we ship to.
pub fn sanitize(raw: &str) -> String {
    let mut s: String = raw
        .chars()
        .map(|c| if c.is_control() || r#"/\:*?"<>|"#.contains(c) { '_' } else { c })
        .collect();
    // Leading dots would hide the file; trailing dots and spaces Windows drops.
    s = s.trim().trim_start_matches('.').trim_end_matches(['.', ' ']).to_string();
    // Long names are cut keeping the extension, on a character boundary.
    const LIMIT: usize = 180;
    if s.len() > LIMIT {
        let (stem, ext) = match s.rfind('.') {
            Some(i) if s.len() - i <= 12 => (s[..i].to_string(), s[i..].to_string()),
            _ => (s.clone(), String::new()),
        };
        let mut cut = LIMIT.saturating_sub(ext.len());
        while !stem.is_char_boundary(cut) {
            cut -= 1;
        }
        s = format!("{}{}", stem[..cut].trim_end(), ext);
    }
    s
}

fn file_name(h: &HeaderMap, url: &reqwest::Url, mime: Option<&str>) -> String {
    let from_header = h
        .get(header::CONTENT_DISPOSITION)
        .and_then(|v| disposition_name(&String::from_utf8_lossy(v.as_bytes())));
    let from_url = url
        .path_segments()
        .and_then(|mut s| s.rfind(|x| !x.is_empty()).map(percent_decode));
    let mut name = sanitize(&from_header.or(from_url).unwrap_or_default());
    if name.is_empty() {
        name = "download".into();
    }
    if Path::new(&name).extension().is_none() {
        if let Some(ext) = mime.and_then(ext_for) {
            name = format!("{name}.{ext}");
        }
    }
    name
}

fn part_path(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}{PART}"))
}

fn state_path(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!(".{name}{PART}.json"))
}

/// "file.zip" → "file (2).zip".
fn numbered(name: &str, n: u32) -> String {
    let p = Path::new(name);
    match (p.file_stem(), p.extension()) {
        (Some(stem), Some(ext)) => {
            format!("{} ({n}).{}", stem.to_string_lossy(), ext.to_string_lossy())
        }
        _ => format!("{name} ({n})"),
    }
}

// ---- on-disk state ----

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
struct Seg {
    start: u64,
    /// Exclusive. `u64::MAX` when the size is unknown.
    end: u64,
    /// Everything in `start..pos` is on disk.
    pos: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct Saved {
    /// The link as it was given, so a different download that happens to want
    /// the same name is never mistaken for this one.
    url: String,
    size: Option<u64>,
    ranges: bool,
    etag: Option<String>,
    last_modified: Option<String>,
    segs: Vec<Seg>,
}

fn load(path: &Path) -> Option<Saved> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

fn store(path: &Path, s: &Saved) {
    // Written aside and renamed over, so a crash mid-write leaves the previous
    // copy rather than half a file that parses as nothing.
    let tmp = path.with_extension("json.tmp");
    if let Ok(bytes) = serde_json::to_vec(s) {
        if std::fs::write(&tmp, bytes).is_ok() {
            let _ = std::fs::rename(&tmp, path);
        }
    }
}

/// Initial pieces: equal slices, but none smaller than `MIN_SPLIT`.
fn plan(size: Option<u64>, ranges: bool, threads: usize) -> Vec<Seg> {
    match size {
        Some(n) if ranges && n > 0 => {
            let k = (threads.clamp(1, MAX_THREADS) as u64).min((n / MIN_SPLIT).max(1));
            let step = n / k;
            (0..k)
                .map(|i| {
                    let start = i * step;
                    let end = if i == k - 1 { n } else { start + step };
                    Seg { start, end, pos: start }
                })
                .collect()
        }
        Some(n) => vec![Seg { start: 0, end: n, pos: 0 }],
        None => vec![Seg { start: 0, end: u64::MAX, pos: 0 }],
    }
}

// ---- the running download ----

struct Piece {
    seg: Seg,
    busy: bool,
}

/// Claim work for one connection: an idle unfinished piece first, otherwise
/// half of the biggest piece someone else is still on.
fn claim(pieces: &mut Vec<Piece>, ranges: bool) -> Option<usize> {
    if let Some(i) = pieces.iter().position(|p| !p.busy && p.seg.pos < p.seg.end) {
        pieces[i].busy = true;
        return Some(i);
    }
    if !ranges {
        return None;
    }
    let (i, rem) = pieces
        .iter()
        .enumerate()
        .filter(|(_, p)| p.busy)
        .map(|(i, p)| (i, p.seg.end - p.seg.pos))
        .max_by_key(|&(_, r)| r)?;
    if rem < 2 * MIN_SPLIT {
        return None;
    }
    let mid = pieces[i].seg.pos + rem / 2;
    let end = pieces[i].seg.end;
    pieces[i].seg.end = mid;
    pieces.push(Piece { seg: Seg { start: mid, end, pos: mid }, busy: true });
    Some(pieces.len() - 1)
}

/// A speed cap shared by every connection of one download.
struct Limiter {
    bps: f64,
    at: Mutex<(Instant, f64)>,
}

impl Limiter {
    async fn wait(&self, n: usize) {
        let delay = {
            let mut g = self.at.lock().unwrap();
            let (t0, sent) = &mut *g;
            // A fresh window every few seconds, so a pause doesn't bank credit
            // that then comes out as a burst at full speed.
            if t0.elapsed() > Duration::from_secs(3) {
                *t0 = Instant::now();
                *sent = 0.0;
            }
            *sent += n as f64;
            let due = *sent / self.bps;
            (due - t0.elapsed().as_secs_f64()).max(0.0)
        };
        if delay > 0.0 {
            tokio::time::sleep(Duration::from_secs_f64(delay)).await;
        }
    }
}

enum Pull {
    /// Try again, after a pause.
    Retry(String),
    /// The server wants fewer connections.
    Crowded(String),
    /// Nothing to retry: the link is dead or the disk is full.
    Fatal(String),
}

struct Ctx {
    url: String,
    referer: Option<String>,
    part: PathBuf,
    ranges: bool,
    size: Option<u64>,
    pieces: Mutex<Vec<Piece>>,
    stop: Arc<AtomicBool>,
    fatal: Mutex<Option<String>>,
    limiter: Option<Limiter>,
    /// Connections actually receiving right now — what the row shows.
    live: AtomicUsize,
    /// Connections still alive at all, receiving or waiting to retry.
    workers: AtomicUsize,
}

impl Ctx {
    fn stopped(&self) -> bool {
        self.stop.load(Ordering::Relaxed) || self.fatal.lock().unwrap().is_some()
    }

    fn fail(&self, msg: String) {
        let mut f = self.fatal.lock().unwrap();
        if f.is_none() {
            *f = Some(msg);
        }
    }

    fn release(&self, i: usize) {
        self.pieces.lock().unwrap()[i].busy = false;
    }

    fn tally(&self) -> (u64, Vec<Seg>) {
        let p = self.pieces.lock().unwrap();
        let segs: Vec<Seg> = p.iter().map(|x| x.seg).collect();
        (segs.iter().map(|s| s.pos - s.start).sum(), segs)
    }

    fn complete(&self) -> bool {
        self.pieces.lock().unwrap().iter().all(|p| p.seg.pos >= p.seg.end)
    }

    async fn pull(&self, file: &mut File, i: usize) -> Result<u64, Pull> {
        let (pos, end) = {
            let mut p = self.pieces.lock().unwrap();
            // Without ranges a dropped connection can only start over.
            if !self.ranges && p[i].seg.pos > 0 {
                p[i].seg.pos = p[i].seg.start;
                if self.size.is_none() {
                    let _ = file.set_len(0);
                }
            }
            (p[i].seg.pos, p[i].seg.end)
        };
        let mut rq = request(&self.url, self.referer.as_deref());
        if self.ranges {
            rq = rq.header(header::RANGE, format!("bytes={pos}-{}", end - 1));
        }
        // Refused or silent at connect time is also "fewer of you, please":
        // the extra connections step aside and only one keeps trying, instead
        // of every one of them knocking on a server that is turning us away.
        let resp = rq.send().await.map_err(|e| {
            if e.is_connect() || e.is_timeout() {
                Pull::Crowded(net_err(e))
            } else {
                Pull::Retry(net_err(e))
            }
        })?;
        let st = resp.status();
        match st {
            StatusCode::TOO_MANY_REQUESTS | StatusCode::SERVICE_UNAVAILABLE => {
                return Err(Pull::Crowded(status_err(st).unwrap_or_default()))
            }
            StatusCode::OK if self.ranges => {
                return Err(Pull::Fatal(
                    "Сервер перестал отдавать файл кусками — удали загрузку и начни заново.".into(),
                ))
            }
            s if s.is_server_error() => return Err(Pull::Retry(status_err(s).unwrap_or_default())),
            s if !s.is_success() => return Err(Pull::Fatal(status_err(s).unwrap_or_default())),
            _ => {}
        }
        file.seek(SeekFrom::Start(pos))
            .map_err(|e| Pull::Fatal(format!("Не записать на диск: {e}")))?;

        self.live.fetch_add(1, Ordering::Relaxed);
        let _live = Dec(&self.live);
        let mut stream = resp.bytes_stream();
        let mut got = 0u64;
        let mut quiet = Duration::ZERO;
        loop {
            // Woken every second even when nothing arrives, so a pause is
            // noticed on a stalled connection too.
            let next = tokio::time::timeout(Duration::from_secs(1), stream.next()).await;
            if self.stopped() {
                return Ok(got);
            }
            let chunk = match next {
                Err(_) => {
                    quiet += Duration::from_secs(1);
                    if quiet >= STALL {
                        return Err(Pull::Retry("Сервер замолчал.".into()));
                    }
                    continue;
                }
                Ok(None) => return Ok(got),
                // Something arrived before the drop: the caller just asks for
                // the rest, without counting it as a failure. Without ranges
                // there is no "the rest", and of an unknown length a cut-off
                // stream would pass for the whole file.
                Ok(Some(Err(_))) if got > 0 && self.ranges => return Ok(got),
                Ok(Some(Err(e))) => return Err(Pull::Retry(net_err(e))),
                Ok(Some(Ok(c))) => c,
            };
            quiet = Duration::ZERO;
            // Written under the lock: another connection may halve this piece
            // at any moment, and the end it was given must not be overrun.
            let (take, done) = {
                let mut p = self.pieces.lock().unwrap();
                let seg = &mut p[i].seg;
                let take = (chunk.len() as u64).min(seg.end.saturating_sub(seg.pos)) as usize;
                if let Err(e) = file.write_all(&chunk[..take]) {
                    return Err(Pull::Fatal(format!("Не записать на диск: {e}")));
                }
                seg.pos += take as u64;
                (take, seg.pos >= seg.end)
            };
            got += take as u64;
            if done {
                return Ok(got);
            }
            if let Some(l) = &self.limiter {
                l.wait(take).await;
            }
        }
    }
}

struct Dec<'a>(&'a AtomicUsize);
impl Drop for Dec<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}

async fn worker(ctx: Arc<Ctx>) {
    let _alive = Dec(&ctx.workers);
    let mut file = match OpenOptions::new().write(true).open(&ctx.part) {
        Ok(f) => f,
        Err(e) => return ctx.fail(format!("Не открыть файл: {e}")),
    };
    let Some(mut i) = claim(&mut ctx.pieces.lock().unwrap(), ctx.ranges) else { return };
    let mut fails = 0u32;
    loop {
        if ctx.stopped() {
            break;
        }
        let finished = {
            let p = ctx.pieces.lock().unwrap();
            p[i].seg.pos >= p[i].seg.end
        };
        if finished {
            let mut p = ctx.pieces.lock().unwrap();
            p[i].busy = false;
            match claim(&mut p, ctx.ranges) {
                Some(j) => {
                    i = j;
                    continue;
                }
                None => return,
            }
        }
        let err = match ctx.pull(&mut file, i).await {
            Ok(got) => {
                if ctx.size.is_none() && !ctx.stopped() {
                    // Unknown length: whatever arrived before the server
                    // closed the stream is the file.
                    let mut p = ctx.pieces.lock().unwrap();
                    p[i].seg.end = p[i].seg.pos;
                }
                if got > 0 {
                    fails = 0;
                    continue;
                }
                "Сервер закрыл соединение, ничего не прислав.".to_string()
            }
            Err(Pull::Fatal(m)) => {
                ctx.fail(m);
                break;
            }
            // Other connections carry on and will pick this piece up; one
            // fewer is better than the whole download failing.
            Err(Pull::Crowded(_)) if ctx.workers.load(Ordering::Relaxed) > 1 => break,
            Err(Pull::Crowded(m) | Pull::Retry(m)) => m,
        };
        fails += 1;
        if fails > RETRIES {
            ctx.fail(err);
            break;
        }
        // 1, 2, 4, 8, 16 s — checked every second so a pause isn't held up.
        let wait = 1u64 << (fails - 1).min(4);
        for _ in 0..wait {
            if ctx.stopped() {
                break;
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }
    ctx.release(i);
}

// ---- jobs ----

#[derive(Debug, Clone, Deserialize)]
pub struct FileRequest {
    pub id: u64,
    pub url: String,
    pub dest_dir: String,
    pub name: String,
    pub threads: Option<usize>,
    /// Bytes per second, or None for no cap.
    pub limit_bps: Option<u64>,
    pub referer: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Started {
    /// The name actually used — "file (1).zip" when "file.zip" was taken.
    pub name: String,
    pub resumed: bool,
    pub ranges: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileProgress {
    pub id: u64,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub speed: Option<f64>,
    pub eta: Option<u64>,
    pub stage: String,
    pub conns: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileDone {
    pub id: u64,
    pub ok: bool,
    pub path: Option<String>,
    pub error: Option<String>,
    /// Stopped on request, with everything kept for later.
    pub paused: bool,
}

pub enum Event {
    Progress(FileProgress),
    Done(FileDone),
}

/// Pause switches for the downloads in flight.
#[derive(Default)]
pub struct FileJobs(Mutex<HashMap<u64, Arc<AtomicBool>>>);

impl FileJobs {
    pub fn pause(&self, id: u64) {
        if let Some(f) = self.0.lock().unwrap().get(&id) {
            f.store(true, Ordering::Relaxed);
        }
    }
}

/// Which name to use, and whether there is a half-done download of this very
/// link to continue. A name taken by a finished file or by somebody else's
/// download moves on to "name (1)".
fn pick(dir: &Path, name: &str, url: &str) -> (String, Option<Saved>) {
    for n in 0..1000 {
        let cand = if n == 0 { name.to_string() } else { numbered(name, n) };
        let part = part_path(dir, &cand);
        let state = state_path(dir, &cand);
        if part.is_file() {
            if let Some(s) = load(&state) {
                if s.url == url {
                    return (cand, Some(s));
                }
            }
            continue;
        }
        if !dir.join(&cand).exists() {
            return (cand, None);
        }
    }
    (format!("{}-{}", name, std::process::id()), None)
}

/// Can what's on disk be continued against what the server says now?
fn still_valid(s: &Saved, info: &FileInfo, v: &Validators) -> bool {
    let same = |a: &Option<String>, b: &Option<String>| match (a, b) {
        (Some(a), Some(b)) => a == b,
        _ => true,
    };
    s.ranges
        && info.ranges
        && s.size == info.size
        && same(&s.etag, &v.etag)
        && same(&s.last_modified, &v.last_modified)
}

/// Tell macOS the file came from the internet, as Safari does, so Gatekeeper
/// checks a downloaded program before its first launch instead of waving it
/// through because a downloader forgot to say where it came from.
fn quarantine(path: &Path) {
    #[cfg(target_os = "macos")]
    {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = std::process::Command::new("xattr")
            .args(["-w", "com.apple.quarantine", &format!("0081;{ts:x};lil download;")])
            .arg(path)
            .status();
    }
    #[cfg(not(target_os = "macos"))]
    let _ = path;
}

pub async fn start(
    jobs: Arc<FileJobs>,
    req: FileRequest,
    emit: Arc<dyn Fn(Event) + Send + Sync>,
) -> Result<Started, String> {
    let dir = PathBuf::from(&req.dest_dir);
    if !dir.is_dir() {
        return Err(format!("папки нет: {}", dir.display()));
    }
    if !req.url.starts_with("http://") && !req.url.starts_with("https://") {
        return Err("ссылка пустая или не похожа на ссылку".into());
    }
    let (info, v) = ask_patiently(&req.url, req.referer.as_deref()).await?;
    if info.page {
        return Err("По ссылке страница, а не файл — попробуй вкладку «Видео».".into());
    }
    let wanted = match sanitize(&req.name) {
        n if n.is_empty() => info.name.clone(),
        n => n,
    };
    let (name, saved) = pick(&dir, &wanted, &req.url);
    let part = part_path(&dir, &name);
    let state = state_path(&dir, &name);

    let resume = saved.filter(|s| still_valid(s, &info, &v));
    let resumed = resume.is_some();
    let segs = match &resume {
        Some(s) => s.segs.clone(),
        None => plan(info.size, info.ranges, req.threads.unwrap_or(4)),
    };
    {
        let f = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(!resumed)
            .open(&part)
            .map_err(|e| format!("Не создать файл: {e}"))?;
        // Reserve the length up front so every connection can write at its
        // own offset. Sparse on APFS and NTFS, so this costs no time.
        if let (false, Some(n)) = (resumed, info.size) {
            f.set_len(n).map_err(|e| format!("Не хватает места: {e}"))?;
        }
    }

    let stop = Arc::new(AtomicBool::new(false));
    {
        let mut map = jobs.0.lock().unwrap();
        if map.contains_key(&req.id) {
            return Err("уже качается".into());
        }
        map.insert(req.id, stop.clone());
    }

    let threads = if info.ranges { req.threads.unwrap_or(4).clamp(1, MAX_THREADS) } else { 1 };
    let ctx = Arc::new(Ctx {
        url: req.url.clone(),
        referer: req.referer.clone(),
        part: part.clone(),
        ranges: info.ranges,
        size: info.size,
        pieces: Mutex::new(segs.into_iter().map(|seg| Piece { seg, busy: false }).collect()),
        stop,
        fatal: Mutex::new(None),
        limiter: req
            .limit_bps
            .filter(|&b| b > 0)
            .map(|b| Limiter { bps: b as f64, at: Mutex::new((Instant::now(), 0.0)) }),
        live: AtomicUsize::new(0),
        workers: AtomicUsize::new(threads),
    });
    let saved_of = {
        let (url, size, ranges, etag, lm) =
            (req.url.clone(), info.size, info.ranges, v.etag.clone(), v.last_modified.clone());
        move |segs: Vec<Seg>| Saved {
            url: url.clone(),
            size,
            ranges,
            etag: etag.clone(),
            last_modified: lm.clone(),
            segs,
        }
    };
    // Written before the first byte, so even a crash in the first second
    // leaves something to continue from.
    store(&state, &saved_of(ctx.tally().1));

    for _ in 0..threads {
        tauri::async_runtime::spawn(worker(ctx.clone()));
    }

    let id = req.id;
    let final_dir = dir.clone();
    let started = Started { name: name.clone(), resumed, ranges: info.ranges };
    tauri::async_runtime::spawn(async move {
        let sync = OpenOptions::new().write(true).open(&part).ok();
        let mut last = (Instant::now(), ctx.tally().0);
        let mut speed: Option<f64> = None;
        let mut tick = 0u32;
        while ctx.workers.load(Ordering::Relaxed) > 0 {
            tokio::time::sleep(Duration::from_millis(500)).await;
            tick += 1;
            let (done, segs) = ctx.tally();
            let dt = last.0.elapsed().as_secs_f64();
            let now = (done.saturating_sub(last.1)) as f64 / dt.max(0.001);
            // Smoothed, or the number jumps around with every packet burst.
            speed = Some(match speed {
                Some(s) => s * 0.7 + now * 0.3,
                None => now,
            });
            last = (Instant::now(), done);
            let eta = match (ctx.size, speed) {
                (Some(t), Some(s)) if s > 1.0 => Some((t.saturating_sub(done) as f64 / s) as u64),
                _ => None,
            };
            emit(Event::Progress(FileProgress {
                id,
                downloaded: done,
                total: ctx.size,
                speed,
                eta,
                stage: String::new(),
                conns: ctx.live.load(Ordering::Relaxed),
            }));
            if tick % 2 == 0 {
                // Bytes to disk before the note that says they're there.
                if let Some(f) = &sync {
                    let _ = f.sync_data();
                }
                store(&state, &saved_of(segs));
            }
        }
        if let Some(f) = &sync {
            let _ = f.sync_data();
        }
        drop(sync);
        jobs.0.lock().unwrap().remove(&id);

        let fatal = ctx.fatal.lock().unwrap().clone();
        let paused = fatal.is_none() && ctx.stop.load(Ordering::Relaxed);
        // Complete wins over a pause pressed in the last half-second.
        let out = if fatal.is_none() && ctx.complete() {
            finish(&final_dir, &name, &part, &state).map_err(Some)
        } else {
            store(&state, &saved_of(ctx.tally().1));
            Err(if paused { None } else { Some(fatal.unwrap_or_else(|| "Загрузка остановилась.".into())) })
        };
        emit(Event::Done(match out {
            Ok(path) => FileDone { id, ok: true, path: Some(path), error: None, paused: false },
            Err(error) => FileDone { id, ok: false, path: None, paused: error.is_none(), error },
        }));
    });

    Ok(started)
}

fn finish(dir: &Path, name: &str, part: &Path, state: &Path) -> Result<String, String> {
    // Someone may have put a file under this name while we were downloading.
    let mut target = dir.join(name);
    let mut n = 1;
    while target.exists() {
        target = dir.join(numbered(name, n));
        n += 1;
    }
    std::fs::rename(part, &target).map_err(|e| format!("Не переименовать готовый файл: {e}"))?;
    let _ = std::fs::remove_file(state);
    quarantine(&target);
    Ok(target.to_string_lossy().into_owned())
}

/// Throw away a half-done download: both files, to the Trash.
pub fn discard(dir: &str, name: &str) -> Result<(), String> {
    let dir = Path::new(dir);
    let name = sanitize(name);
    if name.is_empty() {
        return Ok(());
    }
    for p in [part_path(dir, &name), state_path(dir, &name)] {
        if p.is_file() {
            trash::delete(&p).map_err(|e| format!("не убрать в корзину: {e}"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_from_content_disposition() {
        assert_eq!(
            disposition_name(r#"attachment; filename="report.pdf""#).as_deref(),
            Some("report.pdf")
        );
        // The UTF-8 form wins over the ASCII fallback, whichever comes first.
        assert_eq!(
            disposition_name(
                "attachment; filename=\"otchet.pdf\"; filename*=UTF-8''%D0%BE%D1%82%D1%87%D1%91%D1%82.pdf"
            )
            .as_deref(),
            Some("отчёт.pdf")
        );
        assert_eq!(disposition_name("inline").as_deref(), None);
    }

    #[test]
    fn names_are_safe() {
        assert_eq!(sanitize("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(sanitize(".hidden"), "hidden");
        assert_eq!(sanitize("a:b?.zip"), "a_b_.zip");
        let long = format!("{}.zip", "я".repeat(200));
        let cut = sanitize(&long);
        assert!(cut.len() <= 180 && cut.ends_with(".zip"));
    }

    #[test]
    fn percent_decoding() {
        assert_eq!(percent_decode("my%20file.zip"), "my file.zip");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    #[test]
    fn numbering_keeps_the_extension() {
        assert_eq!(numbered("file.zip", 2), "file (2).zip");
        assert_eq!(numbered("README", 1), "README (1)");
    }

    #[test]
    fn plan_respects_min_piece() {
        // 3 MB can't be four 2 MB pieces.
        assert_eq!(plan(Some(3 * 1024 * 1024), true, 4).len(), 1);
        let p = plan(Some(100 * 1024 * 1024), true, 4);
        assert_eq!(p.len(), 4);
        assert_eq!(p.last().unwrap().end, 100 * 1024 * 1024);
        assert!(p.windows(2).all(|w| w[0].end == w[1].start));
        // No ranges: one piece whatever was asked for.
        assert_eq!(plan(Some(100 * 1024 * 1024), false, 8).len(), 1);
    }

    #[test]
    fn a_free_connection_takes_half_of_the_biggest_piece() {
        let mb = 1024 * 1024;
        let mut p = vec![
            Piece { seg: Seg { start: 0, end: 10 * mb, pos: 10 * mb }, busy: false },
            Piece { seg: Seg { start: 10 * mb, end: 30 * mb, pos: 12 * mb }, busy: true },
        ];
        let i = claim(&mut p, true).unwrap();
        assert_eq!(i, 2);
        assert_eq!(p[1].seg.end, 21 * mb);
        assert_eq!(p[2].seg, Seg { start: 21 * mb, end: 30 * mb, pos: 21 * mb });
        // Nothing is ever claimed twice or lost.
        let total: u64 = p.iter().map(|x| x.seg.end - x.seg.start).sum();
        assert_eq!(total, 30 * mb);
    }

    /// Against a real server: `LILDL_URL`, `LILDL_DIR`, `LILDL_SHA` (sha256 of
    /// the file), optional `LILDL_PAUSE_MS` to pause once and then resume.
    #[test]
    #[ignore]
    fn downloads_and_resumes_against_a_server() {
        use sha2::{Digest, Sha256};
        use std::sync::mpsc;

        let url = std::env::var("LILDL_URL").unwrap();
        let dir = std::env::var("LILDL_DIR").unwrap();
        let sha = std::env::var("LILDL_SHA").unwrap();
        let pause_ms: Option<u64> = std::env::var("LILDL_PAUSE_MS").ok().and_then(|v| v.parse().ok());
        let jobs = Arc::new(FileJobs::default());

        let run = |id: u64| {
            let (tx, rx) = mpsc::channel::<FileDone>();
            let tx = Mutex::new(tx);
            let emit: Arc<dyn Fn(Event) + Send + Sync> = Arc::new(move |e| match e {
                Event::Done(d) => {
                    let _ = tx.lock().unwrap().send(d);
                }
                Event::Progress(p) => eprintln!("  {} / {:?} · {} conns", p.downloaded, p.total, p.conns),
            });
            let req = FileRequest {
                id,
                url: url.clone(),
                dest_dir: dir.clone(),
                name: String::new(),
                threads: Some(4),
                limit_bps: None,
                referer: None,
            };
            let started = tauri::async_runtime::block_on(start(jobs.clone(), req, emit)).unwrap();
            eprintln!("started {:?}", started);
            (started, rx)
        };

        let (first, rx) = run(1);
        assert!(!first.resumed);
        if let Some(ms) = pause_ms {
            std::thread::sleep(Duration::from_millis(ms));
            jobs.pause(1);
            let d = rx.recv_timeout(Duration::from_secs(10)).unwrap();
            assert!(d.paused, "{d:?}");
            assert!(part_path(Path::new(&dir), &first.name).is_file());
            let (again, rx) = run(2);
            assert!(again.resumed);
            assert_eq!(again.name, first.name);
            let d = rx.recv_timeout(Duration::from_secs(120)).unwrap();
            assert!(d.ok, "{d:?}");
            check(&d, &sha);
        } else {
            let d = rx.recv_timeout(Duration::from_secs(120)).unwrap();
            assert!(d.ok, "{d:?}");
            check(&d, &sha);
        }

        fn check(d: &FileDone, sha: &str) {
            let path = d.path.clone().unwrap();
            let got = hex::encode(Sha256::digest(std::fs::read(&path).unwrap()));
            assert_eq!(got, sha);
            let dir = Path::new(&path).parent().unwrap();
            let name = Path::new(&path).file_name().unwrap().to_string_lossy();
            assert!(!state_path(dir, &name).exists(), "state file left behind");
            eprintln!("ok: {path}");
        }
    }

    #[test]
    fn small_leftovers_are_not_split() {
        let mut p = vec![Piece { seg: Seg { start: 0, end: 3 * 1024 * 1024, pos: 0 }, busy: true }];
        assert!(claim(&mut p, true).is_none());
    }
}
