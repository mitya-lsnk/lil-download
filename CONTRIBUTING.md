# Contributing to lil download

Thanks for taking the time to contribute! This is a small project, so the process is
light.

## Getting set up

You'll need **Node ≥ 22** and **Rust** (stable). Then:

```bash
npm install
npm run tauri dev
```

The frontend alone (`npm run dev`) opens in a plain browser and will tell you so: every
useful action goes through the Rust side, which only exists inside the Tauri app.

You'll also want yt-dlp and ffmpeg. The app installs them itself on first launch;
nothing needs to be on your PATH.

## Before you open a PR

Run the checks CI runs:

```bash
npx tsc --noEmit                          # type-check the frontend
npm run build                             # production frontend build
cd src-tauri && cargo test --lib          # Rust tests
cd src-tauri && cargo clippy --lib        # and keep it warning-free
```

`cargo test` needs `dist/` to exist — tauri-build refuses to run without it — so build
the frontend first if you're starting from a clean checkout.

## Code style

- Match the surrounding code — naming, comment density, and idiom. Comments explain
  *why*, not *what*: the interesting comments in this codebase record a trap someone
  already fell into.
- TypeScript is strict; keep it that way. No `any` where a real type fits.
- Keep components focused; shared logic goes in `src/lib/`.

## Translations (i18n)

All user-facing text lives in [`src/lib/strings.tsx`](src/lib/strings.tsx), in two
dictionaries: `RU` and `EN`. `EN` is typed as `Dict = typeof RU`, so adding a key to one
language makes the compiler require it in the other — a missing or renamed key is a
build error, not a silent gap.

- Add new UI strings there, never inline in a component.
- Reach for `useStrings()` in a component; outside React, pass the string in.
- A third language means another dictionary plus widening the `Lang` union in
  [`src/lib/i18n.tsx`](src/lib/i18n.tsx).

## Touching the yt-dlp arguments

[`src-tauri/src/dl.rs`](src-tauri/src/dl.rs) builds the command line, and `build_args`
is deliberately a pure function so it can be tested without running anything. If you
change what gets passed, add a test — several of the ones already there exist because
a plausible-looking argument list silently did the wrong thing:

- a second `-S` **replaces** the first rather than adding to it;
- `--print` implies `--quiet`, which swallows the progress template;
- a flag left without its value eats the next argument, which is why the URL is placed
  before anything the user can influence.

## Commits & PRs

- Write clear commit messages; describe the *why* in the body when it isn't obvious.
- One logical change per PR where practical.
- Describe what you changed and how you tested it.

## License

By contributing, you agree that your contributions are licensed under the project's
[MIT License](LICENSE).
