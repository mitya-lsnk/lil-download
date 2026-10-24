import { memo } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { useStrings } from "../lib/i18n";
import { bytes, eta, speed } from "../lib/format";
import { Icon } from "./Icon";

export type QueueView = "list" | "bento";

export interface Job {
  id: number;
  /** The link this came from, so it can be run again without hunting for it. */
  url: string;
  title: string;
  /** Poster frame, so a finished row is findable by eye and not by reading. */
  thumbnail: string | null;
  source: string;
  state: "running" | "done" | "failed" | "cancelled" | "paused";
  downloaded: number;
  total: number | null;
  speed: number | null;
  eta: number | null;
  stage: string;
  status: string;
  path: string | null;
  error: string | null;
  /** A plain file from the Файлы tab; absent on video rows (and old history). */
  kind?: "file";
  /** File rows: where it goes and under what name — enough to find the half-done
   * piece on disk and carry on. */
  dir?: string;
  name?: string;
  /** File rows: the server resumes, so pausing loses nothing. */
  ranges?: boolean;
  /** File rows: the page the link came from, sent again on every resume. */
  referer?: string | null;
  conns?: number;
  /** Was downloading when the app quit; continues on the next launch. */
  wasRunning?: boolean;
}

/**
 * The link a row can be opened from. Only http(s) goes to the OS handler: the
 * address can arrive from outside (a `lildownload://` link, the Safari helper,
 * old history), and `openUrl` would hand a `file:` or custom-scheme address to
 * whatever app claims it. For a file, the page it came from beats the direct
 * link, which is usually a signed one that has long since expired.
 */
function originalLink(j: Job): string | null {
  for (const raw of [j.referer, j.url]) {
    if (!raw) continue;
    try {
      const u = new URL(raw);
      if (u.protocol === "https:" || u.protocol === "http:") return u.href;
    } catch {
      /* not a URL; try the next one */
    }
  }
  return null;
}

