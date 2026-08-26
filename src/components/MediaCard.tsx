import { useStrings } from "../lib/i18n";
import { duration } from "../lib/format";
import type { MediaInfo, ParsedLink } from "../lib/api";
import { FlagsInput } from "./FlagsInput";
import { Icon } from "./Icon";

/**
 * What's behind the link, shown before anything downloads.
 *
 * What's left here is only what the user can act on: the playlist strip is
 * announced rather than silent (PLAN §4), and the folder line says *why* that
 * folder. The codec warning that used to sit here is gone on purpose — anyone
 * who cares about the container now has it in the quality menu, and nagging
 * about it on every card was noise in front of the one button people came for.
 *
 * The preset is deliberately *not* here — it moved to the header, so adding a
 * link doesn't open a form. The card only names the preset in effect.
 */
export function MediaCard({
  info,
  link,
  dest,
  destReason,
  onPickDest,
  rememberFolder,
  onRememberFolder,
  rememberSource,
  onRememberSource,
  playlistCount,
  trimStart,
  trimEnd,
  onTrim,
  sponsorblock,
  onSponsorblock,
  maxHeight,
  onMaxHeight,
  vcodec,
  onVcodec,
  acodec,
  onAcodec,
  embedThumb,
  onEmbedThumb,
  useFlags,
  onUseFlags,
  flags,
  onFlags,
  subs,
  onSubs,
  onDownloadAll,
  onDownload,
  onClear,
}: {
  info: MediaInfo;
  link: ParsedLink;
  dest: string | null;
  destReason: "rule" | "last" | "default" | "os";
  onPickDest: () => void;
  rememberFolder: boolean;
  onRememberFolder: (v: boolean) => void;
  rememberSource: boolean;
  onRememberSource: (v: boolean) => void;
  playlistCount: number | null;
  trimStart: string;
  trimEnd: string;
  onTrim: (which: "start" | "end", v: string) => void;
  sponsorblock: boolean;
  onSponsorblock: (v: boolean) => void;
  maxHeight: string;
  onMaxHeight: (v: string) => void;
  vcodec: string;
  onVcodec: (v: string) => void;
  acodec: string;
  onAcodec: (v: string) => void;
  embedThumb: boolean;
  onEmbedThumb: (v: boolean) => void;
  useFlags: boolean;
  onUseFlags: (v: boolean) => void;
  flags: string;
  onFlags: (v: string) => void;
  subs: "off" | "file" | "embed";
  onSubs: (v: "off" | "file" | "embed") => void;
  onDownloadAll: () => void;
  onDownload: () => void;
  onClear: () => void;
}) {
  const s = useStrings();

  return (
    <div className="card b-panel">
      <button className="card-x" onClick={onClear} title={s.card.clear}>
        <Icon name="close" />
      </button>

      <div className="card-top">
        {info.thumbnail && <img className="card-thumb" src={info.thumbnail} alt="" />}
        <div className="card-meta">
          <h2 className="card-title">{info.title}</h2>
          <div className="card-facts b-mono">
            {info.uploader && <span>{info.uploader}</span>}
            <span>{duration(info.duration)}</span>
            <span className="card-source">{link.source}</span>
          </div>
        </div>
      </div>

      {/* PLAN §4 — the playlist is already cut; this is the way back in. */}
      {(link.playlist_id || playlistCount) && (
        <div className="note">
          <span>
            {s.card.playlistFound}
            {playlistCount ? ` — ${s.card.playlistCount(playlistCount)}` : ""}
          </span>
          <button className="b-btn" onClick={onDownloadAll}>
            {s.card.playlistAll}
          </button>
        </div>
      )}

      <div className="card-opts">
        <div className="opt-col">
        <div className="opt">
          <span className="opt-label">
            <Icon name="trim" size={14} /> {s.opts.trim}
          </span>
          <input
            className="opt-time b-mono"
            value={trimStart}
            placeholder="0:00"
            spellCheck={false}
            onChange={(e) => onTrim("start", e.target.value)}
          />
          <span className="opt-dash">—</span>
          <input
            className="opt-time b-mono"
            value={trimEnd}
            placeholder={duration(info.duration)}
            spellCheck={false}
            onChange={(e) => onTrim("end", e.target.value)}
          />
          {/* PLAN §4: the timecode from the link is offered, never applied. */}
          {link.start_seconds !== null && !trimStart && (
            <button
              className="opt-suggest b-mono"
              onClick={() => onTrim("start", duration(link.start_seconds))}
            >
              {s.card.timecode} {duration(link.start_seconds)} → {s.card.timecodeUse}
            </button>
          )}
        </div>

        <div className="opt">
          <span className="opt-label">
            <Icon name="subs" size={14} /> {s.opts.subs}
          </span>
          <select
            className="opt-select b-mono"
            value={subs}
            onChange={(e) => onSubs(e.target.value as "off" | "file" | "embed")}
          >
            <option value="off">{s.opts.subsOff}</option>
            <option value="file">{s.opts.subsFile}</option>
            <option value="embed">{s.opts.subsEmbed}</option>
          </select>
        </div>

        <label className="opt opt-check">
          <input
            type="checkbox"
            checked={sponsorblock}
            onChange={(e) => onSponsorblock(e.target.checked)}
          />
          <span className="opt-label">
            <Icon name="sponsor" size={14} /> {s.opts.sponsorblock}
          </span>
        </label>

        <label className="opt opt-check">
          <input
            type="checkbox"
            checked={embedThumb}
            onChange={(e) => onEmbedThumb(e.target.checked)}
          />
          <span className="opt-label">
            <Icon name="image" size={14} /> {s.opts.thumb}
          </span>
        </label>
        </div>

        {/* The right half used to be empty. Fine tuning belongs here rather
            than behind another click: someone who opened this card a second
            time is here precisely because a default was wrong. */}
        <div className="opt-col">
          <div className="opt">
            <span className="opt-label">
              <Icon name="settings" size={14} /> {s.opts.res}
            </span>
            <select
              className="opt-select b-mono"
              value={maxHeight}
              onChange={(e) => onMaxHeight(e.target.value)}
            >
              <option value="">{s.opts.resAuto}</option>
              <option value="2160">2160p · 4K</option>
              <option value="1440">1440p</option>
              <option value="1080">1080p · Full HD</option>
              <option value="720">720p · HD</option>
              <option value="480">480p</option>
            </select>
          </div>

          <div className="opt">
            <span className="opt-label">
              <Icon name="settings" size={14} /> {s.opts.codec}
            </span>
            <select
              className="opt-select b-mono wide"
              value={vcodec}
              onChange={(e) => onVcodec(e.target.value)}
            >
              <option value="auto">{s.opts.codecAuto}</option>
              <option value="h264">{s.opts.codecH264}</option>
              <option value="vp9">{s.opts.codecVp9}</option>
              <option value="av01">{s.opts.codecAv01}</option>
            </select>
          </div>

          <div className="opt">
            <span className="opt-label">
              <Icon name="settings" size={14} /> {s.opts.acodec}
            </span>
            <select
              className="opt-select b-mono wide"
              value={acodec}
              onChange={(e) => onAcodec(e.target.value)}
            >
              <option value="auto">{s.opts.codecAuto}</option>
              <option value="aac">{s.opts.acodecAac}</option>
              <option value="opus">{s.opts.acodecOpus}</option>
              <option value="mp3">mp3</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card-dest">
        <span className="b-cap">{s.card.dest}</span>
        <button className="dest-path b-mono" onClick={onPickDest} title={dest ?? ""}>
          <Icon name="folder" size={14} /> {dest ?? "—"}
        </button>
        {destReason === "rule" && (
          <span className="dest-why b-mono">{`правило ${link.source}`}</span>
        )}
      </div>

      <div className="card-remember">
        <label>
          <input
            type="checkbox"
            checked={rememberFolder}
            onChange={(e) => onRememberFolder(e.target.checked)}
          />
          {s.card.rememberFolder}
        </label>
        <label>
          <input
            type="checkbox"
            checked={rememberSource}
            onChange={(e) => onRememberSource(e.target.checked)}
          />
          {s.card.rememberSource} ({link.source})
        </label>
      </div>

      <div className="card-go-row">
        <button className="b-btn b-btn--yellow card-go" disabled={!dest} onClick={onDownload}>
          <Icon name="download" /> {s.card.download}
        </button>

        {/* Off by default and behind its own switch: a stray character in here
            fails the whole download, so it must be impossible to leave enabled
            by accident. */}
        <label className="flags-check">
          <input
            type="checkbox"
            checked={useFlags}
            onChange={(e) => onUseFlags(e.target.checked)}
          />
          <span>{s.opts.flags}</span>
        </label>
        <FlagsInput value={flags} onChange={onFlags} disabled={!useFlags} className="flags-input" />
      </div>
    </div>
  );
}
