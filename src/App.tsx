import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { api, on, type FileInfo, type MediaInfo, type ParsedLink, type ToolStatus } from "./lib/api";
import { hasTauri } from "./lib/tauri";
import {
  isBuiltin,
  rateArg,
  ratePerSecond,
  resolveDest,
  resolveMask,
  resolvePreset,
  usePrefs,
  type Preset,
} from "./lib/settings";
import { useLang, useStrings } from "./lib/i18n";
import { useLilMenu } from "./lib/menu";
import { requestUpdateCheck } from "./lib/update";
import { readDraft, readHistory, writeDraft, writeHistory } from "./lib/history";
import { forgetUpdate, readTools, readUpdate, writeTools, writeUpdate } from "./lib/cache";
import { guessThumb } from "./lib/thumb";
import { LanguagePicker } from "./components/LanguagePicker";
import { CookiePicker } from "./components/CookiePicker";
import { FileCard } from "./components/FileCard";
import { Icon } from "./components/Icon";
import { LinkBar } from "./components/LinkBar";
import { MediaCard } from "./components/MediaCard";
import { ModeToggle } from "./components/ModeToggle";
import { PresetPicker } from "./components/PresetPicker";
import { Queue, type Job } from "./components/Queue";
import type { Tab as SettingsTab } from "./components/SettingsScreen";
import { BootScreen, CardSkeleton } from "./components/Skeleton";

// Split out of the first load. Between them these pull in the 80-field filename
// catalogue, the flag catalogue and the preset editor — none of which the main
// screen touches, and all of which were being parsed before the window could
// draw. They arrive from disk in a frame or two when they are actually opened.
const SettingsScreen = lazy(() =>
  import("./components/SettingsScreen").then((m) => ({ default: m.SettingsScreen })),
);
const SetupScreen = lazy(() =>
  import("./components/SetupScreen").then((m) => ({ default: m.SetupScreen })),
);
import { Toast } from "./components/Toast";

