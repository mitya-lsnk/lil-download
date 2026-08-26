import { useState } from "react";

import { useStrings } from "../lib/i18n";
import { Icon } from "./Icon";

/**
 * What the chosen skin actually looks like.
 *
 * Four swatches say which colours a skin uses and nothing about how it feels —
 * and the four here differ far more in weight, borders and shadow than in hue.
 * This is the same handful of controls the app is built out of, live, so the
 * choice can be made by looking rather than by switching and going back.
 */
export function SkinPreview() {
  const s = useStrings();
  const [on, setOn] = useState(true);

  return (
    <div className="sp b-panel">
      <div className="sp-head">
        <span className="b-display sp-title">{s.app.name}</span>
        <span className="b-mono sp-tag">{s.app.tagline}</span>
      </div>

      <div className="sp-row">
        <button className="b-btn b-btn--solid">
          <Icon name="download" size={14} /> {s.card.download}
        </button>
        <button className="b-btn">
          <Icon name="folder" size={14} /> {s.setup.choose}
        </button>
        <button className="b-btn b-btn--yellow">{s.update.update}</button>
      </div>

      <div className="sp-row">
        <span className="tb-chip g-required">{s.tpl.groups.required}</span>
        <span className="tb-chip g-channel">{s.tpl.groups.channel}</span>
        <span className="tb-chip g-meta">{s.tpl.groups.meta}</span>
      </div>

      <div className="sp-row">
        <input className="settings-input sp-input" defaultValue="https://youtu.be/…" readOnly />
        <label className="sp-check">
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
          <span>{s.opts.sponsorblock}</span>
        </label>
      </div>

      <div className="sp-bar">
        <span className="sp-bar-fill" />
      </div>
    </div>
  );
}
