import { invoke } from "@tauri-apps/api/core";

/**
 * The Tauri bridge only exists inside the app window. Running `npm run dev` in a
 * plain browser is still useful for styling the chrome, so every call site
 * checks this instead of throwing.
 */
export function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** `invoke`, but a no-op-ish rejection in the browser rather than a crash. */
export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauri()) throw new Error(`${cmd}: доступно только в приложении`);
  return invoke<T>(cmd, args);
}
