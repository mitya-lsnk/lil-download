/** Human-readable sizes, speeds and durations. */

export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  const u = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  // One decimal below 10 keeps "1.4 ГБ" readable without pretending to precision.
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

export function speed(bytesPerSec: number | null | undefined): string {
  if (!bytesPerSec) return "—";
  return `${bytes(bytesPerSec)}/с`;
}

/** 3661 → "1:01:01", 142 → "2:22". */
export function duration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !isFinite(sec)) return "—";
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Seconds remaining, phrased short: "4 мин", "38 с". */
export function eta(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !isFinite(sec)) return "—";
  if (sec < 60) return `${Math.round(sec)} с`;
  if (sec < 3600) return `${Math.round(sec / 60)} мин`;
  return `${(sec / 3600).toFixed(1)} ч`;
}
