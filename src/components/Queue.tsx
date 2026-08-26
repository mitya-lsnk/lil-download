import { memo } from "react";

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
  state: "running" | "done" | "failed" | "cancelled";
  downloaded: number;
  total: number | null;
  speed: number | null;
  eta: number | null;
  stage: string;
  status: string;
  path: string | null;
  error: string | null;
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
}: {
  jobs: Job[];
  view: QueueView;
  onView: (v: QueueView) => void;
  onCancel: (id: number) => void;
  onReveal: (path: string) => void;
  onRemove: (id: number) => void;
  /** Load this link back into the card to run it with different settings. */
  onAgain: (url: string) => void;
  onCopy: (url: string) => void;
  onClear: () => void;
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
}: {
  job: Job;
  /** Grid width in bento mode; null in list mode. */
  span: number | null;
  onCancel: (id: number) => void;
  onReveal: (path: string) => void;
  onRemove: (id: number) => void;
  onAgain: (url: string) => void;
  onCopy: (url: string) => void;
}) {
  const s = useStrings();
  // An unknown total is normal for live streams and some extractors, so
  // the bar goes indeterminate rather than pretending to a percentage.
  const pct = j.total ? Math.min(100, (j.downloaded / j.total) * 100) : null;
  // Nothing has arrived yet: yt-dlp is still talking to the site.
  const warmup = j.state === "running" && j.downloaded === 0;

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
        <span className="job-source b-mono">{j.source}</span>
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
          </span>
          {j.error && <span className="job-err">{j.error}</span>}
        </div>
      )}

      <div className="job-act">
        {j.state === "running" ? (
          <button className="b-btn" onClick={() => onCancel(j.id)}>
            <Icon name="stop" /> <span className="btn-label">{s.queue.cancel}</span>
          </button>
        ) : (
          <>
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
            <button className="b-btn" onClick={() => onRemove(j.id)}>
              <Icon name="remove" /> <span className="btn-label">{s.queue.remove}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
});

