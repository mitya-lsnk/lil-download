import { useSkin } from "../lib/skin";
import { useStrings } from "../lib/i18n";
import { Icon } from "./Icon";

/** Sun/moon switch for the header — flips the light/dark axis. */
export function ModeToggle() {
  const { mode, toggleMode } = useSkin();
  const s = useStrings();
  const dark = mode === "dark";
  return (
    <button
      className="b-btn"
      onClick={toggleMode}
      title={dark ? s.mode.toLightTitle : s.mode.toDarkTitle}
      aria-label={dark ? s.mode.toLightAria : s.mode.toDarkAria}
      aria-pressed={dark}
    >
      <Icon name={dark ? "moon" : "sun"} />
    </button>
  );
}

/**
 * The same choice, spelled out.
 *
 * The header toggle is a single unlabelled button that flips between two
 * states — right for something used mid-session, wrong as the only place the
 * setting exists. Appearance is where someone goes looking for it, and there it
 * should say what the options are rather than make you press to find out.
 */
export function ModeChoice({ label }: { label?: string }) {
  const { mode, setMode } = useSkin();
  const s = useStrings();
  const options = [
    ["light", s.mode.light, "sun"],
    ["dark", s.mode.dark, "moon"],
  ] as const;

  return (
    <div className="mode-choice" role="group" aria-label={label}>
      {options.map(([id, label, icon]) => (
        <button
          key={id}
          className={`mode-choice-btn ${mode === id ? "on" : ""}`}
          aria-pressed={mode === id}
          onClick={() => setMode(id)}
        >
          <Icon name={icon} size={14} /> {label}
        </button>
      ))}
    </div>
  );
}
