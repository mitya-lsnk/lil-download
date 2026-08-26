import { useState } from "react";

import { type ToolPaths, type ToolStatus } from "../lib/api";
import { useStrings } from "../lib/i18n";
import { ratePerSecond, type Prefs, type RateUnit } from "../lib/settings";
import { bytes } from "../lib/format";
import { FlagsInput } from "./FlagsInput";
import { Icon } from "./Icon";
import { ModeChoice } from "./ModeToggle";
import { PresetEditor } from "./PresetEditor";
import { SkinPicker } from "./SkinPicker";
import { SkinPreview } from "./SkinPreview";
import { TemplateBuilder } from "./TemplateBuilder";
import { ToolsPanel } from "./ToolsPanel";

export type Tab = "tools" | "download" | "presets" | "look";

/**
 * Everything that isn't a download.
 *
 * Tabs rather than one long page, in the order things are actually needed: the
 * two programs first, because nothing works until they're there, and the skins
 * last, because that's a once-a-month decision. It also fixes the thing that
 * made the old page tiring — the way back sat at the top, so leaving meant
 * scrolling up through everything you'd just walked past. The header stays put
 * now, and each tab is short enough to read without scrolling at all.
 */
export function SettingsScreen({
  tools,
  paths,
  prefs,
  onSet,
  onRefresh,
  onPickPath,
  onClose,
  initialTab = "tools",
}: {
  tools: ToolStatus[];
  paths: ToolPaths;
  prefs: Prefs;
  onSet: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void;
  onRefresh: () => void;
  onPickPath: (tool: "ytdlp" | "ffmpeg", path: string) => void;
  onClose: () => void;
  /** Which tab to land on — the quality menu sends people straight to presets. */
  initialTab?: Tab;
}) {
  const s = useStrings();
  const [tab, setTab] = useState<Tab>(initialTab);

  const TABS: [Tab, string][] = [
    ["tools", s.settings.tabTools],
    ["download", s.settings.tabDownload],
    ["presets", s.settings.tabPresets],
    ["look", s.settings.tabLook],
  ];

  return (
    <div className="app-shell">
      <header className="head settings-bar" data-tauri-drag-region>
        <button className="b-btn" onClick={onClose}>
          <Icon name="chevron" size={14} className="rot90" /> {s.settings.back}
        </button>
        <span className="head-name b-display">{s.settings.title}</span>
        <span className="head-sp" />
        <nav className="settings-tabs">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              className={`b-btn ${tab === id ? "on" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="main">
        <div className="main-col settings-col">
          {tab === "tools" && (
            <section className="settings-block">
              <ToolsPanel
                tools={tools}
                paths={paths}
                channels={{ ytdlp: prefs.ytdlpChannel, ffmpeg: prefs.ffmpegChannel }}
                onChannel={(tool, ch) =>
                  onSet(tool === "ytdlp" ? "ytdlpChannel" : "ffmpegChannel", ch)
                }
                onRefresh={onRefresh}
                onPickPath={onPickPath}
              />
            </section>
          )}

          {tab === "download" && (
            <section className="settings-block">
              <div className="settings-field">
                <span>{s.settings.template}</span>
                <TemplateBuilder value={prefs.template} onChange={(v) => onSet("template", v)} />
                <span className="settings-hint">{s.settings.templateHint}</span>
              </div>

              <div className="settings-field">
                <span>{s.settings.limit}</span>
                <div className="lim">
                  <input
                    className="settings-input lim-num b-mono"
                    type="number"
                    min={0}
                    step={1}
                    placeholder="0"
                    value={prefs.limitRate ?? ""}
                    onChange={(e) =>
                      onSet("limitRate", e.target.value ? Number(e.target.value) : null)
                    }
                  />
                  <div className="lim-units">
                    {(["K", "M", "Mbit"] as const).map((u) => (
                      <button
                        key={u}
                        className={`lim-unit ${prefs.limitUnit === u ? "on" : ""}`}
                        onClick={() => onSet("limitUnit", u as RateUnit)}
                      >
                        {s.settings.units[u]}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Megabits are what connections are sold in and megabytes are
                    what files are measured in; saying the conversion out loud
                    is cheaper than letting someone find it out by waiting. */}
                <span className="settings-hint">
                  {prefs.limitRate
                    ? `≈ ${bytes(ratePerSecond(prefs.limitRate, prefs.limitUnit) ?? 0)}/${s.settings.perSecond}`
                    : s.settings.limitHint}
                </span>
              </div>

              <label className="settings-field">
                <span>{s.settings.extraArgs}</span>
                <FlagsInput
                  value={prefs.extraArgs}
                  onChange={(v) => onSet("extraArgs", v)}
                  className="settings-input"
                />
                {/* Said plainly: these go last and beat the preset. Someone
                    opening this field is doing so precisely to override something. */}
                <span className="settings-hint">{s.settings.extraArgsHint}</span>
              </label>
            </section>
          )}

          {tab === "presets" && (
            <section className="settings-block">
              <span className="settings-hint">{s.settings.presetsHint}</span>
              <PresetEditor presets={prefs.presets} onChange={(v) => onSet("presets", v)} />
            </section>
          )}

          {tab === "look" && (
            <section className="settings-block">
              <div className="settings-field">
                <span>{s.settings.theme}</span>
                <ModeChoice label={s.settings.theme} />
              </div>
              <div className="settings-field">
                <span>{s.settings.skin}</span>
                <SkinPicker />
              </div>
              <SkinPreview
                name="lil download"
                words={{
                  primary: s.card.download,
                  secondary: s.setup.choose("yt-dlp"),
                  accent: s.update.update,
                  check: s.opts.sponsorblock,
                }}
              />
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
