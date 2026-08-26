import { useEffect, useRef, useState } from "react";

import type { FormatInfo } from "../lib/api";
import { useStrings } from "../lib/i18n";
import { predict } from "../lib/predict";
import { BUILTIN_PRESETS, isBuiltin, type CustomPreset, type Preset } from "../lib/settings";
import { Icon } from "./Icon";
const CONTAINERS = ["auto", "mp4", "mkv", "mov", "webm"] as const;
const AUDIO = ["m4a", "mp3", "wav", "flac", "opus"] as const;

export interface FormatChoice {
  container: string;
  audioFormat: string;
  recode: boolean;
}

/**
 * Quality and container, in one menu.
 *
 * They are two independent questions and the menu keeps them apart: the preset
 * decides *how good*, the container decides *what opens it*. Conflating them is
 * what produced the "best quality" file in .webm that macOS refuses to play —
 * the quality was right and the wrapper was useless.
 */
export function PresetPicker({
  value,
  onChange,
  format,
  onFormat,
  formats,
  custom,
  onBuild,
}: {
  value: Preset;
  onChange: (p: Preset) => void;
  format: FormatChoice;
  onFormat: (f: FormatChoice) => void;
  /** Formats of the link on screen, when there is one. */
  formats?: FormatInfo[];
  /** Presets assembled in Settings, offered after the built-in four. */
  custom: CustomPreset[];
  /** Opens Settings on the presets tab. */
  onBuild: () => void;
}) {
  const s = useStrings();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function away(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const mine = custom.find((p) => p.id === value);
  const name = isBuiltin(value) ? s.presets[value].name : (mine?.name ?? s.presets.max.name);
  // A custom preset carries its own container, so appending the global one
  // would announce a setting it doesn't obey.
  const suffix = mine ? mine.container : format.container === "auto" ? "" : format.container;
  const label = suffix && suffix !== "auto" ? `${name} · ${suffix}` : name;

  return (
    <div className="pp" ref={ref}>
      <button
        className="b-btn pp-btn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={isBuiltin(value) ? s.presets[value].note : name}
      >
        {label} <Icon name="chevron" size={14} />
      </button>

      {open && (
        <div className="pp-menu b-panel" role="listbox">
          <span className="pp-sec b-cap">{s.fmt.container}</span>
          <div className="pp-chips">
            {CONTAINERS.map((c) => (
              <button
                key={c}
                className={`pp-chip ${format.container === c ? "on" : ""}`}
                onClick={() => onFormat({ ...format, container: c })}
              >
                {c === "auto" ? s.fmt.auto : c}
              </button>
            ))}
          </div>
          {/* The honest trade-off, said where the choice is made: YouTube's
              H.264 ladder stops at 1080p, so an mp4 that plays everywhere and
              "maximum quality" are not always the same file. */}
          <p className="pp-hint">
            {format.container === "mp4" || format.container === "mov"
              ? s.fmt.mp4Hint
              : format.container === "mkv"
                ? s.fmt.mkvHint
                : s.fmt.autoHint}
          </p>

          {(format.container === "mp4" || format.container === "mov") && (
            <label className="pp-check">
              <input
                type="checkbox"
                checked={format.recode}
                onChange={(e) => onFormat({ ...format, recode: e.target.checked })}
              />
              <span>{s.fmt.recode}</span>
            </label>
          )}

          <span className="pp-sec b-cap">{s.fmt.quality}</span>
          {BUILTIN_PRESETS.map((p) => (
            <button
              key={p}
              role="option"
              aria-selected={p === value}
              className={`pp-item ${p === value ? "on" : ""}`}
              onClick={() => onChange(p)}
            >
              <span className="pp-name">{s.presets[p].name}</span>
              <span className="pp-note b-mono">{s.presets[p].note}</span>
              {/* Always technical, never empty. With a link on screen this is
                  what that link would actually give; without one it still says
                  what the preset asks for, so the menu is never just adjectives. */}
              <span className="pp-tech b-mono">
                {(formats && predict(formats, p)) ?? s.presets[p].tech}
              </span>
            </button>
          ))}

          <span className="pp-sec b-cap">{s.settings.presets}</span>
          {custom.length > 0 && (
            <>
              {custom.map((p) => (
                <button
                  key={p.id}
                  role="option"
                  aria-selected={p.id === value}
                  className={`pp-item ${p.id === value ? "on" : ""}`}
                  onClick={() => onChange(p.id)}
                >
                  <span className="pp-name">{p.name}</span>
                  {/* Its own settings, spelled out: a name alone says nothing
                      about what the file will be six months from now. */}
                  <span className="pp-tech b-mono">
                    {[
                      p.kind === "audio" ? s.settings.presetAudio : null,
                      p.maxHeight ? `≤${p.maxHeight}p` : null,
                      p.kind === "audio" ? p.audioFormat : p.container,
                      p.vcodec !== "auto" ? p.vcodec : null,
                      p.acodec !== "auto" ? p.acodec : null,
                      p.extraArgs.trim() || null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              ))}
            </>
          )}
          {/* The builder is two screens away otherwise, and nothing here would
              hint that a fifth preset is even possible. */}
          <button
            className="pp-item pp-build"
            onClick={() => {
              setOpen(false);
              onBuild();
            }}
          >
            <span className="pp-name">
              <Icon name="plus" size={13} /> {s.settings.presetAdd}
            </span>
            <span className="pp-note b-mono">{s.settings.presetsHint}</span>
          </button>

          {value === "audio" && (
            <>
              <span className="pp-sec b-cap">{s.fmt.audio}</span>
              <div className="pp-chips">
                {AUDIO.map((a) => (
                  <button
                    key={a}
                    className={`pp-chip ${format.audioFormat === a ? "on" : ""}`}
                    onClick={() => onFormat({ ...format, audioFormat: a })}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
