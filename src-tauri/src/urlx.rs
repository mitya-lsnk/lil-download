//! Making sense of a pasted link before anything is downloaded.
//!
//! Three jobs, all of them things the user asked for by name:
//!
//! 1. **Cut the playlist off.** Copying a video out of a playlist and getting
//!    the whole playlist is yt-dlp's most annoying default. `--no-playlist` is
//!    what actually stops it, but we also strip the playlist tail from the URL
//!    itself so the card and the history show an honest link to one video.
//! 2. **Keep the timecode.** `?t=142` is *not* junk — it goes into the trim
//!    field (left switched off, see PLAN §7), because a link copied at 2:22 was
//!    copied there on purpose.
//! 3. **Name the source.** Folder rules hang off a domain, so `x.com` and
//!    `twitter.com` have to collapse into one key or the rules quietly split in
//!    two and half the files land in the wrong folder.

use serde::Serialize;
use url::Url;

/// Query parameters that mean "this video belongs to a playlist". Dropping them
/// is what turns a playlist link back into a plain video link.
const PLAYLIST_PARAMS: &[&str] = &["list", "index", "start_radio", "pp"];

/// Share/analytics noise. Not harmful, but it makes a stored link unreadable and
/// breaks "have I downloaded this already?" comparisons.
const TRACKING_PARAMS: &[&str] = &["si", "feature", "pp_source", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];

/// Parameters carrying a start offset, in priority order.
const TIME_PARAMS: &[&str] = &["t", "start"];

/// Host synonyms → the one key folder rules are stored under.
///
/// Kept as an explicit list rather than guessed from the domain: `x.com` and
/// `twitter.com` share nothing textually, and guessing is how you end up with
/// five near-identical rules.
const HOST_ALIASES: &[(&str, &str)] = &[
    ("x.com", "twitter.com"),
    ("vxtwitter.com", "twitter.com"),
    ("fxtwitter.com", "twitter.com"),
    ("nitter.net", "twitter.com"),
    ("youtu.be", "youtube.com"),
    ("music.youtube.com", "youtube.com"),
    ("redd.it", "reddit.com"),
    ("vk.ru", "vk.com"),
    ("vkvideo.ru", "vk.com"),
    ("player.vimeo.com", "vimeo.com"),
    ("vt.tiktok.com", "tiktok.com"),
    ("vm.tiktok.com", "tiktok.com"),
    ("ddinstagram.com", "instagram.com"),
    ("clips.twitch.tv", "twitch.tv"),
];

/// Subdomains that only ever mean "same site, different client".
const STRIP_PREFIXES: &[&str] = &["www.", "m.", "mobile.", "old."];

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ParsedLink {
    /// The link we actually hand to yt-dlp: playlist tail and tracking gone.
    pub clean: String,
    /// Exactly what was pasted, kept so the user can see we didn't mangle it.
    pub original: String,
    /// Folder-rule key: lowercase, no `www.`, synonyms collapsed.
    pub source: String,
    /// Playlist id that was cut off, when there was one.
    pub playlist_id: Option<String>,
    /// Start offset in seconds, when the link carried a timecode.
    pub start_seconds: Option<u64>,
}

/// Turn `1h2m3s`, `2m22s`, `90s` or plain `142` into seconds.
///
/// YouTube writes all of these depending on where you copied from, and a share
/// link from the mobile app uses the suffixed form.
fn parse_timecode(raw: &str) -> Option<u64> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if let Ok(n) = raw.parse::<u64>() {
        return Some(n);
    }
    let mut total: u64 = 0;
    let mut num = String::new();
    let mut saw_unit = false;
    for ch in raw.chars() {
        if ch.is_ascii_digit() {
            num.push(ch);
            continue;
        }
        let n: u64 = num.parse().ok()?;
        num.clear();
        let mult = match ch.to_ascii_lowercase() {
            'h' => 3600,
            'm' => 60,
            's' => 1,
            _ => return None,
        };
        total += n * mult;
        saw_unit = true;
    }
    // A trailing number with no unit ("1m30") reads as seconds.
    if !num.is_empty() {
        total += num.parse::<u64>().ok()?;
    }
    if saw_unit {
        Some(total)
    } else {
        None
    }
}

/// Collapse a host to the key folder rules are keyed by.
pub fn source_key(host: &str) -> String {
    let mut h = host.trim().to_ascii_lowercase();
    // Strip client-flavour subdomains, but only when something is left over —
    // "m.com" is a real domain, "m." on its own is not a prefix to eat.
    loop {
        let before = h.clone();
        for p in STRIP_PREFIXES {
            if let Some(rest) = h.strip_prefix(p) {
                if rest.contains('.') {
                    h = rest.to_string();
                }
            }
        }
        if h == before {
            break;
        }
    }
    for (alias, canonical) in HOST_ALIASES {
        if h == *alias {
            return (*canonical).to_string();
        }
    }
    h
}

