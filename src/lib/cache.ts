/**
 * Things worth remembering between launches purely so the window can be useful
 * on the first frame.
 *
 * Nothing here is authoritative. Every value is a guess from last time, shown
 * immediately and replaced the moment the real answer arrives — the point is
 * that the app has something honest to draw while it finds out, rather than a
 * spinner where the interface should be.
 */

import type { ToolStatus, UpdateInfo } from "./api";

const TOOLS_KEY = "lildownload.tools";
const UPDATE_KEY = "lildownload.updateCheck";

/** How stale a version check may be before it's worth asking GitHub again. */
const UPDATE_TTL_MS = 6 * 60 * 60 * 1000;

export function readTools(): ToolStatus[] | null {
  try {
    const raw = localStorage.getItem(TOOLS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ToolStatus[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function writeTools(tools: ToolStatus[]): void {
  try {
    localStorage.setItem(TOOLS_KEY, JSON.stringify(tools));
  } catch {
    // Storage can be unavailable; the app just starts on a spinner next time.
  }
}

interface CachedUpdate {
  at: number;
  info: UpdateInfo;
}

/**
 * The last version verdict, if it's recent enough to still mean something.
 *
 * yt-dlp ships every couple of weeks, so asking GitHub on every single launch
 * buys nothing and costs a network round-trip during the busiest second of the
 * app's life.
 */
export function readUpdate(): UpdateInfo | null {
  try {
    const raw = localStorage.getItem(UPDATE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as CachedUpdate;
    if (!c?.info || Date.now() - c.at > UPDATE_TTL_MS) return null;
    return c.info;
  } catch {
    return null;
  }
}

export function writeUpdate(info: UpdateInfo): void {
  try {
    localStorage.setItem(UPDATE_KEY, JSON.stringify({ at: Date.now(), info }));
  } catch {
    // ignore
  }
}

/** Forget the verdict — after an install it is wrong by definition. */
export function forgetUpdate(): void {
  try {
    localStorage.removeItem(UPDATE_KEY);
  } catch {
    // ignore
  }
}
