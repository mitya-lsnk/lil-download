import { SKINS, useSkin } from "../lib/skin";
import { useStrings } from "../lib/i18n";
import { Icon } from "./Icon";

/**
 * Choosing a skin, the same way in all three apps.
 *
 * Cards rather than a row of swatches. A 20 px square says which two colours a
 * skin leans on and nothing else — not its name, not that it is the one
 * currently on. Three of the four skins differ mostly in weight and border,
 * which a swatch cannot show at all; the card at least gives the name room and
 * says out loud which one is selected.
 */
export function SkinCards() {
  const { skin, setSkin } = useSkin();
  const s = useStrings();

  return (
    <div className="skin-grid" role="radiogroup" aria-label={s.settings.skin}>
      {SKINS.map((sk) => {
        const on = skin === sk.id;
        return (
          <button
            key={sk.id}
            role="radio"
            aria-checked={on}
            className={`skin-card ${on ? "active" : ""}`}
            onClick={() => setSkin(sk.id)}
          >
            <span
              className="skin-card-sw"
              style={{
                background: `linear-gradient(135deg, ${sk.swatch[0]} 0 50%, ${sk.swatch[1]} 50% 100%)`,
              }}
            />
            <span className="skin-card-name">{s.skins[sk.id].name}</span>
            {on && (
              <span className="skin-card-on">
                <Icon name="ok" size={11} /> {s.settings.chosen}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
