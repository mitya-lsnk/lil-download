import { useEffect } from "react";

/**
 * One-line transient message. Errors stay until dismissed; confirmations fade,
 * because a toast that outlives the action it describes starts covering the
 * picture you came here to look at.
 */
export function Toast({
  message,
  kind = "info",
  onClose,
}: {
  message: string;
  kind?: "info" | "error";
  onClose: () => void;
}) {
  useEffect(() => {
    if (kind === "error") return;
    const t = setTimeout(onClose, 3200);
    return () => clearTimeout(t);
  }, [message, kind, onClose]);

  return (
    <div className={`toast ${kind === "error" ? "err" : ""}`} role="status">
      <span>{message}</span>
      <button onClick={onClose}>✕</button>
    </div>
  );
}
