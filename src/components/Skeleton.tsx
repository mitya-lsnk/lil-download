import { useStrings } from "../lib/i18n";
import { Icon } from "./Icon";

/**
 * Stand-ins for content that's on its way.
 *
 * Both the cold start and the metadata probe take a couple of seconds against
 * the network, and an app that shows a flat empty screen for that long reads as
 * hung. A shape in roughly the right place says "working" without lying about
 * how far along it is.
 */
export function CardSkeleton() {
  const s = useStrings();
  return (
    <div className="card b-panel skel-card" aria-busy="true" aria-live="polite">
      <div className="card-top">
        <div className="skel skel-thumb" />
        <div className="card-meta skel-meta">
          <div className="skel skel-line wide" />
          <div className="skel skel-line" />
        </div>
      </div>
      <span className="skel-caption b-mono">
        <Icon name="busy" className="spin" /> {s.app.checking}
      </span>
    </div>
  );
}

/** Cold start: the tool check hasn't come back yet. */
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
