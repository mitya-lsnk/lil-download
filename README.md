# lil download

**English** · [Русский](README.ru.md)

A cross-platform desktop app for saving video and audio: paste a link, get a file.
YouTube, Twitter/X, Vimeo and the thousand-odd other sites [yt-dlp](https://github.com/yt-dlp/yt-dlp)
knows. Nothing about you is collected and no account is needed — the only connections
the app opens are the ones you ask for. See [What goes over the network](#what-goes-over-the-network).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)
![Platforms](https://img.shields.io/badge/platforms-macOS%20·%20Windows%20·%20Linux-555)

Part of the **lil** set — small local tools that each do one thing:

| | |
|---|---|
| [lil edit](https://github.com/mitya-lsnk/lil-edit) | reshape it: compress, cut out the background, upscale |
| [lil view](https://github.com/mitya-lsnk/lil-view) | look at it: a fast macOS image viewer |
| **lil download** | fetch it: video and audio from anywhere yt-dlp reaches — you are here |

---

## Install

Grab a build from [Releases](../../releases):

| | |
|---|---|
| **macOS** | `.dmg` — one universal file for both Apple Silicon and Intel |
| **Windows** | `.exe` installer, or `.msi` if that suits your deployment better |
| **Linux** | `.deb`, `.rpm` or `.AppImage` |

Neither build is signed. macOS: right-click the app → **Open** the first time.
Windows: SmartScreen says "unknown publisher" → **More info** → **Run anyway**.

**yt-dlp and ffmpeg are not bundled.** The app fetches them on first launch and keeps
them beside itself. That's deliberate: yt-dlp ships every couple of weeks chasing
YouTube's changes, and a copy frozen inside the app would be broken within the month.
ffmpeg is GPL, which is its own reason not to link it in.

---

## What works

| Feature | Status | How |
|---|---|---|
| **Downloading** | ✅ done | yt-dlp — YouTube, Twitter/X, Vimeo, TikTok, Instagram, Reddit, Twitch, VK, SoundCloud, and the rest of its extractor list |
| **Quality vs. container** | ✅ done | Two separate choices on purpose: the preset decides *how good*, the container decides *what opens it* |
| **Custom presets** | ✅ done | Built in Settings, offered next to the four built-in ones |
| **Filename builder** | ✅ done | 80 yt-dlp fields as draggable chips, with a live preview |
| **Folder rules** | ✅ done | Per-domain memory of folder, preset and filename template |
| **Cookies** | ✅ done | Firefox, Safari, Chrome, Brave, Edge, Opera, Vivaldi, Chromium — read by yt-dlp, never by us |
| **Editing while downloading** | ✅ done | Trim by timecode, embed or write subtitles, SponsorBlock, embed the poster frame |
| **Speed cap** | ✅ done | KB/s, MB/s or Mbit/s, converted honestly |
| **Own yt-dlp flags** | ✅ done | ~80 common options with descriptions, and a warning when a flag is left without its value |
| **Tool management** | ✅ done | Install, update and version-check yt-dlp and ffmpeg; stable or nightly, per tool |
| **Interface language** | ✅ done | Russian / English, switchable in-app |
| **Theming** | ✅ done | Four skins × light/dark |

> The Rust side is covered by 52 tests — URL parsing, argument construction, tool
> discovery, error translation. The parts that talk to real websites are best checked by
> hand, because their failures are the websites' and not ours.

---

## Two decisions worth knowing about

**"Best quality" and "opens everywhere" are not the same file.** YouTube's H.264 ladder
stops at 1080p; above that it serves VP9 and AV1, which QuickTime won't play and most
NLEs won't import. So the quality preset and the container are separate controls, and
the menu says what each one will actually produce for the link on screen.

**Playlists are stripped from the link by default.** Pasting a video that happens to sit
in a playlist should download that video. Downloading all 92 is a button, not an
accident.

---

## Interface language

The UI ships in **Russian and English**, switchable from the header. All user-facing
text lives in [`src/lib/strings.tsx`](src/lib/strings.tsx) — add a key to the `RU`
object and the compiler will require the matching `EN` value, so a missing translation
is a build error rather than a blank label.

---

## Tech stack

- **Tauri 2** — shell (Rust backend + system WebView). Light, ~10 MB runtime.
- **React + TypeScript + Vite** — frontend.
- **yt-dlp** — every extractor, fetched and updated at runtime.
- **ffmpeg** — merging, remuxing, re-encoding and trimming, likewise fetched at runtime.

---

## Getting started

Requires Node ≥ 22 and Rust.

```bash
npm install          # first time only
npm run tauri dev    # run the app in dev mode
```

Build a release bundle for the current system:

```bash
npm run tauri build
```

All three platforms are built by [CI](.github/workflows/build.yml) on every push; a
`v*` tag additionally opens a draft release with every artifact attached. Building for
Windows from a Mac needs the MSVC SDK, LLVM and NSIS and still produces something
unsigned that nobody has run — the matrix is there so that isn't necessary.

---

## What goes over the network

There is no telemetry, no analytics, no crash reporting and no account. The app opens
four kinds of connection, all of them because you asked:

| When | Where | What is sent |
|---|---|---|
| **On launch** — version check | `api.github.com` | Nothing but the request: your IP and a `lil-download/<version>` User-Agent. Cached for six hours. |
| **You click Install / Reinstall** | GitHub Releases (yt-dlp), evermeet.cx / BtbN / johnvansickle (ffmpeg) | Nothing but the request. Never automatic after the first launch. |
| **You paste a YouTube link** | `i.ytimg.com` | The video id, to show the poster frame before the probe comes back. |
| **You press Download** | The site you named, through yt-dlp | Whatever yt-dlp sends it — plus your session cookies, if and only if you picked a browser. |

**Cookies never pass through this app.** Picking a browser sends yt-dlp its *name*;
yt-dlp reads the cookie store itself. A downloader has no business holding anyone's
session tokens.

---

## Project structure

```
lil-download/
├── src/                        # frontend (React)
│   ├── App.tsx                 # shell, queue, the one screen
│   ├── lib/
│   │   ├── api.ts              # typed wrappers over the Rust commands
│   │   ├── settings.ts         # prefs, folder rules, custom presets
│   │   ├── template.ts         # the 80-field filename catalogue, parse/serialise
│   │   ├── predict.ts          # what a preset would give for this link
│   │   ├── cache.ts            # what's remembered so the window draws immediately
│   │   ├── thumb.ts            # poster frame derived from the link alone
│   │   ├── history.ts          # the queue, kept across restarts
│   │   ├── i18n.tsx            # language context (RU/EN)
│   │   ├── skin.tsx            # skin + light/dark
│   │   └── strings.tsx         # all UI text, both languages
│   └── components/
│       ├── LinkBar.tsx         # the one input
│       ├── MediaCard.tsx       # the link, before it is downloaded
│       ├── Queue.tsx           # downloads, live and finished
│       ├── PresetPicker.tsx    # quality and container, kept apart
│       ├── PresetEditor.tsx    # presets built by hand
│       ├── TemplateBuilder.tsx # the filename, as chips
│       ├── FlagsInput.tsx      # yt-dlp flags with suggestions
│       ├── CookiePicker.tsx    # which browser to borrow a session from
│       ├── ToolsPanel.tsx      # yt-dlp and ffmpeg: state and buttons
│       └── SettingsScreen.tsx  # tools, downloading, presets, appearance
├── src-tauri/
│   └── src/
│       ├── lib.rs              # command registration; heavy work off the main thread
│       ├── urlx.rs             # link parsing: playlists cut, trackers dropped
│       ├── bins.rs             # finding, installing and versioning the two tools
│       ├── probe.rs            # metadata, and turning yt-dlp's errors into answers
│       ├── dl.rs               # the download itself: arguments, progress, cancel
│       └── cookies.rs          # per-browser access verdicts
└── .github/workflows/build.yml # macOS · Windows · Linux
```

---

## Roadmap / known limits

- **Burned-in subtitles** need a full re-encode through an ffmpeg filter; yt-dlp can't
  do it natively. Not built yet.
- **Named, exportable configs** — presets are per-machine for now.
- **Search across settings** — the tabs are short enough today, and won't stay that way.

---

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Third-party licenses

lil download's own code is MIT (see [LICENSE](LICENSE)). **yt-dlp** (Unlicense) and
**ffmpeg** (GPL/LGPL depending on the build) are downloaded at runtime and are not
distributed with this app; each carries its own terms.

## License

[MIT](LICENSE) © 2026 lsnk
