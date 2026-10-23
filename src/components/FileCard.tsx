import { useStrings } from "../lib/i18n";
import { bytes } from "../lib/format";
import type { FileInfo } from "../lib/api";
import { Icon } from "./Icon";

/**
 * A plain file, shown before it downloads (PLAN §13).
 *
 * Much less than MediaCard: there is no format to choose from a file. What's
 * left is the name — servers hand out "download.php" often enough that it has
 * to be editable — the folder, and whether a dropped connection will cost
 * everything, which is the one thing worth knowing before a 4 GB download.
 */
export function FileCard({
  info,
  source,
  name,
  onName,
  threads,
  dest,
  destReason,
  onPickDest,
  rememberFolder,
  onRememberFolder,
  rememberSource,
  onRememberSource,
  onDownload,
  onToVideo,
  onClear,
}: {
  info: FileInfo;
  source: string;
  name: string;
  onName: (v: string) => void;
  threads: number;
  dest: string | null;
  destReason: "rule" | "last" | "default" | "os";
  onPickDest: () => void;
  rememberFolder: boolean;
  onRememberFolder: (v: boolean) => void;
  rememberSource: boolean;
  onRememberSource: (v: boolean) => void;
  onDownload: () => void;
  onToVideo: () => void;
  onClear: () => void;
}) {
  const s = useStrings();

  return (
    <div className="card b-panel">
      <button className="card-x" onClick={onClear} title={s.card.clear}>
        <Icon name="close" />
      </button>

      {info.page ? (
        <div className="note">
          <span>{s.files.page}</span>
          <button className="b-btn" onClick={onToVideo}>
            {s.files.toVideo}
          </button>
        </div>
      ) : (
        <>
          <label className="file-name">
            <span className="b-cap">{s.files.name}</span>
            <input
              className="settings-input b-mono"
              value={name}
              spellCheck={false}
              onChange={(e) => onName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && dest && name.trim() && onDownload()}
            />
          </label>
          <div className="card-facts b-mono">
            <span>{info.size === null ? s.files.unknownSize : bytes(info.size)}</span>
            <span className="card-source">{source}</span>
            {info.ranges && (
              <span>
                {s.files.resumable} · {s.files.threads(threads)}
              </span>
            )}
          </div>
          {!info.ranges && <div className="file-warn b-mono">{s.files.noResume}</div>}

          <div className="card-dest">
            <span className="b-cap">{s.card.dest}</span>
            <button className="dest-path b-mono" onClick={onPickDest} title={dest ?? ""}>
              <Icon name="folder" size={14} /> {dest ?? "—"}
            </button>
            {destReason === "rule" && (
              <span className="dest-why b-mono">{`правило ${source}`}</span>
            )}
          </div>

          <div className="card-remember">
            <label>
              <input
                type="checkbox"
                checked={rememberFolder}
                onChange={(e) => onRememberFolder(e.target.checked)}
              />
              {s.card.rememberFolder}
            </label>
            <label>
              <input
                type="checkbox"
                checked={rememberSource}
                onChange={(e) => onRememberSource(e.target.checked)}
              />
              {s.card.rememberSource} ({source})
            </label>
          </div>

          <button
            className="b-btn b-btn--yellow card-go"
            disabled={!dest || !name.trim()}
            onClick={onDownload}
          >
            <Icon name="download" /> {s.card.download}
          </button>
        </>
      )}
    </div>
  );
}
