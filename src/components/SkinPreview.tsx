import { useState } from "react";

import { Icon } from "./Icon";

/**
 * What the chosen skin actually looks like.
 *
 * Four swatches say which colours a skin uses and nothing about how it feels —
 * and the skins differ far more in weight, borders and shadow than in hue. This
 * is the same handful of controls the app is built out of, live, so the choice
 * can be made by looking rather than by switching and going back.
 *
 * The words come from the caller because they are decoration: this shows how
 * things are drawn, not what they say, and every app in the set has different
 * buttons. Passing real strings keeps the preview translated without inventing
 * dictionary keys that exist only to be looked at here.
 */
export function SkinPreview({
  name,
  words,
}: {
  /** The product name, drawn in the display face. Never translated. */
  name: string;
  words: { primary: string; secondary: string; accent: string; check: string };
}) {
  const [on, setOn] = useState(true);

  return (
    <div className="sp b-panel">
      <div className="sp-head">
        <span className="b-display sp-title">{name}</span>
      </div>

      <div className="sp-row">
        <button className="b-btn b-btn--solid">
          <Icon name="download" size={14} /> {words.primary}
        </button>
        <button className="b-btn">
          <Icon name="folder" size={14} /> {words.secondary}
        </button>
        <button className="b-btn b-btn--yellow">{words.accent}</button>
      </div>

      <div className="sp-row">
        <span className="sp-chip on">A</span>
        <span className="sp-chip">B</span>
        <span className="sp-chip muted">C</span>
        <label className="sp-check">
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
          <span>{words.check}</span>
        </label>
      </div>

      <div className="sp-bar">
        <span className="sp-bar-fill" />
      </div>
    </div>
  );
}
