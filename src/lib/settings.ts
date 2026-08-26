/**
 * Everything the app remembers between launches, minus skin/mode/language —
 * those live in their own providers, exactly as in `lil view`.
 *
 * The interesting part is `rules`: a per-source **mask** (PLAN §4). A rule is
 * keyed by the normalised source (`twitter.com`, never `x.com`) and carries not
 * just a folder but the preset and filename template used there last time. The
 * point is that pasting a tweet restores the whole setup you used for tweets,
 * so nothing has to be re-picked when moving between projects.
 */

import { useCallback, useEffect, useState } from "react";

export const BUILTIN_PRESETS = ["max", "compatible", "audio", "compact"] as const;
export type Builtin = (typeof BUILTIN_PRESETS)[number];

/** A built-in name, or the id of one the user assembled themselves. */
export type Preset = string;

export type Channel = "stable" | "nightly";

/** How a speed cap is spelled in the box. */
export type RateUnit = "K" | "M" | "Mbit";

/**
 * The cap in yt-dlp's own spelling, or null for no cap.
 *
 * Megabits are the odd one out and the reason this is a function rather than a
 * template string: connections are sold in megabits and files are measured in
 * megabytes, so "10" typed under Мбит must reach yt-dlp as 1250K. Getting that
 * wrong by a factor of eight is the kind of bug nobody reports — the download
 * is simply slower, or the cap does nothing.
 */
export function rateArg(n: number | null, unit: RateUnit): string | null {
  if (!n || n <= 0) return null;
  // Megabits are decimal (10⁶ bits) and yt-dlp's K is binary (1024 bytes), so
  // both conversions have to happen: n·10⁶/8 bytes, then /1024. Using a round
  // 125 K per megabit would quietly cap 2.4% high.
  if (unit === "Mbit") return `${Math.max(1, Math.round((n * 1_000_000) / 8 / 1024))}K`;
  return `${n}${unit}`;
}

/** The same number as bytes per second, for saying it out loud. */
export function ratePerSecond(n: number | null, unit: RateUnit): number | null {
  if (!n || n <= 0) return null;
  if (unit === "K") return n * 1024;
  if (unit === "M") return n * 1024 * 1024;
  return (n * 1_000_000) / 8;
}

/**
 * A preset someone built in Settings.
 *
 * Deliberately the same five knobs the card already exposes rather than a free
 * yt-dlp selector: a saved preset is a thing you stop thinking about, and a
 * hand-written `bv*[height<=?]+ba` that silently matches nothing is the exact
 * opposite of that. `extraArgs` is the escape hatch for everything else.
 */
export interface CustomPreset {
  id: string;
  name: string;
  /** Video, or strip the picture out entirely. */
  kind: "video" | "audio";
  /** Cap on picture height, or null for whatever the site has. */
  maxHeight: number | null;
  container: string;
  vcodec: string;
  acodec: string;
  audioFormat: string;
  extraArgs: string;
}

export function isBuiltin(id: string): id is Builtin {
  return (BUILTIN_PRESETS as readonly string[]).includes(id);
}

export function newPreset(name: string): CustomPreset {
  return {
    id: `u${Date.now().toString(36)}`,
    name,
    kind: "video",
    maxHeight: null,
    container: "mp4",
    vcodec: "auto",
    acodec: "auto",
    audioFormat: "m4a",
    extraArgs: "",
  };
}

export interface Mask {
  dir?: string;
  preset?: Preset;
  template?: string;
}

export interface Prefs {
  /** Falls back to the OS Downloads folder when unset. */
  defaultDir: string | null;
  /** The folder used last, whatever the source. */
  lastDir: string | null;
  preset: Preset;
  template: string;
  /** Normalised source → remembered mask. */
  rules: Record<string, Mask>;
  ytdlpPath: string | null;
  ffmpegPath: string | null;
  /** Raw yt-dlp flags, appended after everything the preset chose. */
  extraArgs: string;
  /** Browser to lift cookies from, or null for none. */
  cookies: string | null;
  /** Container to end up in, or "auto" to keep the preset's choice. */
  container: string;
  audioFormat: string;
  recode: boolean;
  /** Presets built in Settings, offered alongside the four built-in ones. */
  presets: CustomPreset[];
  /** Which build stream each tool installs from. */
  ytdlpChannel: Channel;
  ffmpegChannel: Channel;
  /** Speed cap, in `limitUnit` per second. Null means no cap. */
  limitRate: number | null;
  limitUnit: RateUnit;
  /** How the queue is laid out — remembered, like everything else here. */
  queueView: "list" | "bento";
}

