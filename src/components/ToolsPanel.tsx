import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { api, on, type ToolPaths, type ToolStatus, type UpdateInfo } from "../lib/api";
import type { Channel } from "../lib/settings";
import { forgetUpdate, readUpdate, writeUpdate } from "../lib/cache";
import { bytes } from "../lib/format";
import { useStrings } from "../lib/i18n";
import { Icon } from "./Icon";

/**
 * The state of yt-dlp and ffmpeg, and the buttons that change it.
 *
 * Shared by the first-run screen and Settings, because managing these is not a
 * setup step that ends — yt-dlp goes stale on YouTube's schedule, not ours.
 *
 * Only yt-dlp is version-checked. ffmpeg's build numbering differs per platform
 * and per builder, so there is nothing honest to compare against; its button
 * says "переустановить" rather than pretending to know about an update.
 */
/** Seconds once we're past a second — "12000 ms" reads as noise. */
function fmtStartup(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} с` : `${ms} мс`;
}

/**
 * Slow enough to be worth complaining about. Two seconds is far above anything
 * a healthy install takes (measured: 0.26 s for the zipapp, 0.13 s for a
 * Homebrew copy) and far below the ~12 s the standalone macOS build costs.
 */
function isSlow(st?: ToolStatus): boolean {
  return !!st?.found && (st.startup_ms ?? 0) > 2000;
}

export function ToolsPanel({
  tools,
  paths,
  channels,
  onChannel,
  onRefresh,
  onPickPath,
}: {
  tools: ToolStatus[];
  paths: ToolPaths;
  /** Omitted on the first-run screen, which deliberately offers one path only. */
  channels?: { ytdlp: Channel; ffmpeg: Channel };
  onChannel?: (tool: "ytdlp" | "ffmpeg", ch: Channel) => void;
  onRefresh: () => void;
  onPickPath: (tool: "ytdlp" | "ffmpeg", path: string) => void;
}) {
  const s = useStrings();
  const [busy, setBusy] = useState<string | null>(null);
  const [prog, setProg] = useState<{ done: number; total: number | null; stage: string } | null>(
    null,
  );
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [upd, setUpd] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  useEffect(() => {
    const un = on.install((e) => setProg({ done: e.done, total: e.total, stage: e.stage }));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const ytChannel = channels?.ytdlp ?? "stable";

  const check = useCallback(
    async (force = false) => {
      // Opening Settings shouldn't cost a network round-trip every time. The
      // button beside this still forces one, which is what it is for.
      if (!force) {
        const cached = readUpdate();
        if (cached) {
          setUpd(cached);
          return;
        }
      }
      setChecking(true);
      setErr(null);
      try {
        const u = await api.checkYtdlpUpdate(paths, ytChannel);
        writeUpdate(u);
        setUpd(u);
        setCheckedAt(new Date());
      } catch (e) {
        setErr(String(e));
      } finally {
        setChecking(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paths, ytChannel],
  );

  useEffect(() => {
    check();
  }, [check]);

  async function install(tool: "ytdlp" | "ffmpeg") {
    setErr(null);
    setOk(null);
    setBusy(tool);
    setProg(null);
    try {
      const st = await api.installTool(tool, channels?.[tool] ?? "stable");
      // The remembered verdict describes the copy we just replaced.
      forgetUpdate();
      // Name the version: "готово" alone leaves you wondering whether anything
      // actually changed.
      setOk(`${st.tool} ${st.version ?? ""}`.trim());
      onRefresh();
      if (tool === "ytdlp") await check(true);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
      setProg(null);
    }
  }

  async function choose(tool: "ytdlp" | "ffmpeg", label: string) {
    // The dialog names the file too. By the time the OS panel is open the
    // button that opened it is gone, and "choose a file" is no help at all.
    const picked = await open({
      multiple: false,
      directory: false,
      title: s.setup.chooseDialog(label),
    });
    if (typeof picked === "string") {
      onPickPath(tool, picked);
      onRefresh();
    }
  }

  return (
    <>
      <div className="setup-versions">
        <button className="b-btn" onClick={() => check(true)} disabled={checking}>
          <Icon name="refresh" className={checking ? "spin" : ""} />{" "}
          {checking ? s.update.checking : s.update.check}
        </button>
        <span className="b-mono setup-checked">
          {s.update.lastChecked}:{" "}
          {checking
            ? s.update.checking
            : checkedAt
              ? checkedAt.toLocaleTimeString()
              : s.update.never}
        </span>
        {upd && !checking && (
          <span className={`b-mono setup-verdict ${upd.stale ? "stale" : "fresh"}`}>
            {upd.stale
              ? `${upd.current ?? s.update.unknown} → ${upd.latest ?? s.update.unknown}`
              : `${s.update.upToDate} · ${upd.current ?? s.update.unknown}`}
          </span>
        )}
      </div>

      <div className="setup-rows">
        {(
          [
            ["ytdlp", "yt-dlp", s.setup.ytdlpWhat],
            ["ffmpeg", "ffmpeg", s.setup.ffmpegWhat],
          ] as const
        ).map(([key, label, what]) => {
          const st = tools.find((t) => t.tool === label);
          const running = busy === key;
          const checked = key === "ytdlp";
          const stale = checked && (upd?.stale ?? false);

          // Three different buttons, because they promise three different
          // things: install what's missing, update what's behind, reinstall
          // what's already current.
          const action = !st?.found
            ? s.setup.install
            : stale
              ? s.update.update
              : s.setup.reinstall;

          return (
            <div
              key={key}
              className={`setup-row b-panel ${st?.found ? "ok" : ""} ${stale ? "stale" : ""}`}
            >
              <div className="setup-row-main">
                <span className="b-cap">{label}</span>
                <span className="setup-what">{what}</span>
                {st?.found && (
                  <span className="setup-found b-mono">
                    <Icon name="ok" size={12} /> {s.setup.found} · {st.version} ·{" "}
                    {st.origin ? s.setup.origin[st.origin] : ""}
                  </span>
                )}
                {st?.found && checked && upd && !checking && (
                  <span className={`b-mono setup-verdict-row ${stale ? "stale" : "fresh"}`}>
                    {stale
                      ? `${s.update.stale} · ${s.update.latest} ${upd.latest ?? s.update.unknown}`
                      : `${s.update.upToDate}`}
                  </span>
                )}
                {/* The number alone doesn't tell anyone what to do about it, so
                    this one line stays out in the open. Everything else about
                    the install is true but inert — it goes under the hover. */}
                {isSlow(st) && <span className="setup-slow">{s.update.slowHint}</span>}
                {st?.found && (
                  <span className="setup-more" tabIndex={0}>
                    <Icon name="chevron" size={11} /> {s.settings.details}
                    <span className="setup-more-pop b-panel b-mono">
                      {!checked && <span className="muted">{s.update.noCheck}</span>}
                      {st.runner && (
                        <span className="muted">
                          {st.runner === "python" ? s.update.runnerPython : s.update.runnerNative}
                          {st.startup_ms !== null &&
                            ` · ${s.update.startup} ${fmtStartup(st.startup_ms)}`}
                        </span>
                      )}
                      {st.path && <span className="setup-path">{st.path}</span>}
                    </span>
                  </span>
                )}
              </div>

              <div className="setup-row-act">
                {onChannel && channels && (
                  <div className="setup-channel" title={s.settings.channelHint}>
                    {(["stable", "nightly"] as const).map((c) => (
                      <button
                        key={c}
                        className={`setup-channel-btn ${channels[key] === c ? "on" : ""}`}
                        onClick={() => onChannel(key, c)}
                      >
                        {c === "stable" ? s.settings.channelStable : s.settings.channelNightly}
                      </button>
                    ))}
                  </div>
                )}
                {running ? (
                  <span className="b-mono setup-progress">
                    <Icon name="busy" className="spin" />{" "}
                    {prog?.stage === "extract"
                      ? s.setup.extracting
                      : `${s.setup.installing} ${bytes(prog?.done ?? 0)}`}
                  </span>
                ) : (
                  <>
                    <button
                      className={`b-btn ${!st?.found || stale ? "b-btn--yellow" : ""}`}
                      onClick={() => install(key)}
                      disabled={checking}
                    >
                      <Icon name="download" /> {action}
                    </button>
                    <button
                      className="b-btn"
                      onClick={() => choose(key, label)}
                      title={s.setup.chooseHint}
                    >
                      {s.setup.choose(label)}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {ok && (
        <div className="setup-ok b-mono">
          <Icon name="ok" size={12} /> {s.update.updated} {ok}
        </div>
      )}
      {err && <div className="b-error">{err}</div>}
    </>
  );
}
