/**
 * What a preset would actually download, in one line.
 *
 * The names in the menu say what a preset is *for*; this says what it will
 * *get* — resolution, codecs, rough size. Both matter: "Лучшее качество" is
 * useless if you can't see that it means a 4K VP9 file you can't open, and
 * "Откроется везде" is unconvincing until you see it settle at 1080p H.264.
 *
 * It is an estimate. The real choice is yt-dlp's and depends on what the site
 * offers at that moment, so this mirrors the same rules rather than asking —
 * a round-trip per hover would be unusable.
 */

import type { FormatInfo } from "./api";
import { bytes } from "./format";
import type { Preset } from "./settings";

const isVideo = (f: FormatInfo) => !!f.vcodec;
const isAudio = (f: FormatInfo) => !!f.acodec && !f.vcodec;

/** "avc1.640028" → "H.264", "av01.0.08M.08" → "AV1". */
function codecName(c: string | null): string {
  if (!c) return "—";
  const v = c.toLowerCase();
  if (v.startsWith("avc1") || v.startsWith("h264")) return "H.264";
  if (v.startsWith("vp9") || v.startsWith("vp09")) return "VP9";
  if (v.startsWith("av01")) return "AV1";
  if (v.startsWith("mp4a")) return "AAC";
  if (v.startsWith("opus")) return "Opus";
  if (v.startsWith("vp8")) return "VP8";
  return c.split(".")[0];
}

function best<T>(items: T[], score: (x: T) => number): T | undefined {
  return items.reduce<T | undefined>(
    (a, b) => (a === undefined || score(b) > score(a) ? b : a),
    undefined,
  );
}

const rank = (f: FormatInfo) => (f.height ?? 0) * 1e6 + (f.filesize ?? 0) / 1e6;

export function predict(
  formats: FormatInfo[],
  preset: Preset,
  maxHeight?: number,
): string | null {
  if (!formats.length) return null;

  const audio = best(formats.filter(isAudio), (f) => f.filesize ?? 0);
  const videos = formats.filter(isVideo);

  const cap = (h: number) => videos.filter((f) => (f.height ?? 0) <= h);

  let video: FormatInfo | undefined;
  switch (preset) {
    case "audio": {
      if (!audio) return null;
      return `${audio.ext} · ${codecName(audio.acodec)} · ~${bytes(audio.filesize)}`;
    }
    case "compatible":
      // Mirrors the Rust selector: H.264 up to 1080p, and if the site has no
      // H.264 at all, whatever fits under the cap.
      video =
        best(
          cap(1080).filter((f) => codecName(f.vcodec) === "H.264"),
          rank,
        ) ?? best(cap(1080), rank);
      break;
    case "compact":
      video = best(cap(720), rank);
      break;
    default:
      video = best(maxHeight ? cap(maxHeight) : videos, rank);
  }

  if (!video) return null;

  const size = (video.filesize ?? 0) + (audio?.filesize ?? 0);
  const res = video.height ? `${video.height}p${video.fps && video.fps > 31 ? Math.round(video.fps) : ""}` : video.ext;
  const codecs = audio
    ? `${codecName(video.vcodec)} + ${codecName(audio.acodec)}`
    : codecName(video.vcodec);

  return size > 0 ? `${res} · ${codecs} · ~${bytes(size)}` : `${res} · ${codecs}`;
}
