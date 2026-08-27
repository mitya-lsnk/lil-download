import { useStrings } from "../lib/i18n";
import { ModeChoice } from "./ModeToggle";
import { SkinCards } from "./SkinCards";
import { SkinPreview } from "./SkinPreview";

/**
 * The whole Appearance section, as one component.
 *
 * It exists because the previous attempt at "make these three look the same"
 * was three hand-copied blocks, and they drifted immediately: different
 * container, different label case, different column count, and — best of all —
 * three different sets of names for the same four skins. Anything assembled by
 * hand in three places will differ in three places. This is assembled once.
 *
 * The only per-app inputs are the product name and four words for the preview,
 * because those genuinely differ; everything else is identical by construction.
 */
export function AppearancePanel({
  name,
  words,
}: {
  name: string;
  words: { primary: string; secondary: string; accent: string; check: string };
}) {
  const s = useStrings();

  return (
    <section className="ap">
      <h2 className="ap-h">{s.settings.appearance}</h2>
      <p className="ap-lead">{s.settings.appearanceLead}</p>

      <div className="ap-field">
        <span className="ap-lbl">{s.settings.theme}</span>
        <ModeChoice label={s.settings.theme} />
      </div>

      <div className="ap-field">
        <span className="ap-lbl">{s.settings.skin}</span>
        <SkinCards />
      </div>

      <SkinPreview name={name} words={words} />
    </section>
  );
}
