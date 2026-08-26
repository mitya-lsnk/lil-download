import { SKINS, useSkin } from "../lib/skin";
import { useStrings } from "../lib/i18n";

/** Compact swatch row for the header. */
export function SkinPicker() {
  const { skin, setSkin } = useSkin();
  const str = useStrings();
  return (
    <div className="skin-pick" role="group" aria-label={str.settings.appearance}>
      {SKINS.map((sk) => {
        const meta = str.skins[sk.id];
        return (
          <button
            key={sk.id}
            className={`skin-chip ${skin === sk.id ? "active" : ""}`}
            onClick={() => setSkin(sk.id)}
            title={meta.name}
            aria-pressed={skin === sk.id}
          >
            <span
              className="skin-sw"
              style={{
                background: `linear-gradient(135deg, ${sk.swatch[0]} 0 50%, ${sk.swatch[1]} 50% 100%)`,
              }}
            />
          </button>
        );
      })}
    </div>
  );
}
