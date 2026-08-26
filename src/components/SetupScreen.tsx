import { type ToolPaths, type ToolStatus } from "../lib/api";
import { useStrings } from "../lib/i18n";
import { ToolsPanel } from "./ToolsPanel";

/**
 * First run only. Once yt-dlp is present this screen is never forced again —
 * the same controls live on in Settings, where they belong for the long run.
 */
export function SetupScreen({
  tools,
  paths,
  onRefresh,
  onSkip,
  onPickPath,
}: {
  tools: ToolStatus[];
  paths: ToolPaths;
  onRefresh: () => void;
  onSkip: () => void;
  onPickPath: (tool: "ytdlp" | "ffmpeg", path: string) => void;
}) {
  const s = useStrings();
  const ready = tools.find((t) => t.tool === "yt-dlp")?.found ?? false;

  return (
    <div className="setup">
      <div className="setup-head">
        <h1 className="b-display">{s.setup.title}</h1>
        <p className="setup-why">{s.setup.why}</p>
      </div>

      <ToolsPanel tools={tools} paths={paths} onRefresh={onRefresh} onPickPath={onPickPath} />

      <div className="setup-foot">
        <button className="b-btn b-btn--solid" disabled={!ready} onClick={onSkip}>
          {ready ? s.setup.ready : s.setup.later} →
        </button>
      </div>
    </div>
  );
}
