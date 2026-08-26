import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { api, on, type MediaInfo, type ParsedLink, type ToolStatus } from "./lib/api";
import { hasTauri } from "./lib/tauri";
import {
  isBuiltin,
  rateArg,
  resolveDest,
  resolveMask,
  resolvePreset,
  usePrefs,
  type Preset,
} from "./lib/settings";
import { useStrings } from "./lib/i18n";
import { readDraft, readHistory, writeDraft, writeHistory } from "./lib/history";
import { LanguagePicker } from "./components/LanguagePicker";
import { CookiePicker } from "./components/CookiePicker";
import { Icon } from "./components/Icon";
import { LinkBar } from "./components/LinkBar";
import { MediaCard } from "./components/MediaCard";
import { ModeToggle } from "./components/ModeToggle";
import { PresetPicker } from "./components/PresetPicker";
import { Queue, type Job } from "./components/Queue";
import { SettingsScreen, type Tab as SettingsTab } from "./components/SettingsScreen";
import { SetupScreen } from "./components/SetupScreen";
import { BootScreen, CardSkeleton } from "./components/Skeleton";
import { Toast } from "./components/Toast";

export default function App() {
  const s = useStrings();
  const { prefs, set, setRule } = usePrefs();

  const [tools, setTools] = useState<ToolStatus[] | null>(null);
  const [setupDone, setSetupDone] = useState(false);
  // Latches once yt-dlp turns up missing. Without it the setup screen closes
  // itself the instant the install finishes — taking the "✓ обновили до …"
  // confirmation with it, which is precisely when you want to read it.
  const [needSetup, setNeedSetup] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState<SettingsTab | null>(null);
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

  const [draft, setDraft] = useState<string>(readDraft);
  const [toast, setToast] = useState<{ msg: string; kind: "info" | "error" } | null>(null);

  // Ids continue past whatever was restored, so a new job can't collide with a
  // remembered one.
  const nextId = useRef(Math.max(0, ...readHistory().map((j) => j.id)) + 1);
  // Memoised on the three values it actually contains. As a plain literal it
  // was a new object every render, and ToolsPanel re-ran its version check on
  // each one — so typing a filename template hammered GitHub, one request per
  // keystroke.
  const paths = useMemo(
    () => ({ ytdlp: prefs.ytdlpPath, ffmpeg: prefs.ffmpegPath, cookies: prefs.cookies }),
    [prefs.ytdlpPath, prefs.ffmpegPath, prefs.cookies],
  );

  const refreshTools = useCallback(() => {
    if (!hasTauri()) return;
    api.toolStatus(paths).then(setTools).catch(() => setTools([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.ytdlpPath, prefs.ffmpegPath]);

  useEffect(() => {
    writeHistory(jobs);
  }, [jobs]);

  useEffect(() => {
    writeDraft(draft);
  }, [draft]);

  useEffect(() => {
    refreshTools();
    if (hasTauri()) api.defaultDownloadDir().then(setOsDownloads).catch(() => {});
  }, [refreshTools]);

  // Checked on every launch rather than on failure: a stale yt-dlp answers 403,
  // which looks like a permissions problem, and finding that out only after a
  // download dies is the worst possible moment.
  useEffect(() => {
    if (tools && !tools.some((t) => t.tool === "yt-dlp" && t.found)) setNeedSetup(true);
  }, [tools]);

  useEffect(() => {
    if (!hasTauri() || !tools) return;
    api
      .checkYtdlpUpdate(paths, prefs.ytdlpChannel)
      .then((u) => setUpdate(u.stale ? { current: u.current, latest: u.latest } : null))
      .catch(() => {
        // Offline, or GitHub rate-limited us. Not worth bothering anyone about.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tools, prefs.ytdlpChannel]);

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
                  state: e.ok ? "done" : e.error?.includes("отменена") ? "cancelled" : "failed",
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

  async function runUpdate() {
    setUpdating(true);
    try {
      const st = await api.installTool("ytdlp", prefs.ytdlpChannel);
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
        status: "",
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

  if (!hasTauri()) {
    return <div className="browser-note b-panel">{s.err.browserOnly}</div>;
  }

  // Cold start: the tool probe is a real round-trip, and a blank window for a
  // second and a half reads as a hang.
  if (!tools) return <BootScreen />;

  if (needSetup && !setupDone) {
    return (
      <SetupScreen
        tools={tools}
        paths={paths}
        onRefresh={refreshTools}
        onSkip={() => setSetupDone(true)}
        onPickPath={(tool, path) => set(tool === "ytdlp" ? "ytdlpPath" : "ffmpegPath", path)}
      />
    );
  }

  if (settingsOpen) {
    return (
      <SettingsScreen
        initialTab={settingsOpen}
        tools={tools}
        paths={paths}
        prefs={prefs}
        onSet={set}
        onRefresh={refreshTools}
        onPickPath={(tool, path) => set(tool === "ytdlp" ? "ytdlpPath" : "ffmpegPath", path)}
        onClose={() => setSettingsOpen(null)}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="head" data-tauri-drag-region>
        <span className="head-name b-display">{s.app.name}</span>
        <span className="head-tag b-mono">{s.app.tagline}</span>
        <span className="head-sp" />
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
        <ModeToggle />
        <LanguagePicker />
        <button className="b-btn" onClick={() => setSettingsOpen("tools")} title={s.settings.title}>
          <Icon name="settings" />
        </button>

        {/* The footer ticker is gone: it named operations that were over before
            the sentence could be read, and sat at "готов" the rest of the time.
            One moving line on the header's edge says the same thing honestly —
            something is in flight — without claiming to know what or how long. */}
        {busy && <span className="head-work" aria-hidden="true" />}
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

        <LinkBar
          value={draft}
          onValue={setDraft}
          onSubmit={handleLink}
          busy={busy}
          canQuick={!!resolveDest(prefs, null, osDownloads).dir}
        />

        {busy && <CardSkeleton />}

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

        <Queue
          jobs={jobs}
          // Remembered like every other preference. The queue itself has been
          // persisted since the Full Disk Access flow forced a restart mid-job;
          // this toggle simply never got the same treatment.
          view={prefs.queueView}
          onView={(v) => set("queueView", v)}
          onAgain={(url) => {
            setDraft(url);
            handleLink(url);
          }}
          onCopy={(url) => {
            writeText(url)
              .then(() => setToast({ msg: s.queue.copied, kind: "info" }))
              .catch((e) => setToast({ msg: String(e), kind: "error" }));
          }}
          // Running jobs survive: clearing the list must not orphan a download
          // that is still writing to disk.
          onClear={() => setJobs((js) => js.filter((j) => j.state === "running"))}
          onCancel={(id) => api.cancelDownload(id).catch(() => {})}
          onReveal={(p) => api.reveal(p).catch((e) => setToast({ msg: String(e), kind: "error" }))}
          onRemove={(id) => setJobs((js) => js.filter((j) => j.id !== id))}
        />
        </div>
      </main>

      {toast && <Toast message={toast.msg} kind={toast.kind} onClose={() => setToast(null)} />}
    </div>
  );
}
