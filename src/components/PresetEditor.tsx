import { useStrings } from "../lib/i18n";
import { newPreset, type CustomPreset } from "../lib/settings";
import { FlagsInput } from "./FlagsInput";
import { Icon } from "./Icon";

const HEIGHTS = [null, 2160, 1440, 1080, 720, 480] as const;
const CONTAINERS = ["mp4", "mkv", "mov", "webm"] as const;
const VCODECS = ["auto", "h264", "vp9", "av01"] as const;
const ACODECS = ["auto", "aac", "opus", "mp3"] as const;
const AUDIO = ["m4a", "mp3", "wav", "flac", "opus"] as const;

/**
 * Presets, assembled by hand.
 *
 * The four built-in ones answer the four questions most people have; this is
 * for the fifth. It offers exactly the knobs the download card already has,
 * because a preset is only worth saving if it produces the same file as doing
 * it by hand — a separate, more powerful vocabulary here would be a second way
 * to get a different result.
 */
export function PresetEditor({
  presets,
  onChange,
}: {
  presets: CustomPreset[];
  onChange: (next: CustomPreset[]) => void;
}) {
  const s = useStrings();

  const patch = (id: string, p: Partial<CustomPreset>) =>
    onChange(presets.map((x) => (x.id === id ? { ...x, ...p } : x)));

  return (
    <div className="pe">
      {presets.length === 0 && <p className="settings-hint">{s.settings.presetEmpty}</p>}

      {presets.map((p) => (
        <div key={p.id} className="pe-card b-panel">
          <div className="pe-top">
            <input
              className="pe-name"
              value={p.name}
              placeholder={s.settings.presetName}
              onChange={(e) => patch(p.id, { name: e.target.value })}
            />
            <button
              className="b-btn"
              title={s.settings.presetDelete}
              onClick={() => onChange(presets.filter((x) => x.id !== p.id))}
            >
              <Icon name="remove" size={14} />
            </button>
          </div>

          <div className="pe-grid">
            <label className="pe-field">
              <span className="b-cap">{s.settings.presetKind}</span>
              <select
                className="pe-select"
                value={p.kind}
                onChange={(e) => patch(p.id, { kind: e.target.value as CustomPreset["kind"] })}
              >
                <option value="video">{s.settings.presetVideo}</option>
                <option value="audio">{s.settings.presetAudio}</option>
              </select>
            </label>

            {p.kind === "video" ? (
              <>
                <label className="pe-field">
                  <span className="b-cap">{s.settings.presetHeight}</span>
                  <select
                    className="pe-select"
                    value={p.maxHeight ?? ""}
                    onChange={(e) =>
                      patch(p.id, { maxHeight: e.target.value ? Number(e.target.value) : null })
                    }
                  >
                    {HEIGHTS.map((h) => (
                      <option key={h ?? "any"} value={h ?? ""}>
                        {h ? `${h}p` : s.settings.presetHeightAny}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="pe-field">
                  <span className="b-cap">{s.fmt.container}</span>
                  <select
                    className="pe-select"
                    value={p.container}
                    onChange={(e) => patch(p.id, { container: e.target.value })}
                  >
                    {CONTAINERS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="pe-field">
                  <span className="b-cap">{s.opts.codec}</span>
                  <select
                    className="pe-select"
                    value={p.vcodec}
                    onChange={(e) => patch(p.id, { vcodec: e.target.value })}
                  >
                    {VCODECS.map((c) => (
                      <option key={c} value={c}>
                        {c === "auto" ? s.opts.codecAuto : c}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="pe-field">
                  <span className="b-cap">{s.opts.acodec}</span>
                  <select
                    className="pe-select"
                    value={p.acodec}
                    onChange={(e) => patch(p.id, { acodec: e.target.value })}
                  >
                    {ACODECS.map((c) => (
                      <option key={c} value={c}>
                        {c === "auto" ? s.opts.codecAuto : c}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <label className="pe-field">
                <span className="b-cap">{s.fmt.audio}</span>
                <select
                  className="pe-select"
                  value={p.audioFormat}
                  onChange={(e) => patch(p.id, { audioFormat: e.target.value })}
                >
                  {AUDIO.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <label className="pe-field pe-wide">
            <span className="b-cap">{s.settings.presetFlags}</span>
            <FlagsInput
              value={p.extraArgs}
              onChange={(v) => patch(p.id, { extraArgs: v })}
              className="settings-input"
            />
          </label>
        </div>
      ))}

      <button
        className="b-btn b-btn--solid pe-add"
        onClick={() => onChange([...presets, newPreset(s.settings.presetNew)])}
      >
        <Icon name="plus" size={14} /> {s.settings.presetAdd}
      </button>
    </div>
  );
}
