/**
 * A poster frame we can show before anyone has been asked.
 *
 * YouTube's thumbnails live at a fixed address derived from the video id, which
 * we already have the moment the link is parsed — no extractor, no network call
 * of our own, no waiting. That turns the several seconds spent probing from a
 * blank rectangle into the actual video.
 *
 * Everywhere else the poster genuinely requires asking the site, so this
 * returns null and the card shows a placeholder instead of inventing one.
 */
export function guessThumb(url: string): string | null {
  const id = youtubeId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return clean(u.pathname.slice(1));
    if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "music.youtube.com") {
      return null;
    }
    if (u.pathname === "/watch") return clean(u.searchParams.get("v"));
    // /shorts/<id>, /embed/<id>, /live/<id>
    const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/]+)/);
    return m ? clean(m[1]) : null;
  } catch {
    return null;
  }
}

/** Ids are exactly 11 characters; anything else is a path we misread. */
function clean(v: string | null): string | null {
  return v && /^[\w-]{11}$/.test(v) ? v : null;
}
