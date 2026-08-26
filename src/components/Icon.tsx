import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Code,
  Columns2,
  Cookie,
  Copy,
  Crop,
  Download,
  Ellipsis,
  Eraser,
  Expand,
  FlipHorizontal,
  FlipVertical,
  Folder,
  FolderOpen,
  GalleryHorizontalEnd,
  HardDrive,
  Image,
  Info,
  Layers,
  LayoutGrid,
  List,
  Loader,
  Maximize,
  Minus,
  Moon,
  PenLine,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Scaling,
  Scissors,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Square,
  Subtitles,
  Sun,
  Tag,
  Trash2,
  Undo2,
  Redo2,
  TriangleAlert,
  X,
} from "lucide-react";

/**
 * The suite's icon vocabulary, in one place.
 *
 * Two decisions worth writing down. First, icons are a *named set* rather than
 * direct imports at each call site: one file decides what "stop" looks like, so
 * lil edit, lil view and lil download stay in step — the thing the old unicode
 * glyphs were kept consistent by hand, now enforced by the type. The file is
 * identical in all three repositories; unused entries cost nothing, since the
 * bundler drops them.
 *
 * Second, they are drawn with **square caps and mitred joins at 2.5**, not
 * Lucide's default rounded 2. The suite's panels have 3 px square borders and
 * heavy display type; rounded hairlines read as a different product. Same pack,
 * different pen.
 */
const SET = {
  // shared chrome
  settings: Settings,
  close: X,
  ok: Check,
  warn: TriangleAlert,
  chevron: ChevronDown,
  prev: ChevronLeft,
  next: ChevronRight,
  busy: Loader,
  refresh: RefreshCw,
  stop: Square,
  remove: Trash2,
  clear: Eraser,
  copy: Copy,
  plus: Plus,
  minus: Minus,
  more: Ellipsis,
  info: Info,
  sun: Sun,
  moon: Moon,
  code: Code,
  sliders: SlidersHorizontal,
  folder: Folder,
  reveal: FolderOpen,
  open: FolderOpen,
  download: Download,
  image: Image,
  list: List,
  grid: LayoutGrid,
  disk: HardDrive,

  // lil download
  paste: ClipboardPaste,
  cookie: Cookie,
  trim: Scissors,
  subs: Subtitles,
  sponsor: Tag,

  // lil view
  filmstrip: GalleryHorizontalEnd,
  slideshow: Play,
  fullscreen: Maximize,
  rotateLeft: RotateCcw,
  rotateRight: RotateCw,
  edit: PenLine,

  // lil edit
  crop: Crop,
  resize: Scaling,
  flipH: FlipHorizontal,
  flipV: FlipVertical,
  upscale: Sparkles,
  background: Layers,
  compare: Columns2,
  undo: Undo2,
  redo: Redo2,
  expand: Expand,
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