/// Parse a pasted link. `None` when it isn't a URL we can work with at all.
pub fn parse_link(input: &str) -> Option<ParsedLink> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }
    // People paste "youtube.com/watch?v=…" without a scheme all the time.
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let mut url = Url::parse(&with_scheme).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let host = url.host_str()?.to_string();

    let mut playlist_id = None;
    let mut start_seconds = None;
    let mut kept: Vec<(String, String)> = Vec::new();

    for (k, v) in url.query_pairs() {
        let (k, v) = (k.into_owned(), v.into_owned());
        if PLAYLIST_PARAMS.contains(&k.as_str()) {
            // "list" is the only one that names the playlist; index/pp are
            // companions and just get dropped.
            if k == "list" && !v.is_empty() {
                playlist_id = Some(v);
            }
            continue;
        }
        if TIME_PARAMS.contains(&k.as_str()) {
            if start_seconds.is_none() {
                start_seconds = parse_timecode(&v);
            }
            continue;
        }
        if TRACKING_PARAMS.contains(&k.as_str()) {
            continue;
        }
        kept.push((k, v));
    }

    // Rebuild the query from what survived, or drop it entirely.
    if kept.is_empty() {
        url.set_query(None);
    } else {
        let mut qs = url.query_pairs_mut();
        qs.clear();
        for (k, v) in &kept {
            qs.append_pair(k, v);
        }
        drop(qs);
    }

    // youtu.be/<id>#t=30 and youtube.com/watch?v=…#t=30 both happen.
    if start_seconds.is_none() {
        if let Some(frag) = url.fragment() {
            let f = frag.strip_prefix("t=").unwrap_or(frag);
            start_seconds = parse_timecode(f);
        }
    }
    url.set_fragment(None);

    Some(ParsedLink {
        clean: url.to_string(),
        original: trimmed.to_string(),
        source: source_key(&host),
        playlist_id,
        start_seconds,
    })
}

/// Does this link point at a playlist/channel *as such*, rather than at one
/// video that happens to sit in one? Those are the only links where offering
/// "download all" makes sense on its own.
pub fn is_collection_url(input: &str) -> bool {
    let Some(u) = Url::parse(input).ok() else {
        return false;
    };
    let path = u.path().to_ascii_lowercase();
    let has_v = u.query_pairs().any(|(k, _)| k == "v");
    if path.starts_with("/playlist") && !has_v {
        return true;
    }
    path.contains("/channel/") || path.contains("/@") || path.ends_with("/videos")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playlist_tail_is_cut_but_remembered() {
        let p = parse_link("https://www.youtube.com/watch?v=abc123&list=PL999&index=4").unwrap();
        assert_eq!(p.clean, "https://www.youtube.com/watch?v=abc123");
        assert_eq!(p.playlist_id.as_deref(), Some("PL999"));
        assert_eq!(p.source, "youtube.com");
    }

    #[test]
    fn timecode_survives_as_seconds_in_every_shape() {
        for (link, want) in [
            ("https://youtu.be/abc?t=142", 142),
            ("https://youtu.be/abc?t=2m22s", 142),
            ("https://youtu.be/abc?t=1h1m1s", 3661),
            ("https://www.youtube.com/watch?v=abc&start=90", 90),
            ("https://youtu.be/abc#t=30", 30),
        ] {
            let p = parse_link(link).unwrap();
            assert_eq!(p.start_seconds, Some(want), "{link}");
            assert!(!p.clean.contains("t="), "timecode left in {}", p.clean);
        }
    }

    #[test]
    fn twitter_and_x_are_one_source() {
        let a = parse_link("https://x.com/user/status/1").unwrap();
        let b = parse_link("https://twitter.com/user/status/1").unwrap();
        let c = parse_link("https://mobile.twitter.com/user/status/1").unwrap();
        assert_eq!(a.source, "twitter.com");
        assert_eq!(a.source, b.source);
        assert_eq!(b.source, c.source);
    }

    #[test]
    fn youtube_short_and_long_share_a_rule() {
        assert_eq!(parse_link("https://youtu.be/abc").unwrap().source, "youtube.com");
        assert_eq!(parse_link("https://m.youtube.com/watch?v=abc").unwrap().source, "youtube.com");
        assert_eq!(
            parse_link("https://music.youtube.com/watch?v=abc").unwrap().source,
            "youtube.com"
        );
    }

    #[test]
    fn tracking_noise_is_dropped_but_real_params_stay() {
        let p = parse_link("https://youtube.com/watch?v=abc&si=XYZ&utm_source=tg").unwrap();
        assert!(p.clean.contains("v=abc"));
        assert!(!p.clean.contains("si="));
        assert!(!p.clean.contains("utm_"));
    }

    #[test]
    fn scheme_is_optional_and_original_is_preserved() {
        let p = parse_link("youtube.com/watch?v=abc").unwrap();
        assert!(p.clean.starts_with("https://"));
        assert_eq!(p.original, "youtube.com/watch?v=abc");
    }

    #[test]
    fn a_bare_playlist_link_is_a_collection_but_a_video_in_one_is_not() {
        assert!(is_collection_url("https://www.youtube.com/playlist?list=PL999"));
        assert!(is_collection_url("https://www.youtube.com/@channel"));
        assert!(!is_collection_url("https://www.youtube.com/watch?v=abc&list=PL999"));
    }

    #[test]
    fn junk_is_rejected_rather_than_guessed_at() {
        assert!(parse_link("").is_none());
        assert!(parse_link("   ").is_none());
        assert!(parse_link("file:///etc/passwd").is_none());
    }

    #[test]
    fn a_short_host_is_not_eaten_by_prefix_stripping() {
        assert_eq!(source_key("m.com"), "m.com");
        assert_eq!(source_key("WWW.Example.COM"), "example.com");
    }
}
