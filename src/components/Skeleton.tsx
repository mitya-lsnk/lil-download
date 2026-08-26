import { useStrings } from "../lib/i18n";
import { Icon } from "./Icon";

/**
 * Stand-ins for content that's on its way.
 *
 * The probe is a full extractor run against the site — seconds, sometimes many
 * — and a flat empty screen for that long reads as a hang. What's known already
 * is drawn for real: the poster frame when the link is one we can derive it
 * from, and the site it came from. Only the parts that genuinely require
 * asking are shapes.
 */
export function CardSkeleton({
  thumb,
  source,
}: {
  /** Poster we could work out from the link alone, if any. */
  thumb?: string | null;
  source?: string | null;
}) {
  const s = useStrings();
  return (
    <div className="card b-panel skel-card" aria-busy="true" aria-live="polite">
      <div className="card-top">
        {thumb ? (
          <img className="card-thumb" src={thumb} alt="" loading="eager" />
        ) : (
          <div className="skel skel-thumb" />
        )}
        <div className="card-meta skel-meta">
          <div className="skel skel-line wide" />
          <div className="skel skel-line" />
          {source && <span className="card-source b-mono">{source}</span>}
        </div>
      </div>
      <span className="skel-caption b-mono">
        <Icon name="busy" className="spin" /> {s.app.checking}
      </span>
    </div>
  );
}

/**
 * Cold start, and only when there is genuinely nothing to draw.
 *
 * On any launch after the first the tool status is remembered, the window comes
 * up complete, and this never appears.
 */
export function BootScreen() {
  const s = useStrings();
  return (
    <div className="boot" aria-busy="true">
      <span className="b-display boot-name">{s.app.name}</span>
      <span className="b-mono boot-note">
        <Icon name="busy" className="spin" /> {s.app.starting}
      </span>
    </div>
  );
}
