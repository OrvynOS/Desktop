/** Icons (Lucide, ISC licence), as elements. */
import {
  createElement,
  ArrowUp,
  AtSign,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Code,
  Command,
  ExternalLink,
  Eye,
  File,
  FileCode,
  FileJson,
  FilePen,
  FileText,
  Film,
  Folder,
  FolderOpen,
  Gamepad2,
  Globe,
  Image,
  KeyRound,
  LoaderCircle,
  LogOut,
  MessageSquare,
  Monitor,
  MousePointerClick,
  Music,
  PanelRight,
  Paperclip,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Wallet,
  Wand,
  X,
  type IconNode,
} from "lucide";

const ICONS = {
  arrowUp: ArrowUp,
  at: AtSign,
  bot: Bot,
  check: Check,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  clapper: Clapperboard,
  code: Code,
  command: Command,
  external: ExternalLink,
  eye: Eye,
  file: File,
  fileCode: FileCode,
  fileJson: FileJson,
  fileEdit: FilePen,
  fileText: FileText,
  film: Film,
  folder: Folder,
  folderOpen: FolderOpen,
  game: Gamepad2,
  globe: Globe,
  image: Image,
  key: KeyRound,
  loader: LoaderCircle,
  logOut: LogOut,
  chat: MessageSquare,
  monitor: Monitor,
  click: MousePointerClick,
  music: Music,
  panel: PanelRight,
  clip: Paperclip,
  pencil: Pencil,
  play: Play,
  plus: Plus,
  restart: RotateCcw,
  search: Search,
  settings: Settings,
  shield: ShieldCheck,
  sparkles: Sparkles,
  stop: Square,
  trash: Trash2,
  wallet: Wallet,
  wand: Wand,
  x: X,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 16, cls = "") {
  const el = createElement(ICONS[name], { width: size, height: size, "stroke-width": size <= 14 ? 2 : 1.75, class: `ic${cls ? ` ${cls}` : ""}`, "aria-hidden": "true" });
  return el as unknown as SVGElement;
}

/** The icon for a file, by name. */
export function fileIcon(name: string, size = 14): SVGElement {
  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(name)) return icon("image", size, "t-img");
  if (/\.(mp4|webm|mov)$/i.test(name)) return icon("film", size, "t-vid");
  if (/\.(mp3|wav|ogg|m4a)$/i.test(name)) return icon("music", size, "t-aud");
  if (/\.(json|excalidraw)$/i.test(name)) return icon("fileJson", size, "t-json");
  if (/\.(ts|tsx|js|mjs|rhai|py|html?|css)$/i.test(name)) return icon("fileCode", size, "t-code");
  if (/\.(md|txt|srt|vtt|csv)$/i.test(name)) return icon("fileText", size, "t-text");
  return icon("file", size);
}
