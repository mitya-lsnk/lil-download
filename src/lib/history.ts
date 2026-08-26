/**
 * The queue, kept across restarts.
 *
 * Two things need it. Re-downloading with different settings is only useful if
 * the row is still there tomorrow — and the case that prompted it, granting Full
 * Disk Access, *requires* a restart, so anything held only in memory is gone by
 * the time the user comes back to retry.
 */

import type { Job } from "../components/Queue";

const KEY = "lildownload.history";
const LIMIT = 60;

export function readHistory(): Job[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Job[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((j) => ({
      ...j,
      // A job that was mid-flight when the app closed did not survive it. Saying
      // "running" would show a progress bar that can never move again.
      state: j.state === "running" ? "cancelled" : j.state,
      speed: null,
      eta: null,
      status: "",
    }));
  } catch {
    return [];
  }
}

export function writeHistory(jobs: Job[]): void {
  try {
    // Thumbnails are remote URLs, not data, so rows stay small; the cap is
    // about keeping the list readable rather than about storage.
    localStorage.setItem(KEY, JSON.stringify(jobs.slice(0, LIMIT)));
  } catch {
    // Storage can be unavailable; the session still works, it just forgets.
  }
}

const DRAFT_KEY = "lildownload.draft";

/** The half-finished link in the input box. */
export function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(v: string): void {
  try {
    if (v.trim()) localStorage.setItem(DRAFT_KEY, v);
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}