export function Queue({
  jobs,
  view,
  onView,
  onCancel,
  onReveal,
  onRemove,
  onAgain,
  onCopy,
  onClear,
  onPause,
  onResume,
}: {
  jobs: Job[];
  view: QueueView;
  onView: (v: QueueView) => void;
  onCancel: (id: number) => void;
  onReveal: (path: string) => void;
  /** `withFile` also sends the downloaded file to the Trash. */
  onRemove: (id: number, withFile: boolean) => void;
  /** Load this link back into the card to run it with different settings. */
  onAgain: (url: string) => void;
  onCopy: (url: string) => void;
  onClear: () => void;
  onPause: (id: number) => void;
  onResume: (id: number) => void;
}) {
  const s = useStrings();

  /**
   * Bento sizing: a long title earns a wider cell.
   *
   * The threshold is 60, not 38. At 38 practically every YouTube title
   * qualified, every tile spanned two tracks, and the "grid" collapsed into one
   * card per row with a ragged edge — a mosaic needs a majority of small tiles
   * to be a mosaic at all.
   */
  const span = (j: Job) => (j.title.length > 60 ? 2 : 1);

  const head = (
    <div className="queue-head">
      <span className="b-cap">{s.queue.title}</span>
      <div className="queue-views">
        {jobs.some((j) => j.state !== "running") && (
          <button className="b-btn queue-clear" onClick={onClear} title={s.queue.clear}>
            <Icon name="clear" size={14} />
          </button>
        )}
        <button
          className={`b-btn ${view === "list" ? "on" : ""}`}
          onClick={() => onView("list")}
          title={s.queue.viewList}
        >
          <Icon name="list" size={14} />
        </button>
        <button
          className={`b-btn ${view === "bento" ? "on" : ""}`}
          onClick={() => onView("bento")}
          title={s.queue.viewBento}
        >
          <Icon name="grid" size={14} />
        </button>
      </div>
    </div>
  );

  if (jobs.length === 0) {
    return (
      <div className="queue">
        {head}
        <p className="queue-empty b-mono">{s.queue.empty}</p>
      </div>
    );
  }

  return (
    <div className={`queue queue--${view}`}>
      {head}
      <div className={view === "bento" ? "bento" : "rows"}>
        {jobs.map((j) => (
          <JobRow
            key={j.id}
            job={j}
            span={view === "bento" ? span(j) : null}
            onCancel={onCancel}
            onReveal={onReveal}
            onRemove={onRemove}
            onAgain={onAgain}
            onCopy={onCopy}
            onPause={onPause}
            onResume={onResume}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One row, memoised.
 *
 * A progress event replaces the whole `jobs` array, so without this every tick
 * re-rendered every row in the list — including the finished ones, which cannot
 * have changed. With several downloads running that is the bulk of the work the
 * interface does while it should be feeling smooth.
 */
const JobRow = memo(function JobRow({
  job: j,
  span,
  onCancel,
  onReveal,
  onRemove,
  onAgain,
  onCopy,
  onPause,
  onResume,
}: {
  job: Job;
  /** Grid width in bento mode; null in list mode. */
  span: number | null;
  onCancel: (id: number) => void;
  onReveal: (path: string) => void;
  onRemove: (id: number, withFile: boolean) => void;
  onAgain: (url: string) => void;
  onCopy: (url: string) => void;
  onPause: (id: number) => void;
  onResume: (id: number) => void;
}) {
  const s = useStrings();
  const file = j.kind === "file";
  // A half-done file is still on disk and can carry on, whether it was paused
  // or stopped by an error.
  const canResume = file && (j.state === "paused" || j.state === "failed" || j.state === "cancelled");
  // An unknown total is normal for live streams and some extractors, so
  // the bar goes indeterminate rather than pretending to a percentage.
  const pct = j.total ? Math.min(100, (j.downloaded / j.total) * 100) : null;
  // Nothing has arrived yet: yt-dlp is still talking to the site.
  const warmup = j.state === "running" && j.downloaded === 0;
  const link = originalLink(j);

  return (
    <div
      className={`job b-panel ${j.state} ${warmup ? "warmup" : ""}`}
      style={span === null ? undefined : { gridColumn: `span ${span}` }}
    >
      <div className="job-head">
        {j.thumbnail ? (
          <img className="job-thumb" src={j.thumbnail} alt="" loading="lazy" />
        ) : (
          <span className="job-thumb job-thumb--none" />
        )}
        <span className="job-title">{j.title}</span>
        {link && (
          <button
            type="button"
            className="job-source job-link b-mono"
            title={link}
            onClick={() => openUrl(link)}
          >
            {s.queue.original}
          </button>
        )}
      </div>

      {j.state === "running" && (
        <>
          <div className="job-bar">
            <span
              className={`job-fill ${pct === null ? "indet" : ""}`}
              style={pct === null ? undefined : { width: `${pct}%` }}
            />
          </div>
          <div className="job-nums b-mono">
            <span>
              {bytes(j.downloaded)} {j.total ? `${s.queue.of} ${bytes(j.total)}` : ""}
            </span>
            <span>{speed(j.speed)}</span>
            <span>
              {s.queue.eta} {eta(j.eta)}
            </span>
            {j.stage && <span>{j.stage}</span>}
            {file && !!j.conns && <span>{s.files.threads(j.conns)}</span>}
          </div>
          {j.status && <div className="job-status b-mono">{j.status}</div>}
        </>
      )}

      {j.state !== "running" && (
        <div className="job-nums b-mono">
          <span>
            {j.state === "done" && <><Icon name="ok" size={13} /> {s.queue.done}</>}
            {j.state === "failed" && <><Icon name="warn" size={13} /> {s.queue.failed}</>}
            {j.state === "cancelled" && <><Icon name="stop" size={13} /> {s.queue.cancelled}</>}
            {j.state === "paused" && <><Icon name="pause" size={13} /> {s.queue.paused}</>}
          </span>
          {file && j.state !== "done" && j.total ? (
            <span>
              {bytes(j.downloaded)} {s.queue.of} {bytes(j.total)}
            </span>
          ) : null}
          {j.error && <span className="job-err">{j.error}</span>}
        </div>
      )}

      <div className="job-act">
        {j.state === "running" && file ? (
          // Without ranges a pause can only start over, so it says "stop".
          <button className="b-btn" onClick={() => onPause(j.id)}>
            <Icon name={j.ranges ? "pause" : "stop"} />{" "}
            <span className="btn-label">{j.ranges ? s.queue.pause : s.queue.cancel}</span>
          </button>
        ) : j.state === "running" ? (
          <button className="b-btn" onClick={() => onCancel(j.id)}>
            <Icon name="stop" /> <span className="btn-label">{s.queue.cancel}</span>
          </button>
        ) : (
          <>
            {canResume && (
              <button className="b-btn" onClick={() => onResume(j.id)}>
                <Icon name="play" /> <span className="btn-label">{s.queue.resume}</span>
              </button>
            )}
            {j.path && (
              <button className="b-btn" onClick={() => onReveal(j.path!)}>
                <Icon name="reveal" /> <span className="btn-label">{s.queue.reveal}</span>
              </button>
            )}
            {/* The point of keeping the row around: the settings were
                wrong, not the link. */}
            <button className="b-btn" onClick={() => onCopy(j.url)} title={s.queue.copy}>
              <Icon name="copy" /> <span className="btn-label">{s.queue.copy}</span>
            </button>
            <button className="b-btn" onClick={() => onAgain(j.url)}>
              <Icon name="sliders" /> <span className="btn-label">{s.queue.again}</span>
            </button>
            {/* Held down, the same button also puts the file in the Trash —
                said out loud in the tooltip, because a modifier nobody knows
                about is the same as a feature that isn't there. */}
            <button
              className="b-btn"
              title={canResume ? s.queue.removePart : j.path ? s.queue.removeWithFile : s.queue.remove}
              onClick={(e) => onRemove(j.id, (e.metaKey || e.ctrlKey) && !!j.path)}
            >
              <Icon name="remove" /> <span className="btn-label">{s.queue.remove}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
});

