import { invoke } from "@tauri-apps/api/core";
import { hasTauri } from "./tauri";

/** What the backend tells us about the latest GitHub release. */
export interface UpdateInfo {
  /** The latest release is strictly newer than the running build. */
  available: boolean;
  current: string;
  latest: string;
  /** Release notes (may be empty). */
  notes: string;
  /** Release page — the download fallback. */
  url: string;
  /** Direct macOS download (.dmg when published), else null. */
  asset: string | null;
}

/**
 * Ask GitHub (via the Rust side) whether a newer release exists. Throws on a
 * network / API error so the caller can tell "up to date" from "couldn't
 * check"; the silent startup check just swallows that.
 */
export async function checkUpdate(): Promise<UpdateInfo> {
  if (!hasTauri()) throw new Error("no-tauri");
  return await invoke<UpdateInfo>("check_update");
}

// ---------------------------------------------------------------------------
// "Check on launch" preference
//
// The startup check is the only connection the app makes on its own, so it gets
// an off switch — and the README promises one. Off means the app opens no
// network connection unless the user asks it to.
// ---------------------------------------------------------------------------

const AUTO_KEY = "lildownload.update.auto";

export function autoCheckEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== "off";
  } catch {
    return true; // storage unavailable — keep the default
  }
}

export function setAutoCheck(on: boolean): void {
  try {
    localStorage.setItem(AUTO_KEY, on ? "on" : "off");
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * Only ever hand the opener a real GitHub URL. `url` and `asset` come back from
 * the GitHub API, i.e. from outside the app, and `openUrl` passes whatever it
 * gets to the OS handler — so the shape is checked before it leaves here.
 */
export function safeReleaseUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const okHost =
      u.hostname === "github.com" ||
      u.hostname === "api.github.com" ||
      u.hostname.endsWith(".githubusercontent.com");
    return u.protocol === "https:" && okHost ? u.href : null;
  } catch {
    return null;
  }
}