export const DEFAULTS: Prefs = {
  defaultDir: null,
  lastDir: null,
  // PLAN §3, decided 25.08: the default is the best available, not the safest.
  preset: "max",
  // Decided 26.08: title, an em dash, "by", the channel, then the extension.
  // A folder of these sorts by video and still says who made each one, which a
  // bare title does not once two channels cover the same subject.
  template: "%(title)s — by %(uploader)s.%(ext)s",
  rules: {},
  ytdlpPath: null,
  ffmpegPath: null,
  extraArgs: "",
  cookies: null,
  container: "auto",
  audioFormat: "m4a",
  recode: false,
  presets: [],
  ytdlpChannel: "stable",
  ffmpegChannel: "stable",
  limitRate: null,
  limitUnit: "M",
  queueView: "list",
};

const KEY = "lildownload.prefs";

export function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    // Merge rather than replace: a version that adds a preference must not wipe
    // the ones already stored.
    const merged = { ...DEFAULTS, ...parsed };
    if (!merged.rules || typeof merged.rules !== "object") merged.rules = {};
    if (!Array.isArray(merged.presets)) merged.presets = [];
    // Anyone still on the old bare-title default gets the new one. Only that
    // exact string — a template someone actually edited is theirs.
    if (merged.template === "%(title)s.%(ext)s") merged.template = DEFAULTS.template;
    return merged;
  } catch {
    return DEFAULTS;
  }
}

/**
 * Which folder a link should go to, and why.
 *
 * Order is source rule → last used → default → OS Downloads (PLAN §4). The
 * reason travels with the answer so the card can say "правило x.com" out loud —
 * a file landing somewhere unexpected without explanation is the whole failure
 * mode this feature exists to avoid.
 */
export function resolveDest(
  prefs: Prefs,
  source: string | null,
  osDownloads: string | null,
): { dir: string | null; reason: "rule" | "last" | "default" | "os" } {
  const rule = source ? prefs.rules[source] : undefined;
  if (rule?.dir) return { dir: rule.dir, reason: "rule" };
  if (prefs.lastDir) return { dir: prefs.lastDir, reason: "last" };
  if (prefs.defaultDir) return { dir: prefs.defaultDir, reason: "default" };
  return { dir: osDownloads, reason: "os" };
}

/**
 * The download settings a preset id stands for.
 *
 * Built-in names are handled in Rust, so they resolve to nothing here and the
 * request carries the name through untouched. A custom preset is unpacked into
 * the same fields the card sets by hand — there is no second code path in the
 * downloader, and so no second way for it to be wrong.
 */
export function resolvePreset(prefs: Prefs, id: Preset): CustomPreset | undefined {
  return isBuiltin(id) ? undefined : prefs.presets.find((p) => p.id === id);
}

/** The preset/template a source was last used with, when it has a rule. */
export function resolveMask(prefs: Prefs, source: string | null): Mask {
  return (source && prefs.rules[source]) || {};
}

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      // Storage can be unavailable; the session still works, it just forgets.
    }
  }, [prefs]);

  const set = useCallback(<K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    setPrefs((p) => ({ ...p, [k]: v }));
  }, []);

  /** Write (or extend) the mask for one source. */
  const setRule = useCallback((source: string, mask: Mask) => {
    setPrefs((p) => ({
      ...p,
      rules: { ...p.rules, [source]: { ...p.rules[source], ...mask } },
    }));
  }, []);

  const clearRule = useCallback((source: string) => {
    setPrefs((p) => {
      const rules = { ...p.rules };
      delete rules[source];
      return { ...p, rules };
    });
  }, []);

  return { prefs, set, setRule, clearRule };
}
