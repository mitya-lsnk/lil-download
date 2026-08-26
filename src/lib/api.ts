/** Typed wrappers over the Rust commands, plus the shapes they return. */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { call } from "./tauri";
import type { Preset } from "./settings";

export interface ToolStatus {
  tool: "yt-dlp" | "ffmpeg";
  found: boolean;
  path: string | null;
  version: string | null;
  origin: "managed" | "custom" | "system" | null;
  runner: "native" | "python" | null;
  startup_ms: number | null;
}

export interface ParsedLink {
  clean: string;
  original: string;
  source: string;
  playlist_id: string | null;
  start_seconds: number | null;
}

export interface FormatInfo {
  id: string;
  ext: string;
  height: number | null;
  fps: number | null;
  vcodec: string | null;
  acodec: string | null;
  filesize: number | null;
  note: string | null;
}

export interface MediaInfo {
  id: string;
  title: string;
  uploader: string | null;
  duration: number | null;
  thumbnail: string | null;
  webpage_url: string;
  extractor: string | null;
  upload_date: string | null;
  formats: FormatInfo[];
  playlist_count: number | null;
  warns_editors: boolean;
}

export interface UpdateInfo {
  current: string | null;
  latest: string | null;
  stale: boolean;
}

export type CookieVerdict = "ok" | "full_disk" | "keychain" | "not_installed" | "unknown";

export interface CookieStatus {
  browser: string;
  verdict: CookieVerdict;
  path: string | null;
}

export type Channel = "stable" | "nightly";

export interface ToolPaths {
  ytdlp?: string | null;
  ffmpeg?: string | null;
  cookies?: string | null;
}

export const api = {
  toolStatus: (paths: ToolPaths) => call<ToolStatus[]>("tool_status", { paths }),
  installTool: (tool: "ytdlp" | "ffmpeg", channel: Channel = "stable") =>
    call<ToolStatus>("install_tool", { tool, channel }),
  checkYtdlpUpdate: (paths: ToolPaths, channel: Channel = "stable") =>
    call<UpdateInfo>("check_ytdlp_update", { paths, channel }),
  parseLink: (input: string) => call<ParsedLink | null>("parse_link", { input }),
  isCollection: (url: string) => call<boolean>("is_collection", { url }),
  cookieAccess: (browser: string) => call<CookieStatus>("cookie_access", { browser }),
  openPrivacySettings: () => call<void>("open_privacy_settings"),
  probeLink: (url: string, paths: ToolPaths) => call<MediaInfo>("probe_link", { url, paths }),
  playlistSize: (url: string, paths: ToolPaths) =>
    call<number | null>("playlist_size", { url, paths }),
  startDownload: (
    req: {
      id: number;
      url: string;
      dest_dir: string;
      preset: Preset | "custom";
      format_override?: string | null;
      filename_template?: string | null;
      playlist?: boolean;
      extra_args?: string | null;
      cookies?: string | null;
      sponsorblock?: boolean;
      subs?: string;
      trim_start?: string | null;
      trim_end?: string | null;
      container?: string;
      audio_format?: string;
      recode?: boolean;
      max_height?: number | null;
      vcodec?: string;
      acodec?: string;
      embed_thumbnail?: boolean;
      limit_rate?: string | null;
    },
    paths: ToolPaths,
  ) => call<void>("start_download", { req, paths }),
  cancelDownload: (id: number) => call<void>("cancel_download", { id }),
  defaultDownloadDir: () => call<string | null>("default_download_dir"),
  reveal: (path: string) => call<void>("reveal", { path }),
};

// ---- events ----

export interface ProgressEvent {
  id: number;
  downloaded: number;
  total: number | null;
  speed: number | null;
  eta: number | null;
  stage: string;
}

export interface DoneEvent {
  id: number;
  ok: boolean;
  path: string | null;
  error: string | null;
}

export interface InstallEvent {
  tool: string;
  done: number;
  total: number | null;
  stage: "download" | "extract" | "done";
}

export const on = {
  progress: (cb: (e: ProgressEvent) => void): Promise<UnlistenFn> =>
    listen<ProgressEvent>("dl-progress", (e) => cb(e.payload)),
  status: (cb: (id: number, text: string) => void): Promise<UnlistenFn> =>
    listen<[number, string]>("dl-status", (e) => cb(e.payload[0], e.payload[1])),
  done: (cb: (e: DoneEvent) => void): Promise<UnlistenFn> =>
    listen<DoneEvent>("dl-done", (e) => cb(e.payload)),
  install: (cb: (e: InstallEvent) => void): Promise<UnlistenFn> =>
    listen<InstallEvent>("install-progress", (e) => cb(e.payload)),
};