export default function App() {
  const s = useStrings();
  const { lang } = useLang();
  const { prefs, set, setRule } = usePrefs();

  // Last launch's answer, shown on the first frame. Locating the tools means
  // running both of them to read their versions; waiting on that behind a
  // splash screen was most of what "медленный запуск" actually was.
  const [tools, setTools] = useState<ToolStatus[] | null>(readTools);
  const [setupDone, setSetupDone] = useState(false);
  // Latches once yt-dlp turns up missing. Without it the setup screen closes
  // itself the instant the install finishes — taking the "✓ обновили до …"
  // confirmation with it, which is precisely when you want to read it.
  const [needSetup, setNeedSetup] = useState(false);
  /** Has a live tool check come back yet, as opposed to the remembered one. */
  const [checked, setChecked] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState<SettingsTab | null>(null);
  // Bumped on every open so a menu click while settings is already up still lands
  // on the requested tab (SettingsScreen reads initialTab only when it mounts).
  const [settingsKey, setSettingsKey] = useState(0);
  const openSettings = (tab: SettingsTab) => {
    setSettingsOpen(tab);
    setSettingsKey((n) => n + 1);
  };
  // Native menu bar (lil-kit): Settings… opens the first tab, Check for Updates…
  // the About tab and runs the check there.
  useLilMenu(lang, {
    settings: () => openSettings("tools"),
    updates: () => {
      requestUpdateCheck();
      openSettings("about");
    },
  });
  const [osDownloads, setOsDownloads] = useState<string | null>(null);

  const [link, setLink] = useState<ParsedLink | null>(null);
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [playlistCount, setPlaylistCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const [preset, setPreset] = useState<Preset>(prefs.preset);
  const [dest, setDest] = useState<string | null>(null);
  const [destReason, setDestReason] = useState<"rule" | "last" | "default" | "os">("os");
  const [rememberFolder, setRememberFolder] = useState(false);
  const [rememberSource, setRememberSource] = useState(false);
  const [trimStart, setTrimStart] = useState("");
  const [trimEnd, setTrimEnd] = useState("");
  const [sponsorblock, setSponsorblock] = useState(false);
  const [subs, setSubs] = useState<"off" | "file" | "embed">("off");
  const [maxHeight, setMaxHeight] = useState("");
  const [vcodec, setVcodec] = useState("auto");
  const [acodec, setAcodec] = useState("auto");
  const [embedThumb, setEmbedThumb] = useState(false);
  const [useFlags, setUseFlags] = useState(false);
  const [flags, setFlags] = useState("");
  const fmt = {
    container: prefs.container,
    audioFormat: prefs.audioFormat,
    recode: prefs.recode,
  };

  const [update, setUpdate] = useState<{ current: string | null; latest: string | null } | null>(
    null,
  );
  const [updating, setUpdating] = useState(false);

  // Restored rather than started empty: the Full Disk Access flow *requires* a
  // restart, so the retry the user came back for must still be on screen.
  const [jobs, setJobs] = useState<Job[]>(readHistory);
  // Awake only while something is actually running, and only if asked to be:
  // a lock that outlives the download is a Mac that never sleeps.
  const downloading = jobs.some((j) => j.state === "running");
  const keepAwake = prefs.keepAwake;
  useEffect(() => {
    void api.keepAwake(keepAwake && downloading).catch(() => {});
  }, [keepAwake, downloading]);
  // Ids continue past whatever was restored, so a new job can't collide with a
  // remembered one. Seeded from the state above rather than by parsing storage
  // a second time.
  const nextId = useRef(0);
  if (nextId.current === 0) nextId.current = Math.max(0, ...jobs.map((j) => j.id)) + 1;

  const [draft, setDraft] = useState<string>(readDraft);
  const [toast, setToast] = useState<{ msg: string; kind: "info" | "error" } | null>(null);

  // The Файлы tab (PLAN §13). Its own card and folder choice, so switching tabs
  // never carries a half-set video card over into a file one or back.
  const tab = prefs.tab;
  const [fileDraft, setFileDraft] = useState("");
  const [fileBusy, setFileBusy] = useState(false);
  const [fileLink, setFileLink] = useState<ParsedLink | null>(null);
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileDest, setFileDest] = useState<string | null>(null);
  const [fileDestReason, setFileDestReason] = useState<"rule" | "last" | "default" | "os">("os");
  const [fileRememberFolder, setFileRememberFolder] = useState(false);
  const [fileRememberSource, setFileRememberSource] = useState(false);
  const [fileReferer, setFileReferer] = useState<string | null>(null);

  // Read by the unload handler, which must see the newest values without being
  // re-registered on every keystroke and every progress tick.
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Memoised on the three values it actually contains. As a plain literal it
  // was a new object every render, and ToolsPanel re-ran its version check on
  // each one — so typing a filename template hammered GitHub, one request per
  // keystroke.
  const paths = useMemo(
    () => ({ ytdlp: prefs.ytdlpPath, ffmpeg: prefs.ffmpegPath, cookies: prefs.cookies }),
    [prefs.ytdlpPath, prefs.ffmpegPath, prefs.cookies],
  );

  // Stable identities, so the memoised queue rows have something to compare
  // against. Recreated inline they change on every render and `memo` becomes a
  // comparison that always fails — the cost without the benefit.
  const cancelJob = useCallback((id: number) => {
    api.cancelDownload(id).catch(() => {});
  }, []);
  const removeJob = useCallback(
    (id: number, withFile: boolean) => {
      // The path is read from the ref rather than from inside the updater:
      // React may run an updater twice, and trashing a file twice is not the
      // kind of thing to leave to chance.
      const job = jobsRef.current.find((j) => j.id === id);
      // A file that never finished leaves its piece on disk; removing the row
      // is the moment nobody will ever want it again.
      if (job?.kind === "file" && job.state !== "done" && job.dir && job.name) {
        api.discardFile(job.dir, job.name).catch((e) => setToast({ msg: String(e), kind: "error" }));
      }
      const path = withFile ? job?.path : null;
      if (path) {
        api
          .trashFile(path)
          .then(() => setToast({ msg: s.queue.trashed, kind: "info" }))
          .catch((e) => setToast({ msg: String(e), kind: "error" }));
      }
      setJobs((js) => js.filter((j) => j.id !== id));
    },
    [s.queue.trashed],
  );
  const revealJob = useCallback((path: string) => {
    api.reveal(path).catch((e) => setToast({ msg: String(e), kind: "error" }));
  }, []);
  // `handleLink` closes over most of the component's state, so it is a new
  // function every render and can never be a stable prop. The ref keeps the
  // callback identity fixed while still calling the current version.
  const handleLinkRef = useRef<(raw: string, quick?: boolean) => void>(() => {});
  const againWith = useCallback((url: string) => {
    setDraft(url);
    handleLinkRef.current(url);
  }, []);
  // Stable, and not only for tidiness: Toast restarts its dismissal timer
  // whenever this changes, and during a download the component re-renders ten
  // times a second. An inline arrow meant the timer was reset before it could
  // ever fire, so confirmations sat on screen indefinitely.
  const closeToast = useCallback(() => setToast(null), []);

  // Each tab shows its own kind of row; the queue underneath is one list.
  const tabJobs = useMemo(
    () => jobs.filter((j) => (tab === "files") === (j.kind === "file")),
    [jobs, tab],
  );
  const handleFileRef = useRef<(raw: string) => void>(() => {});
  const againFile = useCallback((url: string) => {
    setFileDraft(url);
    handleFileRef.current(url);
  }, []);

  const copyLink = useCallback(
    (url: string) => {
      writeText(url)
        .then(() => setToast({ msg: s.queue.copied, kind: "info" }))
        .catch((e) => setToast({ msg: String(e), kind: "error" }));
    },
    [s.queue.copied],
  );

  // The poster we can work out from the link itself. Available the instant the
  // link is parsed, which is milliseconds, rather than after the probe, which
  // is seconds — so the card shows the actual video while it loads the rest.
  const pendingThumb = useMemo(() => (link ? guessThumb(link.clean) : null), [link]);

  const refreshTools = useCallback(() => {
    if (!hasTauri()) return;
    api
      .toolStatus(paths)
      .then((t) => {
        setTools(t);
        writeTools(t);
        // Only a real answer may send someone to the setup screen. A remembered
        // one saying "missing" would throw up a wall before we had looked.
        setChecked(true);
      })
      .catch(() => setTools((prev) => prev ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.ytdlpPath, prefs.ffmpegPath]);

  useEffect(() => {
    handleLinkRef.current = handleLink;
    handleFileRef.current = handleFile;
    takeInboxRef.current = takeInbox;
  });

  // The mailbox is looked at when told something arrived, and on every focus in
  // case a helper dropped a file without knocking.
  const takeInboxRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!hasTauri()) return;
    const unlisten = on.inbox(() => takeInboxRef.current());
    const onFocus = () => takeInboxRef.current();
    window.addEventListener("focus", onFocus);
    return () => {
      unlisten.then((f) => f());
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  // And once at start — after the Downloads folder is known, or a card would
  // open with nowhere to save to. This is how the link that launched the app
  // gets in.
  const inboxStarted = useRef(false);
  useEffect(() => {
    if (!hasTauri() || inboxStarted.current || osDownloads === null) return;
    inboxStarted.current = true;
    takeInboxRef.current();
  }, [osDownloads]);

  // Both writes are debounced, so a window closed a moment after the last
  // change would drop it. This is the other half of that trade.
  useEffect(() => {
    const flush = () => {
      writeHistory(jobsRef.current);
      writeDraft(draftRef.current);
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  // Debounced, because `jobs` changes on every progress tick — ten times a
  // second, per download. Serialising sixty rows and writing them to storage
  // that often was work nobody asked for, on the same thread that has to keep
  // the window responsive.
  useEffect(() => {
    const t = window.setTimeout(() => writeHistory(jobs), 700);
    return () => clearTimeout(t);
  }, [jobs]);

  useEffect(() => {
    const t = window.setTimeout(() => writeDraft(draft), 400);
    return () => clearTimeout(t);
  }, [draft]);

  useEffect(() => {
    refreshTools();
    if (hasTauri()) api.defaultDownloadDir().then(setOsDownloads).catch(() => {});
  }, [refreshTools]);

  // Checked on every launch rather than on failure: a stale yt-dlp answers 403,
  // which looks like a permissions problem, and finding that out only after a
  // download dies is the worst possible moment.
  useEffect(() => {
    if (checked && tools && !tools.some((t) => t.tool === "yt-dlp" && t.found)) setNeedSetup(true);
  }, [checked, tools]);

  // Deferred and cached. yt-dlp ships every couple of weeks, so asking GitHub
  // during the busiest second of the app's life buys nothing; the answer from
  // a few hours ago is exactly as true.
  useEffect(() => {
    if (!hasTauri() || !checked) return;
    const cached = readUpdate();
    if (cached) {
      setUpdate(cached.stale ? { current: cached.current, latest: cached.latest } : null);
      return;
    }
    const t = window.setTimeout(() => {
      api
        .checkYtdlpUpdate(paths, prefs.ytdlpChannel)
        .then((u) => {
          writeUpdate(u);
          setUpdate(u.stale ? { current: u.current, latest: u.latest } : null);
        })
        .catch(() => {
          // Offline, or GitHub rate-limited us. Not worth bothering anyone about.
        });
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked, prefs.ytdlpChannel]);

  useEffect(() => {
    if (!hasTauri()) return;
    const unsubs = [
      on.progress((e) =>
        setJobs((js) =>
          js.map((j) =>
            j.id === e.id
              ? {
                  ...j,
                  downloaded: e.downloaded,
                  total: e.total,
                  speed: e.speed,
                  eta: e.eta,
                  stage: e.stage,
                  conns: e.conns ?? j.conns,
                }
              : j,
          ),
        ),
      ),
      on.status((id, text) =>
        setJobs((js) => js.map((j) => (j.id === id ? { ...j, status: text } : j))),
      ),
      on.done((e) =>
        setJobs((js) =>
          js.map((j) =>
            j.id === e.id
              ? {
                  ...j,
                  // A kill and a real failure both exit non-zero; the message
                  // from the Rust side is what tells them apart.
                  state: e.ok
                    ? "done"
                    : e.paused
                      ? "paused"
                      : e.error?.includes("отменена")
                        ? "cancelled"
                        : "failed",
                  conns: 0,
                  path: e.path,
                  error: e.ok ? null : e.error,
                  status: "",
                }
              : j,
          ),
        ),
      ),
    ];
    return () => {
      unsubs.forEach((p) => p.then((f) => f()));
    };
  }, []);

  // Files that were downloading when the app quit carry on by themselves.
  useEffect(() => {
    if (!hasTauri()) return;
    jobsRef.current.filter((j) => j.wasRunning).forEach((j) => resumeFile(j.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runUpdate() {
    setUpdating(true);
    try {
      const st = await api.installTool("ytdlp", prefs.ytdlpChannel);
      forgetUpdate();
      setUpdate(null);
      refreshTools();
      setToast({ msg: `${s.update.updated} ${st.version ?? ""}`.trim(), kind: "info" });
    } catch (e) {
      setToast({ msg: String(e), kind: "error" });
    } finally {
      setUpdating(false);
    }
  }

  /** Paste → parse → probe. Everything the card needs, in one go. */
  async function handleLink(raw: string, quick = false) {
    setBusy(true);
    setInfo(null);
    // Cleared so the placeholder can't wear the previous link's poster while
    // this one is still being looked up.
    setLink(null);
    setPlaylistCount(null);
    try {
      const parsed = await api.parseLink(raw);
      if (!parsed) {
        setToast({ msg: s.err.notALink, kind: "error" });
        return;
      }
      setLink(parsed);

      // The mask restores the whole setup used for this source last time.
      const mask = resolveMask(prefs, parsed.source);
      // A rule can name a preset that has since been deleted in Settings.
      // Falling back beats silently downloading under a name nothing matches.
      const wanted = mask.preset ?? prefs.preset;
      const known = isBuiltin(wanted) || prefs.presets.some((p) => p.id === wanted);
      setPreset(known ? wanted : "max");
      const d = resolveDest(prefs, parsed.source, osDownloads);
      setDest(d.dir);
      setDestReason(d.reason);
      setRememberFolder(false);
      setRememberSource(false);
      // Per-link options: a trim from the last video must not leak into this one.
      setTrimStart("");
      setTrimEnd("");
      setSponsorblock(false);
      setSubs("off");
      setMaxHeight("");
      setVcodec("auto");
      setAcodec("auto");
      setEmbedThumb(false);
      setUseFlags(false);
      setFlags("");

      const media = await api.probeLink(parsed.clean, paths);

      // ⌘↵: last folder, last settings, straight into the queue. Timings are
      // deliberately not carried over — a trim belongs to one specific video,
      // and silently reapplying it would quietly truncate the next one.
      if (quick && d.dir) {
        beginDownload(parsed, media, d.dir, { preset: mask.preset ?? prefs.preset });
        setLink(null);
        setDraft("");
        return;
      }

      setInfo(media);

      if (parsed.playlist_id) {
        api
          .playlistSize(parsed.original, paths)
          .then(setPlaylistCount)
          .catch(() => {});
      }
    } catch (e) {
      setToast({ msg: String(e), kind: "error" });
      setLink(null);
    } finally {
      setBusy(false);
    }
  }

  async function pickDest() {
    const picked = await open({ directory: true, multiple: false, defaultPath: dest ?? undefined });
    if (typeof picked === "string") {
      setDest(picked);
      setDestReason("last");
    }
  }

  /**
   * Queue one download from explicit values.
   *
   * Deliberately takes everything as arguments rather than reading component
   * state: the ⌘↵ path fires immediately after the probe resolves, when the
   * state for that link hasn't been committed yet.
   */
  function beginDownload(
    l: ParsedLink,
    m: MediaInfo,
    dir: string,
    o: {
      wholePlaylist?: boolean;
      trimStart?: string;
      trimEnd?: string;
      sponsorblock?: boolean;
      subs?: "off" | "file" | "embed";
      preset?: Preset;
      maxHeight?: string;
      vcodec?: string;
      acodec?: string;
      embedThumb?: boolean;
      flags?: string;
    } = {},
  ) {
    const id = nextId.current++;
    const usePreset = o.preset ?? preset;
    // A preset built in Settings is not a fifth thing the downloader knows
    // about — it's unpacked here into the very fields the card would have set,
    // so there is exactly one path through the argument builder.
    const mine = resolvePreset(prefs, usePreset);

    setJobs((js) => [
      {
        id,
        url: l.original,
        title: m.title,
        thumbnail: m.thumbnail,
        source: l.source,
        state: "running",
        downloaded: 0,
        total: null,
        speed: null,
        eta: null,
        stage: "",
        // Replaced by yt-dlp's own words as soon as it has any. Until then this
        // is the difference between a row that is starting and one that is stuck.
        status: s.queue.starting,
        path: null,
        error: null,
      },
      ...js,
    ]);

    api
      .startDownload(
        {
          id,
          // The whole-playlist path deliberately uses the *original* link — the
          // playlist id was stripped out of the clean one.
          url: o.wholePlaylist ? l.original : l.clean,
          dest_dir: dir,
          preset: mine ? (mine.kind === "audio" ? "audio" : "max") : usePreset,
          filename_template: prefs.template,
          playlist: o.wholePlaylist ?? false,
          // Both apply: the global field from Settings, then whatever was typed
          // on this card. Neither silently discards the other.
          extra_args:
            [prefs.extraArgs, mine?.extraArgs, o.flags].filter(Boolean).join(" ") || null,
          cookies: prefs.cookies,
          sponsorblock: o.sponsorblock ?? false,
          subs: o.subs ?? "off",
          trim_start: o.trimStart || null,
          trim_end: o.trimEnd || null,
          // Whatever was set on the card wins over the preset: the card is
          // the more specific answer, given for this one video.
          max_height: o.maxHeight ? Number(o.maxHeight) : (mine?.maxHeight ?? null),
          vcodec: o.vcodec && o.vcodec !== "auto" ? o.vcodec : (mine?.vcodec ?? "auto"),
          acodec: o.acodec && o.acodec !== "auto" ? o.acodec : (mine?.acodec ?? "auto"),
          embed_thumbnail: o.embedThumb ?? false,
          limit_rate: rateArg(prefs.limitRate, prefs.limitUnit),
          container: mine?.kind === "video" ? mine.container : prefs.container,
          audio_format: mine?.kind === "audio" ? mine.audioFormat : prefs.audioFormat,
          recode: prefs.recode,
        },
        paths,
      )
      .catch((e) => {
        setJobs((js) =>
          js.map((j) => (j.id === id ? { ...j, state: "failed", error: String(e) } : j)),
        );
      });
  }

  function startDownload(wholePlaylist: boolean) {
    if (!link || !info || !dest) return;

    // Remembering happens at download time, not at checkbox time: the choice
    // only means something once it's been used for real.
    if (rememberFolder) set("lastDir", dest);
    if (rememberSource) setRule(link.source, { dir: dest, preset, template: prefs.template });
    set("preset", preset);

    beginDownload(link, info, dest, {
      wholePlaylist,
      trimStart,
      trimEnd,
      sponsorblock,
      subs,
      maxHeight,
      vcodec,
      acodec,
      embedThumb,
      flags: useFlags ? flags : "",
    });

    setInfo(null);
    setLink(null);
    setDraft("");
  }

  function setTab(t: "video" | "files") {
    set("tab", t);
  }

  /**
   * Send one file job to the downloader — a new one, or the same id again to
   * continue it. Rust finds the half-done piece by folder, name and link.
   */
  function runFile(id: number, url: string, dir: string, name: string, referer?: string | null) {
    api
      .startFile({
        id,
        url,
        dest_dir: dir,
        name,
        threads: prefs.threads,
        limit_bps: ratePerSecond(prefs.limitRate, prefs.limitUnit),
        referer: referer ?? null,
      })
      .then((st) =>
        setJobs((js) =>
          js.map((j) => (j.id === id ? { ...j, name: st.name, title: st.name, ranges: st.ranges } : j)),
        ),
      )
      .catch((e) =>
        setJobs((js) =>
          js.map((j) => (j.id === id ? { ...j, state: "failed", error: String(e), conns: 0 } : j)),
        ),
      );
  }

  function queueFile(
    url: string,
    source: string,
    dir: string,
    name: string,
    size: number | null,
    referer?: string | null,
  ) {
    const id = nextId.current++;
    setJobs((js) => [
      {
        id,
        kind: "file",
        url,
        // Until the server names it, the tail of the link is the best guess.
        title: name || decodeURIComponent(url.split("?")[0].split("/").filter(Boolean).pop() ?? url),
        thumbnail: null,
        source,
        state: "running",
        downloaded: 0,
        total: size,
        speed: null,
        eta: null,
        stage: "",
        status: s.queue.starting,
        path: null,
        error: null,
        dir,
        name,
        referer: referer ?? null,
        conns: 0,
      },
      ...js,
    ]);
    runFile(id, url, dir, name, referer);
  }

  const resumeFile = useCallback((id: number) => {
    const j = jobsRef.current.find((x) => x.id === id);
    if (!j || !j.dir) return;
    setJobs((js) =>
      js.map((x) =>
        x.id === id ? { ...x, state: "running", error: null, wasRunning: false, status: s.queue.starting } : x,
      ),
    );
    runFileRef.current(id, j.url, j.dir, j.name ?? "", j.referer);
  }, [s.queue.starting]);
  const runFileRef = useRef(runFile);
  runFileRef.current = runFile;

  const pauseFile = useCallback((id: number) => {
    api.pauseFile(id).catch(() => {});
  }, []);

  /** Paste → probe → card, or straight to the queue for several links at once. */
  async function handleFile(
    raw: string,
    quick = false,
    from: { referer?: string | null; auto?: boolean } = {},
  ) {
    // Pasted lists arrive with their line breaks squashed out of a one-line
    // field, so links are told apart by where the next one starts.
    const urls = raw
      .split(/\s+|(?=https?:\/\/)/)
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//.test(u));
    if (urls.length > 1) {
      for (const u of urls) {
        const parsed = await api.parseLink(u).catch(() => null);
        const d = resolveDest(prefs, parsed?.source ?? null, osDownloads);
        if (d.dir) queueFile(u, parsed?.source ?? "", d.dir, "", null, from.referer);
      }
      setToast({ msg: s.files.queued(urls.length), kind: "info" });
      setFileDraft("");
      return;
    }
    setFileBusy(true);
    setFileInfo(null);
    setFileLink(null);
    try {
      const parsed = await api.parseLink(raw);
      if (!parsed) {
        setToast({ msg: s.err.notALink, kind: "error" });
        return;
      }
      const d = resolveDest(prefs, parsed.source, osDownloads);
      // The original, not the cleaned link: a file URL's query string is
      // usually its signature, and the cleaner strips "tracking" parameters.
      const info = await api.probeFile(parsed.original, from.referer);
      // Sent from outside without saying what it is, and it's a page: that is
      // the Видео tab's job, so it goes there without asking.
      if (info.page && from.auto) {
        setFileDraft("");
        setTab("video");
        setDraft(parsed.original);
        await handleLink(parsed.original, quick);
        return;
      }
      if (quick && d.dir && !info.page) {
        queueFile(parsed.original, parsed.source, d.dir, info.name, info.size, from.referer);
        setFileDraft("");
        return;
      }
      setFileLink(parsed);
      setFileInfo(info);
      setFileName(info.name);
      setFileDest(d.dir);
      setFileDestReason(d.reason);
      setFileRememberFolder(false);
      setFileRememberSource(false);
      setFileReferer(from.referer ?? null);
    } catch (e) {
      setToast({ msg: String(e), kind: "error" });
    } finally {
      setFileBusy(false);
    }
  }

  function startFile() {
    if (!fileLink || !fileInfo || !fileDest) return;
    if (fileRememberFolder) set("lastDir", fileDest);
    if (fileRememberSource) setRule(fileLink.source, { dir: fileDest });
    queueFile(fileLink.original, fileLink.source, fileDest, fileName.trim(), fileInfo.size, fileReferer);
    setFileInfo(null);
    setFileLink(null);
    setFileDraft("");
  }

  async function pickFileDest() {
    const picked = await open({ directory: true, multiple: false, defaultPath: fileDest ?? undefined });
    if (typeof picked === "string") {
      setFileDest(picked);
      setFileDestReason("last");
    }
  }

  /**
   * Links handed over from outside (PLAN §13, stage 2). One link opens a card
   * in the right tab, as if pasted. Several at once — only ever from the inbox
   * folder, never from a lildownload:// link a web page could open — go
   * straight to the queue with the remembered settings.
   */
  async function takeInbox() {
    const items = await api.takeInbox().catch(() => []);
    if (items.length === 0) return;
    const batch = items.length > 1 && items.every((i) => i.trusted);
    for (const it of batch ? items : items.slice(-1)) {
      if (it.kind === "video") {
        setTab("video");
        setDraft(it.url);
        await handleLink(it.url, batch);
      } else {
        setTab("files");
        setFileDraft(it.url);
        await handleFile(it.url, batch, { referer: it.referer, auto: it.kind !== "file" });
      }
    }
  }

  if (!hasTauri()) {
    return <div className="browser-note b-panel">{s.err.browserOnly}</div>;
  }

  // Cold start: the tool probe is a real round-trip, and a blank window for a
  // second and a half reads as a hang.
  if (!tools) return <BootScreen />;

  if (needSetup && !setupDone) {
    return (
      <Suspense fallback={<BootScreen />}>
      <SetupScreen
        tools={tools}
        paths={paths}
        onRefresh={refreshTools}
        onSkip={() => setSetupDone(true)}
        onPickPath={(tool, path) => set(tool === "ytdlp" ? "ytdlpPath" : "ffmpegPath", path)}
      />
      </Suspense>
    );
  }

  if (settingsOpen) {
    return (
      <Suspense fallback={<BootScreen />}>
      <SettingsScreen
        key={settingsKey}
        initialTab={settingsOpen}
        tools={tools}
        paths={paths}
        prefs={prefs}
        onSet={set}
        onRefresh={refreshTools}
        onPickPath={(tool, path) => set(tool === "ytdlp" ? "ytdlpPath" : "ffmpegPath", path)}
        onClose={() => setSettingsOpen(null)}
      />
      </Suspense>
    );
  }

  return (
    <div className="app-shell">
      <header className="head" data-tauri-drag-region>
        <span className="head-name b-display">{s.app.name}</span>
        <div className="tabs" role="tablist">
          {(["video", "files"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`b-btn ${tab === t ? "on" : ""}`}
              onClick={() => setTab(t)}
            >
              {s.tabs[t]}
            </button>
          ))}
        </div>
        <span className="head-sp" />
        {tab === "video" && (
        <>
        <PresetPicker
          value={preset}
          onChange={(p) => {
            setPreset(p);
            set("preset", p);
          }}
          formats={info?.formats}
          custom={prefs.presets}
          onBuild={() => setSettingsOpen("presets")}
          format={fmt}
          onFormat={(f) => {
            set("container", f.container);
            set("audioFormat", f.audioFormat);
            set("recode", f.recode);
          }}
        />
        <CookiePicker
          value={prefs.cookies}
          onChange={(b) => set("cookies", b)}
        />
        </>
        )}
        <ModeToggle />
        <LanguagePicker />
        <button className="b-btn" onClick={() => setSettingsOpen("tools")} title={s.settings.title}>
          <Icon name="settings" />
        </button>

        {/* The footer ticker is gone: it named operations that were over before
            the sentence could be read, and sat at "готов" the rest of the time.
            One moving line on the header's edge says the same thing honestly —
            something is in flight — without claiming to know what or how long. */}
        {(busy || fileBusy) && <span className="head-work" aria-hidden="true" />}
      </header>

      <main className="main">
        <div className="main-col">
        {update && (
          <div className="banner">
            <div className="banner-text">
              <strong>{s.update.stale}</strong>
              <span className="b-mono">
                {s.update.have} {update.current} · {s.update.latest} {update.latest}
              </span>
              <span className="banner-why">{s.update.why}</span>
            </div>
            <button className="b-btn b-btn--solid" disabled={updating} onClick={runUpdate}>
              <Icon name={updating ? "busy" : "download"} className={updating ? "spin" : ""} />{" "}
              {updating ? s.update.updating : s.update.update}
            </button>
          </div>
        )}

        {tab === "files" && (
          <>
            <LinkBar
              value={fileDraft}
              onValue={setFileDraft}
              onSubmit={handleFile}
              busy={fileBusy}
              canQuick={!!resolveDest(prefs, null, osDownloads).dir}
              placeholder={s.files.hint}
            />
            {fileBusy && <CardSkeleton thumb={null} source={null} />}
            {!fileBusy && fileInfo && fileLink && (
              <FileCard
                info={fileInfo}
                source={fileLink.source}
                name={fileName}
                onName={setFileName}
                threads={prefs.threads}
                dest={fileDest}
                destReason={fileDestReason}
                onPickDest={pickFileDest}
                rememberFolder={fileRememberFolder}
                onRememberFolder={setFileRememberFolder}
                rememberSource={fileRememberSource}
                onRememberSource={setFileRememberSource}
                onDownload={startFile}
                onToVideo={() => {
                  const url = fileLink.original;
                  setFileInfo(null);
                  setFileLink(null);
                  setFileDraft("");
                  setTab("video");
                  setDraft(url);
                  handleLink(url);
                }}
                onClear={() => {
                  setFileInfo(null);
                  setFileLink(null);
                }}
              />
            )}
          </>
        )}

        {tab === "video" && (
        <>
        <LinkBar
          value={draft}
          onValue={setDraft}
          onSubmit={handleLink}
          busy={busy}
          canQuick={!!resolveDest(prefs, null, osDownloads).dir}
        />

        {busy && <CardSkeleton thumb={pendingThumb} source={link?.source} />}

        {!busy && info && link && (
          <MediaCard
            info={info}
            link={link}
            dest={dest}
            destReason={destReason}
            onPickDest={pickDest}
            rememberFolder={rememberFolder}
            onRememberFolder={setRememberFolder}
            rememberSource={rememberSource}
            onRememberSource={setRememberSource}
            playlistCount={playlistCount}
            trimStart={trimStart}
            trimEnd={trimEnd}
            onTrim={(which, v) => (which === "start" ? setTrimStart(v) : setTrimEnd(v))}
            sponsorblock={sponsorblock}
            onSponsorblock={setSponsorblock}
            maxHeight={maxHeight}
            onMaxHeight={setMaxHeight}
            vcodec={vcodec}
            onVcodec={setVcodec}
            acodec={acodec}
            onAcodec={setAcodec}
            embedThumb={embedThumb}
            onEmbedThumb={setEmbedThumb}
            useFlags={useFlags}
            onUseFlags={setUseFlags}
            flags={flags}
            onFlags={setFlags}
            subs={subs}
            onSubs={setSubs}
            onDownloadAll={() => startDownload(true)}
            onDownload={() => startDownload(false)}
            onClear={() => {
              setInfo(null);
              setLink(null);
            }}
          />
        )}

        </>
        )}

        <Queue
          jobs={tabJobs}
          // Remembered like every other preference. The queue itself has been
          // persisted since the Full Disk Access flow forced a restart mid-job;
          // this toggle simply never got the same treatment.
          view={prefs.queueView}
          onView={(v) => set("queueView", v)}
          awake={!keepAwake ? "off" : downloading ? "holding" : "ready"}
          onAwake={() => set("keepAwake", !keepAwake)}
          onAgain={tab === "files" ? againFile : againWith}
          onCopy={copyLink}
          // Running jobs survive: clearing the list must not orphan a download
          // that is still writing to disk.
          // Paused files survive too: their pieces are still on disk.
          onClear={() =>
            setJobs((js) =>
              js.filter(
                (j) =>
                  (tab === "files") !== (j.kind === "file") ||
                  j.state === "running" ||
                  j.state === "paused",
              ),
            )
          }
          onPause={pauseFile}
          onResume={resumeFile}
          onCancel={cancelJob}
          onReveal={revealJob}
          onRemove={removeJob}
        />
        </div>
      </main>

      {toast && <Toast message={toast.msg} kind={toast.kind} onClose={closeToast} />}
    </div>
  );
}
