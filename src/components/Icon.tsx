import {
  Check,
  Code,
  Copy,
  Eraser,
  LayoutGrid,
  List,
  ChevronDown,
  ClipboardPaste,
  Image,
  Cookie,
  Download,
  Folder,
  FolderOpen,
  Loader,
  Moon,
  Plus,
  RefreshCw,
  Scissors,
  Settings,
  Sun,
  SlidersHorizontal,
  Square,
  Subtitles,
  Tag,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

/**
 * The suite's icon vocabulary, in one place.
 *
 * Two decisions worth writing down. First, icons are a *named set* rather than
 * direct imports at each call site: one file decides what "stop" looks like, so
 * lil edit and lil view can adopt the same names and stay in step — the reason
 * the old unicode glyphs were kept consistent by hand, now enforced by the type.
 *
 * Second, they are drawn with **square caps and mitred joins at 2.5**, not
 * Lucide's default rounded 2. The suite's panels have 3 px square borders and
 * heavy display type; rounded hairlines read as a different product. Same pack,
 * different pen.
 */
const SET = {
  download: Download,
  paste: ClipboardPaste,
  cookie: Cookie,
  folder: Folder,
  reveal: FolderOpen,
  settings: Settings,
  refresh: RefreshCw,
  stop: Square,
  close: X,
  remove: Trash2,
  ok: Check,
  warn: TriangleAlert,
  chevron: ChevronDown,
  trim: Scissors,
  subs: Subtitles,
  sponsor: Tag,
  busy: Loader,
  list: List,
  grid: LayoutGrid,
  sliders: SlidersHorizontal,
  image: Image,
  code: Code,
  copy: Copy,
  clear: Eraser,
  plus: Plus,
  sun: Sun,
  moon: Moon,
} as const;

export type IconName = keyof typeof SET;

export function Icon({
  name,
  size = 16,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const Glyph = SET[name];
  return (
    <Glyph
      size={size}
      strokeWidth={2.5}
      // Rotation for the spinner is correct by construction here: an SVG has a
      // square box, so it turns on its own axis. The text glyph it replaces did
      // not, which is why the old spinner orbited instead of spinning.
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={className}
      aria-hidden="true"
    />
  );
}
